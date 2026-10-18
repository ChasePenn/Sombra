import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createECDH, randomBytes, randomUUID } from "node:crypto";
import { once } from "node:events";
import { mkdtemp, readFile, rm, unlink } from "node:fs/promises";
import https from "node:https";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import express from "express";
import { build } from "esbuild";
import test, { after } from "node:test";

const require = createRequire(import.meta.url);
const webpush = require("web-push");
const ece = createRequire(require.resolve("web-push"))("http_ece");

// The routes import the database module, which only checks that a URL is set.
process.env.DATABASE_URL ??= "postgres://unused:unused@127.0.0.1:1/unused";
const dir = path.dirname(fileURLToPath(import.meta.url));
const bundle = path.join(dir, ".push-routes.test-bundle.mjs");
await build({
  stdin: {
    contents: 'export { createPushRouter } from "../src/routes/push.ts"; export { createWebPushSender, runPushRound } from "../src/lib/push-send.ts"; export { hashToken } from "../src/lib/push-store.ts";',
    resolveDir: dir, loader: "ts",
  },
  bundle: true, platform: "node", format: "esm", outfile: bundle, external: ["express", "web-push"], logLevel: "silent",
  banner: { js: 'import { createRequire } from "node:module"; const require = createRequire(import.meta.url);' },
});
const { createPushRouter, createWebPushSender, hashToken } = await import(`${pathToFileURL(bundle).href}?t=${Date.now()}`);
after(() => unlink(bundle).catch(() => {}));

/** In-memory stand-in for the Postgres push store, with the same behavior. */
function memoryStore() {
  const subs = new Map();
  const reminders = new Map();
  const sent = new Map();
  return {
    subs, reminders, sent,
    async upsertSubscription(input) {
      const existing = [...subs.values()].find((s) => s.endpoint === input.endpoint);
      const id = existing?.id ?? randomUUID();
      subs.set(id, { id, lat: null, lon: null, failures: 0, ...existing, ...input });
      return id;
    },
    async getTokenHash(id) { return subs.get(id)?.tokenHash ?? null; },
    async getSubscription(id) { return subs.get(id) ?? null; },
    async deleteSubscription(id) { subs.delete(id); reminders.delete(id); sent.delete(id); },
    async replaceSchedule(id, s) { Object.assign(subs.get(id), { language: s.language, lat: s.lat, lon: s.lon }); reminders.set(id, s.reminders); },
    async listForRound() {
      return [...subs.values()].map((s) => ({ subscription: s, reminders: reminders.get(s.id) ?? [], sent: new Set(sent.get(s.id) ?? []) }));
    },
    async claim(id, key) { const set = sent.get(id) ?? new Set(); if (set.has(key)) return false; set.add(key); sent.set(id, set); return true; },
    async release(id, key) { sent.get(id)?.delete(key); },
    async markSent(id, keys) { const set = sent.get(id) ?? new Set(); keys.forEach((k) => set.add(k)); sent.set(id, set); },
    async recordFailure(id) { subs.get(id).failures += 1; },
    async resetFailures(id) { if (subs.get(id)) subs.get(id).failures = 0; },
    async prune() {},
  };
}

const vapid = webpush.generateVAPIDKeys();
const config = { publicKey: vapid.publicKey, privateKey: vapid.privateKey, subject: "https://github.com/ChasePenn/sombra" };

async function serve(router) {
  const app = express();
  app.use(express.json());
  app.use("/api", router);
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const base = `http://127.0.0.1:${server.address().port}/api`;
  const call = async (method, route, body, headers = {}) => {
    const res = await fetch(`${base}${route}`, { method, headers: { "Content-Type": "application/json", ...headers }, body: body ? JSON.stringify(body) : undefined });
    return { status: res.status, body: await res.json().catch(() => null) };
  };
  return { server, call };
}

/** A phone's push keys, made the way a browser makes them. */
function phoneKeys() {
  const ecdh = createECDH("prime256v1");
  ecdh.generateKeys();
  const auth = randomBytes(16);
  return { ecdh, auth, keys: { p256dh: ecdh.getPublicKey().toString("base64url"), auth: auth.toString("base64url") } };
}

test("without server keys the feature says it isn't set up", async () => {
  const { server, call } = await serve(createPushRouter({ store: memoryStore(), config: null, cronSecret: null }));
  try {
    assert.equal((await call("GET", "/push/key")).status, 503);
    assert.equal((await call("POST", "/push/subscribe", { subscription: {} })).status, 503);
  } finally { server.close(); }
});

