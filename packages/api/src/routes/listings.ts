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
import { requireSeller } from './sellers.ts';

const GRADES = ['UNC', 'AU', 'XF', 'VF', 'F', 'VG', 'G', 'POOR'] as const;

const OPEN_STATES = ['draft', 'pending_review', 'minted', 'reserved'] as const;

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
   * Body: serial, denomination, series, grade, priceInr, plus optional title,
   * description, signatory, yearOfIssue, insetLetter.
   */
  router.add('POST', '/v1/listings', async (ctx) => {
    const seller = await requireSeller(ctx);

    const fields = asObject(await ctx.body());
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
    const listing = await loadListing(ctx, id);
    if (listing === null) throw notFound('No such listing.');
    return json(listing);
  });

  /** POST /v1/listings/:id/publish — draft → minted. */
  router.add('POST', '/v1/listings/:id/publish', async (ctx) => {
    const seller = await requireSeller(ctx);
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
      const rows = await ctx.db.query<ListingRow>(
        `select id, seller_id, kind, title, description, state, sale_mode,
                price_paise, grade, published_at, created_at
           from listings
          where state = 'minted'
          order by published_at desc nulls last
          limit $1`,
        [limit],
      );
      return json({ listings: rows.rows.map((r) => publicListing(r, null, null, null)) });
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
        exact: boolean;
      }
    >(
      `select l.id, l.seller_id, l.kind, l.title, l.description, l.state, l.sale_mode,
              l.price_paise, l.grade, l.published_at, l.created_at,
              d.matched_date::text as matched_date, d.day, d.month, d.year, d.confidence, d.era,
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
        patterns: tagResult.rows.map((t) => ({
          code: t.code,
          label: t.label,
          weight: Number(t.weight),
          detail: t.detail === '' ? null : t.detail,
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
