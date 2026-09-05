/**
 * Listing creation and search.
 *
 * Creating a listing runs the serial engine once and persists everything it
 * derives — the decomposed serial, every plausible date reading, and every
 * fancy-pattern tag — inside a single transaction. The engine is therefore the
 * only place a serial is ever interpreted, and the database ends up holding
 * facts rather than an opaque string that has to be re-parsed on every search.
 */

import { analyzeSerial, serialRegistryKey } from '@rareminting/serial-engine';
import type { DateInterpretation, PatternTag } from '@rareminting/serial-engine';

import type { Ctx, Router } from '../http.ts';
import { json } from '../http.ts';
import { badRequest, conflict, forbidden, notFound } from '../errors.ts';
import { asObject, oneOf, optionalString, requiredString } from '../validate.ts';
import { PG_UNIQUE_VIOLATION, one, pgConstraint, pgErrorCode, type Database } from '../db.ts';
import { requireApprovedSeller, requireSeller } from './sellers.ts';

const GRADES = ['UNC', 'AU', 'XF', 'VF', 'F', 'VG', 'G', 'POOR'] as const;

/** Matches the item_kind enum. A banknote takes a different path from the rest. */
const ITEM_KINDS = [
  'banknote',
  'coin',
  'stamp',
  'bond',
  'share_certificate',
  'ephemera',
  'jewellery',
  'precious_stone',
  'antique',
  'other',
] as const;

const KIND_LABEL: Record<string, string> = {
  coin: 'Coin',
  stamp: 'Stamp',
  bond: 'Bond',
  share_certificate: 'Share certificate',
  ephemera: 'Ephemera',
  jewellery: 'Jewellery',
  precious_stone: 'Precious stone',
  antique: 'Antique',
  other: 'Collectible',
};

const OPEN_STATES = ['draft', 'pending_review', 'minted', 'reserved'] as const;

/**
 * Browsable collections, each a set of pattern codes.
 *
 * Named for what a buyer is actually looking for rather than for the taxonomy.
 * Somebody wants "a lucky note"; they do not want to learn that the engine
 * calls it LUCKY and that 786 and 108 are the auspicious numbers it knows.
 *
 * A bare pattern code also works, so the taxonomy stays reachable for anyone
 * who does know it.
 */
const COLLECTIONS: Readonly<Record<string, readonly string[]>> = {
  // Auspicious numbers — 786 and 108 above all.
  lucky: ['LUCKY'],
  // The premium patterns. What a collector means by a fancy serial.
  unique: [
    'SOLID',
    'RADAR',
    'LADDER_ASC',
    'LADDER_DESC',
    'LADDER_ASC_WRAP',
    'LADDER_DESC_WRAP',
    'REPEATER',
    'TRIPLE_PAIRS',
    'DOUBLE_PAIRS',
    'BINARY',
  ],
  solid: ['SOLID'],
  radar: ['RADAR'],
  ladder: ['LADDER_ASC', 'LADDER_DESC', 'LADDER_ASC_WRAP', 'LADDER_DESC_WRAP'],
  repeater: ['REPEATER', 'TRIPLE_PAIRS', 'DOUBLE_PAIRS'],
  // Replacement notes, printed to substitute a spoiled one and scarcer for it.
  star: ['STAR_SERIES'],
  'low-serial': ['LOW_SERIAL'],
  novelty: ['NOVELTY'],
};

const KNOWN_CODES = new Set([
  'SOLID', 'RADAR', 'LADDER_ASC', 'LADDER_DESC', 'LADDER_ASC_WRAP', 'LADDER_DESC_WRAP',
  'REPEATER', 'TRIPLE_PAIRS', 'DOUBLE_PAIRS', 'BINARY', 'LUCKY', 'NOVELTY', 'SEMI_FANCY',
  'STAR_SERIES', 'ERROR_NOTE', 'LOW_SERIAL', 'HIGH_SERIAL',
]);

/** A collection name or a bare pattern code, to the codes it covers. */
function expandPattern(input: string): string[] | null {
  const collection = COLLECTIONS[input.toLowerCase()];
  if (collection !== undefined) return [...collection];
  const code = input.toUpperCase();
  return KNOWN_CODES.has(code) ? [code] : null;
}