test("subscribe, schedule with the secret token, and only the token can change it", async () => {
  const store = memoryStore();
  const { server, call } = await serve(createPushRouter({ store, config, cronSecret: null, send: async () => "sent" }));
  try {
    assert.equal((await call("GET", "/push/key")).body.publicKey, vapid.publicKey);
    const { keys } = phoneKeys();
    assert.equal((await call("POST", "/push/subscribe", { subscription: { endpoint: "http://insecure.example/x", keys } })).status, 400, "push endpoints must be HTTPS");
    const sub = await call("POST", "/push/subscribe", { subscription: { endpoint: "https://push.example/abc", keys }, language: "es" });
    assert.equal(sub.status, 201);
    const { id, token } = sub.body;
    assert.notEqual(store.subs.get(id).tokenHash, token, "the token itself is never stored");
    assert.equal(store.subs.get(id).tokenHash, hashToken(token));

    const schedule = { id, token, language: "es", lat: 33.448376, lon: -112.074036, reminders: [{ kind: "care", key: "c-1", time: "09:00" }, { kind: "window", key: "w-1", at: "2026-10-12T06:00:00-07:00" }] };
    assert.equal((await call("PUT", "/push/schedule", { ...schedule, token: "x".repeat(43) })).status, 403);
    assert.equal((await call("PUT", "/push/schedule", { ...schedule, id: randomUUID() })).status, 404);
    assert.equal((await call("PUT", "/push/schedule", { ...schedule, reminders: [{ kind: "care", key: "Grandma Rosa", time: "09:00" }] })).status, 400);
    const ok = await call("PUT", "/push/schedule", schedule);
    assert.equal(ok.status, 200);
    assert.equal(ok.body.reminders, 2);
    assert.equal(store.subs.get(id).lat, 33.45, "location is rounded to about 1 km");
    assert.equal(store.subs.get(id).lon, -112.07);

    assert.equal((await call("DELETE", "/push/subscribe", { id, token: "y".repeat(43) })).status, 403);
    assert.equal((await call("DELETE", "/push/subscribe", { id, token })).status, 200);
    assert.equal(store.subs.size, 0);
  } finally { server.close(); }
});

test("the scheduler endpoint is hidden without the secret, sends each reminder once, and drops dead phones", async () => {
  const store = memoryStore();
  const sentTo = [];
  let reply = "sent";
  const send = async (sub, payload) => { sentTo.push({ endpoint: sub.endpoint, payload }); return reply; };
  const now = () => new Date("2026-10-12T09:05:00-07:00");
  const { server, call } = await serve(createPushRouter({ store, config, send, cronSecret: "c".repeat(32), now, heatAlertFor: async () => null }));
  try {
    const { keys } = phoneKeys();
    const { id, token } = (await call("POST", "/push/subscribe", { subscription: { endpoint: "https://push.example/1", keys } })).body;
    await call("PUT", "/push/schedule", { id, token, reminders: [{ kind: "care", key: "c-1", time: "09:00" }] });

    assert.equal((await call("POST", "/push/run")).status, 404);
    assert.equal((await call("POST", "/push/run", null, { "x-push-cron": "wrong" })).status, 404);
    const first = await call("POST", "/push/run", null, { "x-push-cron": "c".repeat(32) });
    assert.deepEqual(first.body, { subscriptions: 1, sent: 1, failed: 0, removed: 0 });
    assert.deepEqual(sentTo[0].payload, { type: "care", key: "c-1", stage: "first", lang: "en" });
    const again = await call("POST", "/push/run", null, { "x-push-cron": "c".repeat(32) });
    assert.equal(again.body.sent, 0, "never twice");

    reply = "gone";
    const testPush = await call("POST", "/push/test", { id, token });
    assert.equal(testPush.status, 404, "an unsubscribed phone is forgotten");
    assert.equal(store.subs.size, 0);
  } finally { server.close(); }
});

