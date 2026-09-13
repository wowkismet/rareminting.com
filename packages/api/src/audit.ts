/**
 * The audit trail.
 *
 * `audit_logs` is append-only at the database level rather than by convention:
 * a trigger refuses updates and deletes, so a record of what somebody did
 * cannot be quietly tidied away afterwards by the person who did it.
 *
 * This lived inside the admin routes, which was fine while staff were the only
 * people who could change anything they did not own. Sellers can now edit
 * their own listings, and a marketplace dispute turns on who changed a price
 * and when — so both write here, distinguished by `actor_role` rather than by
 * being in separate tables.
 */

import type { Ctx } from './http.ts';

/** Matches the user_role enum. */
export type ActorRole = 'buyer' | 'seller' | 'admin' | 'support' | 'grievance_officer';

/**
 * Record one change.
 *
 * `before` and `after` are stored whole rather than as a diff. Working out
 * what changed from two snapshots is easy later; recovering a value that was
 * never written down is not.
 *
 * Deliberately not transactional with its caller. An audit write that fails
 * must not roll back the change it describes — losing the record is bad, and
 * losing the seller's edit as well is worse.
 */
export async function audit(
  ctx: Ctx,
  actorId: string,
  role: ActorRole,
  action: string,
  entityType: string,
  entityId: string,
  before: unknown,
  after: unknown,
): Promise<void> {
  await ctx.db.query(
    `insert into audit_logs (actor_id, actor_role, action, entity_type, entity_id,
                             before, after, ip, user_agent)
     values ($1::uuid, $2::user_role, $3, $4, $5, $6::jsonb, $7::jsonb, $8::inet, $9)`,
    [
      actorId,
      role,
      action,
      entityType,
      entityId,
      JSON.stringify(before ?? null),
      JSON.stringify(after ?? null),
      ctx.ip,
      ctx.userAgent,
    ],
  );
}

/**
 * Record several named actions against one change.
 *
 * An edit that touches a price and a description is one write by one person at
 * one moment, but somebody searching the log later looks for PRICE_CHANGED.
 * Writing a row per action makes that search work; they share the same before
 * and after, so the full picture is on any one of them.
 */
export async function auditAll(
  ctx: Ctx,
  actorId: string,
  role: ActorRole,
  actions: readonly string[],
  entityType: string,
  entityId: string,
  before: unknown,
  after: unknown,
): Promise<void> {
  for (const action of actions) {
    await audit(ctx, actorId, role, action, entityType, entityId, before, after);
  }
}