/** Rupees in, paise out. Money is only ever stored as an integer minor unit. */
function toPaise(fields: Record<string, unknown>, key: string): number {
  const value = fields[key];
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw badRequest(`${key} must be a number of rupees.`, { [key]: 'invalid' });
  }
  if (value <= 0) {
    throw badRequest(`${key} must be greater than zero.`, { [key]: 'invalid' });
  }
  const paise = Math.round(value * 100);
  if (!Number.isSafeInteger(paise)) {
    throw badRequest(`${key} is too large.`, { [key]: 'invalid' });
  }
  return paise;
}

function positiveInt(fields: Record<string, unknown>, key: string): number {
  const value = fields[key];
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    throw badRequest(`${key} must be a positive whole number.`, { [key]: 'invalid' });
  }
  return value;
}

interface ListingRow {
  id: string;
  seller_id: string;
  kind: string;
  title: string;
  description: string | null;
  state: string;
  sale_mode: string;
  price_paise: string | number | null;
  grade: string | null;
  published_at: Date | string | null;
  created_at: Date | string;
}

interface NoteRow {
  denomination: number;
  series: string;
  prefix: string | null;
  is_star: boolean;
  serial_digits: string;
  digit_count: number;
}

/**
 * The note half of a joined row, or null when the join found nothing.
 *
 * A listing that is not a banknote has no row in `notes`, and a left join
 * fills its columns with nulls rather than dropping the listing.
 */
function noteOf(row: Partial<NoteRow>): NoteRow | null {
  if (row.denomination == null || row.serial_digits == null) return null;
  return {
    denomination: row.denomination,
    series: row.series ?? '',
    prefix: row.prefix ?? null,
    is_star: row.is_star ?? false,
    serial_digits: row.serial_digits,
    digit_count: row.digit_count ?? row.serial_digits.length,
  };
}

function paiseToNumber(value: string | number | null): number | null {
  if (value === null) return null;
  return typeof value === 'number' ? value : Number(value);
}

function publicListing(
  listing: ListingRow,
  note: NoteRow | null,
  dates: DateInterpretation[] | null,
  tags: { code: string; label: string; weight: number; detail: string | null }[] | null,
): Record<string, unknown> {
  return {
    id: listing.id,
    // So a client can tell whose listing this is without guessing. A seller id
    // is not a secret — the seller's name is on the page.
    sellerId: listing.seller_id,
    kind: listing.kind,
    title: listing.title,
    description: listing.description,
    state: listing.state,
    saleMode: listing.sale_mode,
    priceInr: (() => {
      const paise = paiseToNumber(listing.price_paise);
      return paise === null ? null : paise / 100;
    })(),
    grade: listing.grade,
    publishedAt: listing.published_at,
    createdAt: listing.created_at,
    ...(note === null
      ? {}
      : {
          note: {
            denomination: note.denomination,
            series: note.series,
            prefix: note.prefix,
            isStar: note.is_star,
            serialDigits: note.serial_digits,
          },
        }),
    ...(dates === null ? {} : { dates }),
    ...(tags === null ? {} : { patterns: tags }),
  };
}

