import { randomBytes, timingSafeEqual } from "node:crypto";
import { Router, type Request, type Response } from "express";
import { parseReminders } from "../lib/push-schedule";
import { hashToken, pushStore, tokenMatches, type PushStore } from "../lib/push-store";
import { createWebPushSender, runPushRound, type PushConfig, type Sender } from "../lib/push-send";
import { ensurePushSchema, getPushConfig } from "../lib/push-setup";
import { heatAlertFor as liveHeatAlertFor } from "./conditions";

// Push reminders for phones, with or without an account.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const BASE64URL = /^[A-Za-z0-9_-]{16,200}={0,2}$/;

function validSubscription(value: unknown): { endpoint: string; p256dh: string; auth: string } | null {
  if (!value || typeof value !== "object") return null;
  const v = value as { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } };
  if (typeof v.endpoint !== "string" || v.endpoint.length > 1000) return null;
  try {
    if (new URL(v.endpoint).protocol !== "https:") return null;
  } catch {
    return null;
  }
  if (typeof v.keys?.p256dh !== "string" || !BASE64URL.test(v.keys.p256dh)) return null;
  if (typeof v.keys?.auth !== "string" || !BASE64URL.test(v.keys.auth)) return null;
  return { endpoint: v.endpoint, p256dh: v.keys.p256dh, auth: v.keys.auth };
}

const language = (value: unknown) => (value === "es" ? "es" : "en");
const roundCoord = (value: unknown, limit: number) =>
  typeof value === "number" && Number.isFinite(value) && Math.abs(value) <= limit ? Math.round(value * 100) / 100 : null;

export function createPushRouter(dependencies: {
  store?: Pick<PushStore, keyof PushStore>;
  config?: PushConfig | null;
  getConfig?: () => Promise<PushConfig | null>;
  ensureSchema?: () => Promise<void>;
  send?: Sender;
  heatAlertFor?: typeof liveHeatAlertFor;
  cronSecret?: string | null;
  now?: () => Date;
} = {}) {
  const router = Router();
  const store = dependencies.store ?? pushStore;
  const getConfig = dependencies.config !== undefined
    ? async () => dependencies.config ?? null
    : dependencies.getConfig ?? getPushConfig;
  const ensureSchema = dependencies.ensureSchema ?? (dependencies.store ? async () => {} : ensurePushSchema);
  const heatAlertFor = dependencies.heatAlertFor ?? liveHeatAlertFor;
  const cronSecret = dependencies.cronSecret === undefined ? process.env.PUSH_CRON_SECRET?.trim() || null : dependencies.cronSecret;
  const now = dependencies.now ?? (() => new Date());

  // One sender per signing key (keys never change while running, but tests swap them).
  const senders = new Map<string, Sender>();
  const senderFor = (config: PushConfig) => {
    if (dependencies.send) return dependencies.send;
    if (!senders.has(config.publicKey)) senders.set(config.publicKey, createWebPushSender(config));
    return senders.get(config.publicKey)!;
  };
  const currentConfig = async () => {
    try {
      return await getConfig();
    } catch {
      return null;
    }
  };

  const notConfigured = (res: Response) =>
    res.status(503).json({ error: "Reminders when sombra is closed aren't available right now. Try again later." });

  // Make sure the push tables exist before any push request touches them.
  router.use("/push", (req, res, next) => {
    ensureSchema().then(() => next(), () => notConfigured(res));
  });

  /** Checks the id and secret token; answers for the caller if they're wrong. */
  async function authorized(req: Request, res: Response): Promise<string | null> {
    const { id, token } = (req.body ?? {}) as { id?: unknown; token?: unknown };
    if (typeof id !== "string" || !UUID.test(id)) {
      res.status(400).json({ error: "Missing reminder id." });
      return null;
    }
    const hash = await store.getTokenHash(id);
    if (!hash) {
      // The phone should forget this id and subscribe again.
      res.status(404).json({ error: "These reminders were turned off. Turn them on again." });
      return null;
    }
    if (!tokenMatches(token, hash)) {
      res.status(403).json({ error: "Not allowed." });
      return null;
    }
    return id;
  }

  router.get("/push/key", async (_req, res) => {
    const config = await currentConfig();
    if (!config) return void notConfigured(res);
    res.json({ publicKey: config.publicKey });
  });

  router.post("/push/subscribe", async (req, res) => {
    if (!(await currentConfig())) return void notConfigured(res);
    const subscription = validSubscription(req.body?.subscription);
    if (!subscription) return void res.status(400).json({ error: "That browser's push details weren't valid." });
    const token = randomBytes(32).toString("base64url");
    const id = await store.upsertSubscription({ ...subscription, tokenHash: hashToken(token), language: language(req.body?.language) });
    res.status(201).json({ id, token });
  });

  router.put("/push/schedule", async (req, res) => {
    const id = await authorized(req, res);
    if (!id) return;
    const reminders = parseReminders(req.body?.reminders ?? []);
    if (!reminders) return void res.status(400).json({ error: "Those reminder times weren't valid." });
    await store.replaceSchedule(id, {
      language: language(req.body?.language),
      lat: roundCoord(req.body?.lat, 90),
      lon: roundCoord(req.body?.lon, 180),
      reminders,
    });
    res.json({ ok: true, reminders: reminders.length });
  });

  router.delete("/push/subscribe", async (req, res) => {
    const id = await authorized(req, res);
    if (!id) return;
    await store.deleteSubscription(id);
    res.json({ ok: true });
  });

  router.post("/push/test", async (req, res) => {
    const config = await currentConfig();
    if (!config) return void notConfigured(res);
    const id = await authorized(req, res);
    if (!id) return;
    const subscription = await store.getSubscription(id);
    if (!subscription) return void res.status(404).json({ error: "These reminders were turned off. Turn them on again." });
    const result = await senderFor(config)(subscription, { type: "test", lang: subscription.language }, { ttlSeconds: 300, urgency: "high" });
    if (result === "gone") {
      await store.deleteSubscription(id);
      return void res.status(404).json({ error: "This phone stopped accepting notifications. Turn them on again." });
    }
    if (result === "failed") return void res.status(502).json({ error: "The push service didn't accept the test. Try again in a minute." });
    res.json({ ok: true });
  });

  router.post("/push/run", async (req, res) => {
    if (cronSecret) {
      const given = req.get("x-push-cron") ?? "";
      if (given.length !== cronSecret.length || !timingSafeEqual(Buffer.from(given), Buffer.from(cronSecret))) {
        return void res.status(404).json({ error: "Not found." });
      }
    }
    const config = await currentConfig();
    if (!config) return void notConfigured(res);
    const summary = await runPushRound({ store, send: senderFor(config), heatAlertFor, now: now() });
    res.json(summary);
  });

  return router;
}

/** Runs a round every minute while this server is awake (it may sleep between requests). */
export function startPushTimer(log: { info: (o: object, m: string) => void; error: (o: object, m: string) => void }) {
  let running = false;
  let send: Sender | null = null;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const config = await getPushConfig();
      send ??= createWebPushSender(config);
      const summary = await runPushRound({ store: pushStore, send, heatAlertFor: liveHeatAlertFor });
      if (summary.sent || summary.failed || summary.removed) log.info(summary, "Push round");
    } catch (err) {
      log.error({ err }, "Push round failed");
    } finally {
      running = false;
    }
  };
  setTimeout(tick, 5_000);
  return setInterval(tick, 60_000);
}

export default createPushRouter();