test("with no secret configured, the scheduler endpoint is open but can't send anything twice", async () => {
  const store = memoryStore();
  let sends = 0;
  const now = () => new Date("2026-10-12T09:05:00-07:00");
  const { server, call } = await serve(createPushRouter({ store, config, send: async () => { sends += 1; return "sent"; }, cronSecret: null, now, heatAlertFor: async () => null }));
  try {
    const { keys } = phoneKeys();
    const { id, token } = (await call("POST", "/push/subscribe", { subscription: { endpoint: "https://push.example/open", keys } })).body;
    await call("PUT", "/push/schedule", { id, token, reminders: [{ kind: "care", key: "c-1", time: "09:00" }] });
    for (let i = 0; i < 5; i += 1) assert.equal((await call("POST", "/push/run")).status, 200);
    assert.equal(sends, 1, "five calls, one notification");
  } finally { server.close(); }
});

test("a failed send is retried next round instead of being lost", async () => {
  const store = memoryStore();
  let reply = "failed";
  const send = async () => reply;
  const now = () => new Date("2026-10-12T09:05:00-07:00");
  const { server, call } = await serve(createPushRouter({ store, config, send, cronSecret: "s".repeat(32), now, heatAlertFor: async () => null }));
  try {
    const { keys } = phoneKeys();
    const { id, token } = (await call("POST", "/push/subscribe", { subscription: { endpoint: "https://push.example/2", keys } })).body;
    await call("PUT", "/push/schedule", { id, token, reminders: [{ kind: "care", key: "c-1", time: "09:00" }] });
    assert.equal((await call("POST", "/push/run", null, { "x-push-cron": "s".repeat(32) })).body.failed, 1);
    reply = "sent";
    assert.equal((await call("POST", "/push/run", null, { "x-push-cron": "s".repeat(32) })).body.sent, 1);
  } finally { server.close(); }
});

test("real delivery: the message is encrypted for the phone and signed with the server key", async () => {
  // A stand-in push service on HTTPS, like Google's or Apple's, that records what arrives.
  const tmp = await mkdtemp(path.join(os.tmpdir(), "sombra-push-"));
  execFileSync("openssl", ["req", "-x509", "-newkey", "ec", "-pkeyopt", "ec_paramgen_curve:prime256v1", "-nodes", "-subj", "/CN=localhost",
    "-days", "1", "-keyout", path.join(tmp, "key.pem"), "-out", path.join(tmp, "cert.pem")], { stdio: "ignore" });
  const received = [];
  const pushService = https.createServer({ key: await readFile(path.join(tmp, "key.pem")), cert: await readFile(path.join(tmp, "cert.pem")) }, (req, res) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => { received.push({ headers: req.headers, body: Buffer.concat(chunks) }); res.writeHead(201); res.end(); });
  });
  pushService.listen(0, "127.0.0.1");
  await once(pushService, "listening");
  try {
    const phone = phoneKeys();
    const endpoint = `https://127.0.0.1:${pushService.address().port}/send/phone-1`;
    // Test-only: trust the stand-in's self-signed certificate.
    const send = createWebPushSender(config, { agent: new https.Agent({ rejectUnauthorized: false }) });
    const result = await send({ id: "x", endpoint, p256dh: phone.keys.p256dh, auth: phone.keys.auth, language: "en", lat: null, lon: null },
      { type: "care", key: "c-1", stage: "first", lang: "en" }, { ttlSeconds: 7200, urgency: "high" });
    assert.equal(result, "sent");
    const [msg] = received;
    assert.equal(msg.headers["content-encoding"], "aes128gcm");
    assert.equal(msg.headers.ttl, "7200");
    assert.equal(msg.headers.urgency, "high");
    assert.doesNotMatch(msg.body.toString("latin1"), /c-1|care/, "the push service can't read the message");

    // Only the phone, with its private key, can decrypt it.
    const plain = ece.decrypt(msg.body, { version: "aes128gcm", privateKey: phone.ecdh, authSecret: phone.auth.toString("base64url") });
    assert.deepEqual(JSON.parse(plain.toString()), { type: "care", key: "c-1", stage: "first", lang: "en" });

    // VAPID: a signed token naming the push service as audience and sombra as the sender.
    const auth = msg.headers.authorization;
    assert.match(auth, /^vapid t=.+, k=/);
    const jwt = auth.match(/t=([^,]+)/)[1];
    const claims = JSON.parse(Buffer.from(jwt.split(".")[1], "base64url").toString());
    assert.equal(claims.aud, `https://127.0.0.1:${pushService.address().port}`);
    assert.equal(claims.sub, config.subject);
    assert.ok(claims.exp > Date.now() / 1000);
    assert.equal(auth.match(/k=(.+)$/)[1], config.publicKey);
  } finally {
    pushService.close();
    await rm(tmp, { recursive: true, force: true });
  }
});