export function registerListingRoutes(router: Router, database: Database): void {
  /**
   * POST /v1/listings
   *
   * A banknote needs a serial — reading it is the whole point — so `serial`,
   * `denomination` and `series` are required for one. Anything else is a
   * collectible: it needs a title and nothing more, because a coin has no
   * serial number and demanding one would make coins unlistable.
   *
   * Body (banknote): serial, denomination, series, grade, priceInr, plus
   * optional title, description, signatory, insetLetter.
   * Body (coin and others): kind, title, priceInr, plus optional denomination,
   * yearOfIssue, mintMark, metal, weightGrams, catalogueRef, grade,
   * description.
   */
  router.add('POST', '/v1/listings', async (ctx) => {
    const seller = await requireSeller(ctx);

    const fields = asObject(await ctx.body());

    // Default to banknote: every existing caller omits `kind` and means one.
    const kind = fields['kind'] === undefined ? 'banknote' : oneOf(fields, 'kind', ITEM_KINDS);
    if (kind !== 'banknote') {
      return createCollectible(database, seller.id, kind, fields);
    }

    const serialInput = requiredString(fields, 'serial', 64);
    const denomination = positiveInt(fields, 'denomination');
    const series = requiredString(fields, 'series', 120);
    const grade = fields['grade'] === undefined ? null : oneOf(fields, 'grade', GRADES);
    const pricePaise = toPaise(fields, 'priceInr');
    const description = optionalString(fields, 'description', 4000);
    const signatory = optionalString(fields, 'signatory', 120);
    const insetLetter = optionalString(fields, 'insetLetter', 1);

    // The single interpretation of this serial. Everything below is derived.
    const analysis = analyzeSerial(serialInput);
    if (analysis === null) {
      throw badRequest(
        'That serial number could not be read. Check it against the note and try again.',
        { serial: 'unparseable' },
      );
    }

    const { serial } = analysis;
    const registryKey = serialRegistryKey(serial, denomination, series);

    const title =
      optionalString(fields, 'title', 200) ??
      `₹${denomination} ${series} · ${serial.normalized}`;

    try {
      const created = await database.transaction(async (tx) => {
        const listingResult = await tx.query<ListingRow>(
          `insert into listings
             (seller_id, kind, title, description, state, sale_mode, price_paise, grade)
           values ($1, 'banknote', $2, $3, 'draft', 'fixed', $4, $5)
           returning id, seller_id, kind, title, description, state, sale_mode,
                     price_paise, grade, published_at, created_at`,
          [seller.id, title, description, pricePaise, grade],
        );
        const listing = listingResult.rows[0];
        if (listing === undefined) throw new Error('failed to create listing');

        await tx.query(
          `insert into notes
             (listing_id, denomination, series, signatory, inset_letter, prefix,
              prefix_numeral, prefix_letters, is_star, serial_digits, serial_value,
              digit_count, registry_key, is_live)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, true)`,
          [
            listing.id,
            denomination,
            series,
            signatory,
            insetLetter ?? serial.insetLetter,
            serial.prefix,
            serial.prefixNumeral,
            serial.prefixLetters,
            serial.isStar,
            serial.serialDigits,
            serial.serialValue,
            serial.digitCount,
            registryKey,
          ],
        );

        for (const tag of analysis.patterns) {
          await tx.query(
            `insert into listing_pattern_tags (listing_id, tag_code, weight, detail, tier)
             values ($1, $2, $3, $4, $5)
             on conflict (listing_id, tag_code, detail) do nothing`,
            [listing.id, tag.code, tag.weight, tag.detail ?? '', tag.tier],
          );
        }

        for (const date of analysis.dates) {
          await tx.query(
            `insert into date_matches
               (listing_id, matched_date, day, month, year, is_partial, orders,
                score, confidence, era)
             values ($1, $2, $3, $4, $5, $6, $7::date_order[], $8, $9, $10)`,
            [
              listing.id,
              date.isPartial ? null : date.iso,
              date.day,
              date.month,
              date.year,
              date.isPartial,
              `{${date.patterns.join(',')}}`,
              date.score,
              date.confidence,
              date.era,
            ],
          );
        }

        return listing;
      });

      return json(
        {
          listing: publicListing(
            created,
            {
              denomination,
              series,
              prefix: serial.prefix,
              is_star: serial.isStar,
              serial_digits: serial.serialDigits,
              digit_count: serial.digitCount,
            },
            [...analysis.dates],
            summariseTags(analysis.patterns),
          ),
          rarityScore: analysis.rarityScore,
          warnings: analysis.warnings,
        },
        201,
      );
    } catch (error) {
      if (
        pgErrorCode(error) === PG_UNIQUE_VIOLATION &&
        pgConstraint(error) === 'notes_one_live_listing'
      ) {
        throw conflict(
          'That serial number is already listed. Each note can only be on sale once at a time.',
        );
      }
      throw error;
    }
  });

  /** GET /v1/listings/:id */
  router.add('GET', '/v1/listings/:id', async (ctx) => {
    const id = ctx.params['id'] ?? '';
    const loaded = await loadListing(ctx, id);
    if (loaded === null) throw notFound('No such listing.');

    // Count the view, but only a real one: a live listing, seen by somebody
    // other than the seller. Counting the seller's own visits would turn the
    // number into a measure of how often they refreshed their own page.
    const shown = loaded.listing as { state: string; sellerId: string };
    if (shown.state === 'minted') {
      const viewerSeller =
        ctx.session === null
          ? null
          : one(
              await ctx.db.query<{ id: string }>(`select id from sellers where user_id = $1`, [
                ctx.session.userId,
              ]),
            );
      if (viewerSeller?.id !== shown.sellerId) {
        await ctx.db.query(`update listings set view_count = view_count + 1 where id = $1`, [id]);
      }
    }

    return json(loaded);
  });

  /** POST /v1/listings/:id/publish — draft → minted. */
  router.add('POST', '/v1/listings/:id/publish', async (ctx) => {
    // Approval is the gate, and it is here rather than at creation: a seller
    // awaiting review can draft as much as they like, but nothing of theirs
    // reaches a buyer until an admin has approved them.
    const seller = await requireApprovedSeller(ctx);
    const id = ctx.params['id'] ?? '';

    const found = await ctx.db.query<{ seller_id: string; state: string; price_paise: string | null }>(
      `select seller_id, state, price_paise from listings where id = $1`,
      [id],
    );
    const row = one(found);
    if (row === null) throw notFound('No such listing.');
    if (row.seller_id !== seller.id) throw forbidden('This listing belongs to another seller.');
    if (row.state !== 'draft') {
      throw conflict(`Only a draft can be published; this listing is ${row.state}.`);
    }
    if (row.price_paise === null) throw badRequest('Set a price before publishing.');

    const updated = await ctx.db.query<ListingRow>(
      `update listings set state = 'minted', published_at = now()
        where id = $1
        returning id, seller_id, kind, title, description, state, sale_mode,
                  price_paise, grade, published_at, created_at`,
      [id],
    );

    return json({ listing: publicListing(exactly(updated.rows[0]), null, null, null) });
  });

  /**
   * GET /v1/listings?date=YYYY-MM-DD
   *
   * Find My Date, against the database. Exact matches first, then same
   * day-and-month in another year.
   */
  router.add('GET', '/v1/listings', async (ctx) => {
    const date = ctx.url.searchParams.get('date');
    const limit = Math.min(Number(ctx.url.searchParams.get('limit') ?? 24) || 24, 100);

    if (date === null) {
      // Browse by what makes a serial collectible rather than by date. The
      // engine tags every serial when it is listed, so this is an indexed
      // lookup rather than a scan.
      const patternParam = ctx.url.searchParams.get('pattern');
      const codes = patternParam === null ? null : expandPattern(patternParam);
      if (patternParam !== null && codes === null) {
        throw badRequest('Unknown pattern.', { pattern: 'unknown' });
      }

      /**
       * Newest first, or shuffled.
       *
       * Shuffled exists so the homepage does not show the same handful of
       * notes to everybody: with newest-first, a seller who listed last month
       * is never on the front page again, however good the note. Randomising
       * gives every listing a turn.
       *
       * `order by random()` sorts the whole matching set, which is nothing at
       * a hundred listings and would matter at a hundred thousand. When that
       * day comes the fix is to sample rather than sort — TABLESAMPLE, or a
       * random offset — not to quietly drop the feature.
       *
       * The clause is chosen between two fixed strings rather than built from
       * the parameter, so nothing a caller sends reaches the query.
       */
      const orderBy =
        ctx.url.searchParams.get('sort') === 'random'
          ? 'random()'
          : 'l.published_at desc nulls last';

      const rows = await ctx.db.query<
        ListingRow & { thumb: string | null } & Partial<NoteRow>
      >(
        `select l.id, l.seller_id, l.kind, l.title, l.description, l.state, l.sale_mode,
                l.price_paise, l.grade, l.published_at, l.created_at,
                n.denomination, n.series, n.prefix, n.is_star, n.serial_digits, n.digit_count,
                (select m.storage_key from media m
                  where m.listing_id = l.id order by m.sort_order asc limit 1) as thumb
           from listings l
           left join notes n on n.listing_id = l.id
          where l.state = 'minted'
            and ($2::text[] is null or exists (
                  select 1 from listing_pattern_tags lt
                   where lt.listing_id = l.id and lt.tag_code = any($2::text[])))
          order by ${orderBy}
          limit $1`,
        [limit, codes],
      );

      // The true number matching, not the number on this page. The homepage
      // states it out loud, so it has to be the real one.
      const counted = await ctx.db.query<{ total: string }>(
        `select count(*)::text as total
           from listings l
          where l.state = 'minted'
            and ($1::text[] is null or exists (
                  select 1 from listing_pattern_tags lt
                   where lt.listing_id = l.id and lt.tag_code = any($1::text[])))`,
        [codes],
      );

      return json({
        total: Number(counted.rows[0]?.total ?? 0),
        listings: rows.rows.map((r) => ({
          ...publicListing(r, noteOf(r), null, null),
          imageUrl: r.thumb === null ? null : `/media/${r.thumb}`,
        })),
      });
    }

    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      throw badRequest('date must be in YYYY-MM-DD form.', { date: 'invalid' });
    }

    const matches = await ctx.db.query<
      ListingRow & {
        matched_date: string | null;
        day: number;
        month: number;
        year: number | null;
        confidence: string | number;
        era: string | null;
        thumb: string | null;
        exact: boolean;
      }
    >(
      `select l.id, l.seller_id, l.kind, l.title, l.description, l.state, l.sale_mode,
              l.price_paise, l.grade, l.published_at, l.created_at,
              d.matched_date::text as matched_date, d.day, d.month, d.year, d.confidence, d.era,
              (select m.storage_key from media m
                where m.listing_id = l.id order by m.sort_order asc limit 1) as thumb,
              (d.matched_date = $1::date) as exact
         from date_matches d
         join listings l on l.id = d.listing_id
        where l.state = 'minted'
          and d.month = extract(month from $1::date)
          and d.day   = extract(day   from $1::date)
        order by (d.matched_date = $1::date) desc, d.confidence desc
        limit $2`,
      [date, limit],
    );

    const exactRows = matches.rows.filter((r) => r.exact);
    const nearRows = matches.rows.filter((r) => !r.exact);

    const shape = (r: (typeof matches.rows)[number]): Record<string, unknown> => ({
      ...publicListing(r, null, null, null),
      imageUrl: r.thumb === null ? null : `/media/${r.thumb}`,
      match: {
        iso: r.matched_date,
        day: r.day,
        month: r.month,
        year: r.year,
        confidence: Number(r.confidence),
        era: r.era,
      },
    });

    return json({
      date,
      exact: exactRows.map(shape),
      dayMonth: nearRows.map(shape),
    });
  });

  async function loadListing(ctx: Ctx, id: string): Promise<Record<string, unknown> | null> {
    if (!/^[0-9a-f-]{36}$/i.test(id)) return null;

    const listingResult = await ctx.db.query<ListingRow>(
      `select id, seller_id, kind, title, description, state, sale_mode,
              price_paise, grade, published_at, created_at
         from listings where id = $1`,
      [id],
    );
    const listing = one(listingResult);
    if (listing === null) return null;

    // A draft is visible only to the seller who owns it.
    if (!(OPEN_STATES as readonly string[]).includes(listing.state) || listing.state === 'draft') {
      const seller = await ctx.db.query<{ id: string }>(
        `select id from sellers where user_id = $1`,
        [ctx.session?.userId ?? null],
      );
      if (one(seller)?.id !== listing.seller_id) return null;
    }

    const collectibleResult = await ctx.db.query<{
      denomination: number | null;
      year_of_issue: number | null;
      mint_mark: string | null;
      metal: string | null;
      weight_grams: string | null;
      catalogue_ref: string | null;
    }>(
      `select denomination, year_of_issue, mint_mark, metal,
              weight_grams::text as weight_grams, catalogue_ref
         from collectibles where listing_id = $1`,
      [id],
    );

    const noteResult = await ctx.db.query<NoteRow>(
      `select denomination, series, prefix, is_star, serial_digits, digit_count
         from notes where listing_id = $1`,
      [id],
    );

    const tagResult = await ctx.db.query<{
      code: string;
      label: string;
      weight: string | number;
      detail: string;
    }>(
      `select t.code, t.label, lt.weight, lt.detail
         from listing_pattern_tags lt
         join pattern_tags t on t.code = lt.tag_code
        where lt.listing_id = $1
        order by lt.weight desc`,
      [id],
    );

    const mediaResult = await ctx.db.query<{
      id: string;
      kind: string;
      storage_key: string;
    }>(
      `select id, kind, storage_key
         from media where listing_id = $1 order by sort_order asc`,
      [id],
    );

    const dateResult = await ctx.db.query<{
      matched_date: string | null;
      day: number;
      month: number;
      year: number | null;
      is_partial: boolean;
      confidence: string | number;
      era: string | null;
    }>(
      `select matched_date::text as matched_date, day, month, year, is_partial, confidence, era
         from date_matches where listing_id = $1 order by confidence desc`,
      [id],
    );

    return {
      listing: {
        ...publicListing(listing, one(noteResult), null, null),
        ...(one(collectibleResult) === null
          ? {}
          : {
              collectible: (() => {
                const c = one(collectibleResult)!;
                return {
                  denomination: c.denomination,
                  yearOfIssue: c.year_of_issue,
                  mintMark: c.mint_mark,
                  metal: c.metal,
                  weightGrams: c.weight_grams === null ? null : Number(c.weight_grams),
                  catalogueRef: c.catalogue_ref,
                };
              })(),
            }),
        patterns: tagResult.rows.map((t) => ({
          code: t.code,
          label: t.label,
          weight: Number(t.weight),
          detail: t.detail === '' ? null : t.detail,
        })),
        media: mediaResult.rows.map((m) => ({
          id: m.id,
          kind: m.kind,
          url: `/media/${m.storage_key}`,
        })),
        dates: dateResult.rows.map((d) => ({
          iso: d.matched_date,
          day: d.day,
          month: d.month,
          year: d.year,
          isPartial: d.is_partial,
          confidence: Number(d.confidence),
          era: d.era,
        })),
      },
    };
  }
}

