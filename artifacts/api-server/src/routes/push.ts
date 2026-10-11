import { randomBytes, timingSafeEqual } from "node:crypto";
import { Router, type Request, type Response } from "express";
import { parseReminders } from "../lib/push-schedule";
import { hashToken, pushStore, tokenMatches, type PushStore } from "../lib/push-store";
import { createWebPushSender, pushConfigFromEnv, runPushRound, type PushConfig, type Sender } from "../lib/push-send";
import { heatAlertFor as liveHeatAlertFor } from "./conditions";

/*
  Push reminders for phones, with or without an account. A phone subscribes and gets back
  an id and a secret token; only that token can change or remove its schedule.

  POST   /push/subscribe   { subscription, language }            -> { id, token }
  PUT    /push/schedule    { id, token, language, lat, lon, reminders }
  DELETE /push/subscribe   { id, token }
  POST   /push/test        { id, token }                          sends a test notification now
  POST   /push/run         header x-push-cron: <PUSH_CRON_SECRET>  sends everything that's due
*/

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
  send?: Sender;
  heatAlertFor?: typeof liveHeatAlertFor;
  cronSecret?: string | null;
  now?: () => Date;
} = {}) {
  const router = Router();
  const store = dependencies.store ?? pushStore;
  const config = dependencies.config === undefined ? pushConfigFromEnv() : dependencies.config;
  const send = dependencies.send ?? (config ? createWebPushSender(config) : null);
  const heatAlertFor = dependencies.heatAlertFor ?? liveHeatAlertFor;
  const cronSecret = dependencies.cronSecret === undefined ? process.env.PUSH_CRON_SECRET?.trim() || null : dependencies.cronSecret;
  const now = dependencies.now ?? (() => new Date());

  const notConfigured = (res: Response) =>
    res.status(503).json({ error: "Reminders when sombra is closed aren't set up on this server yet." });

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

  router.get("/push/key", (_req, res) => {
    if (!config) return void notConfigured(res);
    res.json({ publicKey: config.publicKey });
  });

  router.post("/push/subscribe", async (req, res) => {
    if (!config) return void notConfigured(res);
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
    if (!config || !send) return void notConfigured(res);
    const id = await authorized(req, res);
    if (!id) return;
    const subscription = await store.getSubscription(id);
    if (!subscription) return void res.status(404).json({ error: "These reminders were turned off. Turn them on again." });
    const result = await send(subscription, { type: "test", lang: subscription.language }, { ttlSeconds: 300, urgency: "high" });
    if (result === "gone") {
      await store.deleteSubscription(id);
      return void res.status(404).json({ error: "This phone stopped accepting notifications. Turn them on again." });
    }
    if (result === "failed") return void res.status(502).json({ error: "The push service didn't accept the test. Try again in a minute." });
    res.json({ ok: true });
  });

  router.post("/push/run", async (req, res) => {
    const given = req.get("x-push-cron") ?? "";
    // Without a configured secret this endpoint doesn't exist from the outside.
    if (!cronSecret || given.length !== cronSecret.length || !timingSafeEqual(Buffer.from(given), Buffer.from(cronSecret))) {
      return void res.status(404).json({ error: "Not found." });
    }
    if (!config || !send) return void notConfigured(res);
    const summary = await runPushRound({ store, send, heatAlertFor, now: now() });
    res.json(summary);
  });

  return router;
}

/** Runs a round every minute while this server is awake (it may sleep between requests). */
export function startPushTimer(log: { info: (o: object, m: string) => void; error: (o: object, m: string) => void }) {
  const config = pushConfigFromEnv();
  if (!config) return null;
  const send = createWebPushSender(config);
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const summary = await runPushRound({ store: pushStore, send, heatAlertFor: liveHeatAlertFor });
      if (summary.sent || summary.failed || summary.removed) log.info(summary, "Push round");
    } catch (err) {
      log.error({ err }, "Push round failed");
    } finally {
      running = false;
    }
  };
  return setInterval(tick, 60_000);
}

export default createPushRouter();
