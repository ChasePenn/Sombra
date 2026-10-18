import webpush from "web-push";
import { dueMessages, type HeatAlert, type PushPayload } from "./push-schedule";
import type { PushStore, StoredSubscription } from "./push-store";

// Sends Web Push messages.

export type PushConfig = { publicKey: string; privateKey: string; subject: string };
export type SendResult = "sent" | "gone" | "failed";
export type Sender = (sub: StoredSubscription, payload: PushPayload & { lang: string }, options: { ttlSeconds: number; urgency: "normal" | "high" }) => Promise<SendResult>;

export function createWebPushSender(config: PushConfig, extra: { agent?: import("node:https").Agent } = {}): Sender {
  return async (sub, payload, { ttlSeconds, urgency }) => {
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        JSON.stringify(payload),
        { TTL: ttlSeconds, urgency, vapidDetails: config, timeout: 10_000, ...(extra.agent ? { agent: extra.agent } : {}) },
      );
      return "sent";
    } catch (error) {
      const status = (error as { statusCode?: number }).statusCode;
      // 404 and 410 mean the phone unsubscribed or the app was removed.
      return status === 404 || status === 410 ? "gone" : "failed";
    }
  };
}

// One pass over every subscription: send what's due, once.
export async function runPushRound({
  store,
  send,
  heatAlertFor,
  now = new Date(),
}: {
  store: Pick<PushStore, "listForRound" | "claim" | "release" | "markSent" | "recordFailure" | "resetFailures" | "deleteSubscription" | "prune">;
  send: Sender;
  heatAlertFor: (lat: number, lon: number) => Promise<HeatAlert | null>;
  now?: Date;
}) {
  const summary = { subscriptions: 0, sent: 0, failed: 0, removed: 0 };
  const items = await store.listForRound();
  summary.subscriptions = items.length;
  for (const { subscription, reminders, sent } of items) {
    let heat: HeatAlert | null = null;
    if (subscription.lat != null && subscription.lon != null) {
      heat = await heatAlertFor(subscription.lat, subscription.lon).catch(() => null);
    }
    for (const message of dueMessages({ now, reminders, sent, heatAlert: heat })) {
      if (!(await store.claim(subscription.id, message.dedupeKey))) continue;
      const result = await send(subscription, { ...message.payload, lang: subscription.language }, message);
      if (result === "gone") {
        await store.deleteSubscription(subscription.id);
        summary.removed += 1;
        break;
      }
      if (result === "sent") {
        await store.markSent(subscription.id, message.alsoMarkSent ?? []);
        await store.resetFailures(subscription.id);
        summary.sent += 1;
      } else {
        await store.release(subscription.id, message.dedupeKey);
        await store.recordFailure(subscription.id);
        summary.failed += 1;
      }
    }
  }
  await store.prune(now);
  return summary;
}
