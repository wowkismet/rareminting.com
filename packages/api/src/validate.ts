/**
 * Request validation.
 *
 * Hand-written rather than pulled from a schema library: the surface is small,
 * the messages need to be written for humans, and it keeps the dependency
 * footprint of a service that handles KYC data close to zero.
 */

import { badRequest } from './errors.ts';

export type Fields = Record<string, unknown>;

export function asObject(value: unknown): Fields {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw badRequest('Expected a JSON object.');
  }
  return value as Fields;
}

export function requiredString(fields: Fields, key: string, max = 500): string {
  const value = fields[key];
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw badRequest(`${key} is required.`, { [key]: 'required' });
  }
  if (value.length > max) {
    throw badRequest(`${key} must be ${max} characters or fewer.`, { [key]: 'too_long' });
  }
  return value.trim();
}

export function optionalString(fields: Fields, key: string, max = 500): string | null {
  const value = fields[key];
  if (value === undefined || value === null || value === '') return null;
  return requiredString(fields, key, max);
}

// Deliberately permissive. The authoritative check is that a verification mail
// arrives; over-strict patterns reject valid addresses.
const EMAIL = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;

export function email(fields: Fields, key = 'email'): string {
  const value = requiredString(fields, key, 320).toLowerCase();
  if (!EMAIL.test(value)) {
    throw badRequest('Enter a valid email address.', { [key]: 'invalid' });
  }
  return value;
}

const E164 = /^\+[1-9]\d{7,14}$/;

export function phone(fields: Fields, key = 'phone'): string {
  const value = requiredString(fields, key, 20).replace(/[\s-]/g, '');
  if (!E164.test(value)) {
    throw badRequest('Enter the number in international format, e.g. +919876543210.', {
      [key]: 'invalid',
    });
  }
  return value;
}

export const MIN_PASSWORD_LENGTH = 10;

/**
 * Length over composition rules. NIST dropped the "one uppercase, one symbol"
 * advice years ago; it pushes people towards predictable substitutions.
 */
export function password(fields: Fields, key = 'password'): string {
  const value = fields[key];
  if (typeof value !== 'string' || value.length === 0) {
    throw badRequest('Password is required.', { [key]: 'required' });
  }
  if (value.length < MIN_PASSWORD_LENGTH) {
    throw badRequest(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`, {
      [key]: 'too_short',
    });
  }
  if (value.length > 512) {
    throw badRequest('Password must be 512 characters or fewer.', { [key]: 'too_long' });
  }
  return value;
}

export function oneOf<T extends string>(
  fields: Fields,
  key: string,
  allowed: readonly T[],
): T {
  const value = requiredString(fields, key, 64);
  if (!(allowed as readonly string[]).includes(value)) {
    throw badRequest(`${key} must be one of: ${allowed.join(', ')}.`, { [key]: 'invalid' });
  }
  return value as T;
}
