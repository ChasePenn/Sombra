// Needs a TEST database: DATABASE_URL=postgres://...
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { unlink } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";
import test, { after } from "node:test";

const dir = path.dirname(fileURLToPath(import.meta.url));
const bundle = path.join(dir, ".push-store.db-test.mjs");
await build({
  stdin: { contents: 'export { pushStore, hashToken } from "../src/lib/push-store.ts"; export { ensurePushSchema, getPushConfig, resetPushSetupForTests } from "../src/lib/push-setup.ts"; export { pool } from "@workspace/db";', resolveDir: dir, loader: "ts" },
  bundle: true, platform: "node", format: "esm", outfile: bundle, logLevel: "silent",
  banner: { js: 'import { createRequire } from "node:module"; const require = createRequire(import.meta.url);' },
});
const { pushStore, hashToken, pool, ensurePushSchema, getPushConfig, resetPushSetupForTests } = await import(pathToFileURL(bundle).href);
after(async () => { await pool.end(); await unlink(bundle).catch(() => {}); });

test("zero setup: on a database without push tables, the server creates them and its own keys once", async () => {
  delete process.env.VAPID_PUBLIC_KEY;
  delete process.env.VAPID_PRIVATE_KEY;
  await pool.query("DROP TABLE IF EXISTS push_sent, push_reminders, push_subscriptions, app_settings CASCADE");
  resetPushSetupForTests();
  // Two servers starting at once.
  await Promise.all([ensurePushSchema(), ensurePushSchema()]);
  const [a, b] = await Promise.all([getPushConfig(), getPushConfig()]);
  assert.equal(a.publicKey, b.publicKey);
  assert.match(a.publicKey, /^[A-Za-z0-9_-]{80,90}$/, "a real P-256 public key");
  // Keys survive a restart.
  resetPushSetupForTests();
  assert.equal((await getPushConfig()).publicKey, a.publicKey);
  const { rows } = await pool.query("select count(*)::int as n from app_settings where key = 'vapid'");
  assert.equal(rows[0].n, 1);
  // Running the setup again changes nothing.
  resetPushSetupForTests();
  await ensurePushSchema();
});

test("keys from the environment take priority over saved ones", async () => {
  process.env.VAPID_PUBLIC_KEY = "BEnvPublicKeyForTest";
  process.env.VAPID_PRIVATE_KEY = "envPrivateKeyForTest";
  try {
    assert.equal((await getPushConfig()).publicKey, "BEnvPublicKeyForTest");
  } finally {
    delete process.env.VAPID_PUBLIC_KEY;
    delete process.env.VAPID_PRIVATE_KEY;
  }
});

const endpoint = () => `https://push.example/${randomBytes(8).toString("hex")}`;
const keys = { p256dh: "B".repeat(87), auth: "A".repeat(22) };

test("subscriptions, schedules and claims behave the same in Postgres", async () => {
  const ep = endpoint();
  const id = await pushStore.upsertSubscription({ endpoint: ep, ...keys, tokenHash: hashToken("first-token-aaaaaaaaaaaaaa"), language: "en" });
  const again = await pushStore.upsertSubscription({ endpoint: ep, ...keys, tokenHash: hashToken("second-token-bbbbbbbbbbbbb"), language: "es" });
  assert.equal(again, id, "the same phone keeps its id");
  assert.equal(await pushStore.getTokenHash(id), hashToken("second-token-bbbbbbbbbbbbb"), "and its new token replaces the old one");

  await pushStore.replaceSchedule(id, { language: "es", lat: 33.45, lon: -112.07, reminders: [
    { kind: "care", key: "c-1", timeLocal: "09:00", doneAt: null },
    { kind: "window", key: "w-1", fireAt: new Date("2026-10-12T13:00:00Z") },
  ] });
  await pushStore.replaceSchedule(id, { language: "es", lat: 33.45, lon: -112.07, reminders: [{ kind: "care", key: "c-2", timeLocal: "10:00", doneAt: null }] });
  const mine = (await pushStore.listForRound()).find((item) => item.subscription.id === id);
  assert.deepEqual(mine.reminders.map((r) => r.key), ["c-2"], "a new schedule replaces the old one");
  assert.equal(mine.subscription.language, "es");

  assert.equal(await pushStore.claim(id, "care:c-2:2026-10-12:first"), true);
  assert.equal(await pushStore.claim(id, "care:c-2:2026-10-12:first"), false, "a second claim (another server, an overlapping round) loses");
  await pushStore.release(id, "care:c-2:2026-10-12:first");
  assert.equal(await pushStore.claim(id, "care:c-2:2026-10-12:first"), true, "after a failed send it can be claimed again");

  await pushStore.deleteSubscription(id);
  assert.equal(await pushStore.getTokenHash(id), null);
  const { rows } = await pool.query("select count(*)::int as n from push_reminders where subscription_id = $1", [id]);
  assert.equal(rows[0].n, 0, "deleting a phone deletes its reminders too");
});

test("pruning drops old sent records, finished one-off reminders and phones that keep failing", async () => {
  const id = await pushStore.upsertSubscription({ endpoint: endpoint(), ...keys, tokenHash: hashToken("prune-token-ccccccccccccccc"), language: "en" });
  const now = new Date("2026-10-20T12:00:00Z");
  await pushStore.replaceSchedule(id, { language: "en", lat: null, lon: null, reminders: [
    { kind: "window", key: "old", fireAt: new Date("2026-10-18T12:00:00Z") },
    { kind: "window", key: "soon", fireAt: new Date("2026-10-20T15:00:00Z") },
  ] });
  await pool.query("insert into push_sent (subscription_id, dedupe_key, sent_at) values ($1, 'old-key', $2)", [id, new Date("2026-10-10T00:00:00Z")]);
  await pushStore.prune(now);
  const item = (await pushStore.listForRound()).find((x) => x.subscription.id === id);
  assert.deepEqual(item.reminders.map((r) => r.key), ["soon"]);
  assert.equal(item.sent.has("old-key"), false);
  for (let i = 0; i < 20; i += 1) await pushStore.recordFailure(id);
  await pushStore.prune(now);
  assert.equal(await pushStore.getTokenHash(id), null);
});
