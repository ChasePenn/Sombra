import { createHash, timingSafeEqual } from "node:crypto";
import { and, eq, inArray, lt, sql } from "drizzle-orm";
import { db, pushRemindersTable, pushSentTable, pushSubscriptionsTable } from "@workspace/db";
import type { PushReminder } from "./push-schedule";

export type StoredSubscription = {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  language: string;
  lat: number | null;
  lon: number | null;
};

export type PushStore = typeof pushStore;

export const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

export function tokenMatches(token: unknown, hash: string) {
  if (typeof token !== "string" || token.length < 20 || token.length > 200) return false;
  const a = Buffer.from(hashToken(token));
  const b = Buffer.from(hash);
  return a.length === b.length && timingSafeEqual(a, b);
}

export const pushStore = {
  /** Same phone subscribing again replaces its token, so a reinstall takes over cleanly. */
  async upsertSubscription(input: { endpoint: string; p256dh: string; auth: string; tokenHash: string; language: string }) {
    const [row] = await db
      .insert(pushSubscriptionsTable)
      .values(input)
      .onConflictDoUpdate({
        target: pushSubscriptionsTable.endpoint,
        set: { p256dh: input.p256dh, auth: input.auth, tokenHash: input.tokenHash, language: input.language, failures: 0, updatedAt: new Date() },
      })
      .returning({ id: pushSubscriptionsTable.id });
    return row.id;
  },

  async getTokenHash(id: string) {
    const [row] = await db.select({ tokenHash: pushSubscriptionsTable.tokenHash }).from(pushSubscriptionsTable).where(eq(pushSubscriptionsTable.id, id)).limit(1);
    return row?.tokenHash ?? null;
  },

  async getSubscription(id: string): Promise<StoredSubscription | null> {
    const [row] = await db.select().from(pushSubscriptionsTable).where(eq(pushSubscriptionsTable.id, id)).limit(1);
    return row ? { id: row.id, endpoint: row.endpoint, p256dh: row.p256dh, auth: row.auth, language: row.language, lat: row.lat, lon: row.lon } : null;
  },

  async deleteSubscription(id: string) {
    await db.delete(pushSubscriptionsTable).where(eq(pushSubscriptionsTable.id, id));
  },

  async replaceSchedule(id: string, schedule: { language: string; lat: number | null; lon: number | null; reminders: PushReminder[] }) {
    await db.transaction(async (tx) => {
      await tx.update(pushSubscriptionsTable)
        .set({ language: schedule.language, lat: schedule.lat, lon: schedule.lon, updatedAt: new Date() })
        .where(eq(pushSubscriptionsTable.id, id));
      await tx.delete(pushRemindersTable).where(eq(pushRemindersTable.subscriptionId, id));
      if (schedule.reminders.length) {
        await tx.insert(pushRemindersTable).values(schedule.reminders.map((r) => ({
          subscriptionId: id,
          kind: r.kind,
          key: r.key,
          timeLocal: r.timeLocal ?? null,
          fireAt: r.fireAt ?? null,
          doneAt: r.doneAt ?? null,
        })));
      }
    });
  },

  /** Every subscription with its reminders, for one scheduler round. */
  async listForRound() {
    const subs = await db.select().from(pushSubscriptionsTable);
    if (!subs.length) return [];
    const reminders = await db.select().from(pushRemindersTable).where(inArray(pushRemindersTable.subscriptionId, subs.map((s) => s.id)));
    const sent = await db.select().from(pushSentTable).where(inArray(pushSentTable.subscriptionId, subs.map((s) => s.id)));
    return subs.map((s) => ({
      subscription: { id: s.id, endpoint: s.endpoint, p256dh: s.p256dh, auth: s.auth, language: s.language, lat: s.lat, lon: s.lon },
      reminders: reminders.filter((r) => r.subscriptionId === s.id).map((r) => ({
        kind: r.kind as PushReminder["kind"], key: r.key, timeLocal: r.timeLocal, fireAt: r.fireAt, doneAt: r.doneAt,
      })),
      sent: new Set(sent.filter((x) => x.subscriptionId === s.id).map((x) => x.dedupeKey)),
    }));
  },

  /**
   * Claims a message before sending it. Only one server (or one overlapping round) can
   * claim a given reminder, so nobody gets the same notification twice.
   */
  async claim(id: string, dedupeKey: string) {
    const rows = await db.insert(pushSentTable).values({ subscriptionId: id, dedupeKey }).onConflictDoNothing().returning({ key: pushSentTable.dedupeKey });
    return rows.length > 0;
  },

  /** Gives a claim back after a failed send, so the next round retries it. */
  async release(id: string, dedupeKey: string) {
    await db.delete(pushSentTable).where(and(eq(pushSentTable.subscriptionId, id), eq(pushSentTable.dedupeKey, dedupeKey)));
  },

  async markSent(id: string, keys: string[]) {
    if (!keys.length) return;
    await db.insert(pushSentTable).values(keys.map((dedupeKey) => ({ subscriptionId: id, dedupeKey }))).onConflictDoNothing();
  },

  async recordFailure(id: string) {
    await db.update(pushSubscriptionsTable).set({ failures: sql`${pushSubscriptionsTable.failures} + 1` }).where(eq(pushSubscriptionsTable.id, id));
  },

  async resetFailures(id: string) {
    await db.update(pushSubscriptionsTable).set({ failures: 0 }).where(and(eq(pushSubscriptionsTable.id, id), sql`${pushSubscriptionsTable.failures} > 0`));
  },

  /** Drop old sent records and finished one-off reminders. */
  async prune(now: Date) {
    await db.delete(pushSentTable).where(lt(pushSentTable.sentAt, new Date(now.getTime() - 3 * 86_400_000)));
    await db.delete(pushRemindersTable).where(and(eq(pushRemindersTable.kind, "window"), lt(pushRemindersTable.fireAt, new Date(now.getTime() - 86_400_000))));
    // A phone whose pushes keep failing (but wasn't reported gone) is dropped after 20 tries.
    await db.delete(pushSubscriptionsTable).where(sql`${pushSubscriptionsTable.failures} >= 20`);
  },
};
