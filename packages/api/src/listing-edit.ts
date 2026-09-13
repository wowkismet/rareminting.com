/**
 * Editing a listing, for whoever is allowed to.
 *
 * Sellers could not edit anything at all until now: a listing was written once
 * at creation and then frozen, so a typo in a description or a price that
 * needed dropping meant withdrawing the item and listing it again, losing its
 * views and its watchers with it.
 *
 * Admin could edit, through a route of its own that understood four fields.
 * Rather than widen that one and add a second, near-identical one for sellers,
 * both now go through here. Two editors drift: one gains a field, the other
 * does not, and eventually they disagree about what a valid price is. There is
 * one set of rules, and the caller supplies only the answer to "who is this".
 *
 * What differs by actor is authority, not validation:
 *
 *   seller — their own listings, and not once an auction has bids
 *   admin  — any listing, including a seller's, by design
 */

import { badRequest, conflict } from './errors.ts';
import { oneOf, optionalString, requiredString } from './validate.ts';

export const GRADES = ['UNC', 'AU', 'XF', 'VF', 'F', 'VG', 'G', 'POOR'] as const;

/** Matches the sale_mode enum. */
export const SALE_MODES = ['fixed', 'offers', 'auction'] as const;

/** Matches the listing_state enum, minus the states only the system sets. */
export const EDITABLE_STATES = ['draft', 'pending_review', 'minted', 'withdrawn'] as const;

export interface ListingPatch {
  /** Column name to value, ready to splice into an update. */
  readonly columns: Record<string, unknown>;
  /** What changed, in words, for the audit record. */
  readonly actions: string[];
}

/**
 * Rupees to paise, refusing everything that is not money.
 *
 * A price is an integer number of paise and never a float. The ceiling is not
 * arbitrary: above a crore, a "price" is a typo — somebody has entered a
 * serial number into the price box, which happens more often than it should.
 */
function toPaise(value: unknown, field: string): number | null {
  if (value === null || value === '') return null;
  const inr = Number(value);
  if (!Number.isFinite(inr) || inr <= 0) {
    throw badRequest('A price must be a number of rupees above zero.', { [field]: 'invalid' });
  }
  if (!Number.isInteger(inr)) {
    throw badRequest('A price must be a whole number of rupees.', { [field]: 'not_whole' });
  }
  if (inr > 100_000_000) {
    throw badRequest('That price looks like a mistake. Check it and try again.', {
      [field]: 'implausible',
    });
  }
  return inr * 100;
}

/**
 * Read an edit into a set of column changes.
 *
 * Only keys actually present are touched. An absent key means "leave this
 * alone", never "blank it" — otherwise an admin correcting a price would wipe
 * the description the seller wrote.
 */
export function readListingPatch(fields: Record<string, unknown>): ListingPatch {
  const columns: Record<string, unknown> = {};
  const actions: string[] = [];

  if ('title' in fields) {
    const title = requiredString(fields, 'title', 200).trim();
    if (title.length < 2) {
      throw badRequest('A title needs at least a couple of characters.', { title: 'too_short' });
    }
    columns['title'] = title;
    actions.push('TITLE_CHANGED');
  }

  if ('description' in fields) {
    columns['description'] = optionalString(fields, 'description', 4000);
    actions.push('DESCRIPTION_CHANGED');
  }

  if ('grade' in fields) {
    const grade = optionalString(fields, 'grade', 8);
    if (grade !== null && !(GRADES as readonly string[]).includes(grade)) {
      throw badRequest(`Condition must be one of ${GRADES.join(', ')}.`, { grade: 'unknown' });
    }
    columns['grade'] = grade;
    actions.push('GRADE_CHANGED');
  }

  if ('priceInr' in fields) {
    columns['price_paise'] = toPaise(fields['priceInr'], 'priceInr');
    actions.push('PRICE_CHANGED');
  }

  if ('categoryId' in fields) {
    const id = optionalString(fields, 'categoryId', 36);
    if (id !== null && !/^[0-9a-f-]{36}$/i.test(id)) {
      throw badRequest('That is not a category.', { categoryId: 'invalid' });
    }
    columns['category_id'] = id;
    actions.push('CATEGORY_CHANGED');
  }

  if ('certificationBody' in fields) {
    columns['certification_body'] = optionalString(fields, 'certificationBody', 120);
    actions.push('CERTIFICATION_CHANGED');
  }
  if ('certificationNumber' in fields) {
    columns['certification_number'] = optionalString(fields, 'certificationNumber', 120);
    actions.push('CERTIFICATION_CHANGED');
  }

  if ('state' in fields) {
    const state = oneOf(fields, 'state', EDITABLE_STATES);
    columns['state'] = state;
    actions.push(
      state === 'minted'
        ? 'LISTING_PUBLISHED'
        : state === 'withdrawn'
          ? 'LISTING_UNPUBLISHED'
          : 'STATE_CHANGED',
    );
  }

  if (Object.keys(columns).length === 0) {
    throw badRequest('Nothing to change.', { body: 'empty' });
  }

  columns['updated_at'] = new Date().toISOString();
  return { columns, actions: [...new Set(actions)] };
}

/**
 * Whether a listing may leave the state it is in.
 *
 * A reserved or sold listing has a buyer's money behind it. Editing its price
 * at that point changes what somebody has already agreed to pay, so it is
 * refused rather than audited — an audit trail records what happened, it does
 * not make it acceptable.
 */
export function assertEditable(state: string): void {
  if (state === 'reserved' || state === 'struck') {
    throw conflict(
      state === 'reserved'
        ? 'This item is reserved for a buyer part-way through paying. It cannot be edited until that clears.'
        : 'This item has been sold. Its record is part of an order and cannot be changed.',
    );
  }
}