function summariseTags(
  tags: readonly PatternTag[],
): { code: string; label: string; weight: number; detail: string | null }[] {
  return tags.map((t) => ({ code: t.code, label: t.label, weight: t.weight, detail: t.detail }));
}

function exactly<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('expected a row');
  return value;
}

/**
 * Create a coin or other collectible.
 *
 * Deliberately undemanding compared with a banknote. There is no serial to
 * parse, no dates to derive and no pattern to tag, so the only thing genuinely
 * required is a title and a price — everything else describes the item and is
 * optional, because a seller listing a hundred-year-old token may not know its
 * weight or its catalogue reference and should not be blocked on either.
 */
async function createCollectible(
  database: Database,
  sellerId: string,
  kind: string,
  fields: Record<string, unknown>,
): Promise<Response> {
  const pricePaise = toPaise(fields, 'priceInr');
  const grade = fields['grade'] === undefined ? null : oneOf(fields, 'grade', GRADES);
  const description = optionalString(fields, 'description', 4000);
  const mintMark = optionalString(fields, 'mintMark', 16);
  const metal = optionalString(fields, 'metal', 60);
  const catalogueRef = optionalString(fields, 'catalogueRef', 60);

  const denomination =
    fields['denomination'] === undefined || fields['denomination'] === null
      ? null
      : positiveInt(fields, 'denomination');

  let yearOfIssue: number | null = null;
  if (fields['yearOfIssue'] !== undefined && fields['yearOfIssue'] !== null) {
    const value = fields['yearOfIssue'];
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 1600 || value > 2100) {
      throw badRequest('Year of issue must be a whole year between 1600 and 2100.', {
        yearOfIssue: 'invalid',
      });
    }
    yearOfIssue = value;
  }

  let weightGrams: number | null = null;
  if (fields['weightGrams'] !== undefined && fields['weightGrams'] !== null) {
    const value = fields['weightGrams'];
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
      throw badRequest('Weight must be a positive number of grams.', { weightGrams: 'invalid' });
    }
    weightGrams = value;
  }

  // A title the seller gave, or one built from what they did tell us.
  const title =
    optionalString(fields, 'title', 200) ??
    [
      yearOfIssue === null ? null : String(yearOfIssue),
      denomination === null ? null : `₹${denomination}`,
      KIND_LABEL[kind] ?? 'Collectible',
      metal,
    ]
      .filter((part): part is string => part !== null && part !== '')
      .join(' ');

  if (title.trim().length === 0) {
    throw badRequest('Give this item a title so buyers know what it is.', { title: 'required' });
  }

  const created = await database.transaction(async (tx) => {
    const listingResult = await tx.query<ListingRow>(
      `insert into listings
         (seller_id, kind, title, description, state, sale_mode, price_paise, grade)
       values ($1, $2::item_kind, $3, $4, 'draft', 'fixed', $5, $6)
       returning id, seller_id, kind, title, description, state, sale_mode,
                 price_paise, grade, published_at, created_at`,
      [sellerId, kind, title, description, pricePaise, grade],
    );
    const listing = listingResult.rows[0];
    if (listing === undefined) throw new Error('failed to create listing');

    await tx.query(
      `insert into collectibles
         (listing_id, denomination, year_of_issue, mint_mark, metal, weight_grams, catalogue_ref)
       values ($1, $2, $3, $4, $5, $6, $7)`,
      [listing.id, denomination, yearOfIssue, mintMark, metal, weightGrams, catalogueRef],
    );

    return listing;
  });

  return json(
    {
      listing: {
        ...publicListing(created, null, null, null),
        collectible: {
          denomination,
          yearOfIssue,
          mintMark,
          metal,
          weightGrams,
          catalogueRef,
        },
      },
    },
    201,
  );
}
