import assert from "node:assert/strict";
import { unlink } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";
import test, { after } from "node:test";

const dir = path.dirname(fileURLToPath(import.meta.url));
const bundle = path.join(dir, ".push-schedule.test-bundle.mjs");
await build({ entryPoints: [path.resolve(dir, "../src/lib/push-schedule.ts")], bundle: true, platform: "node", format: "esm", outfile: bundle, logLevel: "silent" });
const { dueMessages, parseReminders, phoenixParts } = await import(`${pathToFileURL(bundle).href}?t=${Date.now()}`);
after(() => unlink(bundle).catch(() => {}));

// Arizona is UTC-7 all year, so 09:00 in Phoenix is 16:00 UTC.
const az = (date, time) => new Date(`${date}T${time}:00-07:00`);
const care = (extra = {}) => ({ kind: "care", key: "rosa", timeLocal: "09:00", doneAt: null, ...extra });
const due = (now, reminders, sent = [], heatAlert = null) => dueMessages({ now, reminders, sent: new Set(sent), heatAlert });

test("Arizona time conversion ignores daylight saving", () => {
  assert.deepEqual(phoenixParts(new Date("2026-07-01T16:00:00Z")), { date: "2026-07-01", minutes: 9 * 60 });
  assert.deepEqual(phoenixParts(new Date("2026-12-01T16:00:00Z")), { date: "2026-12-01", minutes: 9 * 60 });
});

test("a care reminder fires at its time, once per day", () => {
  assert.equal(due(az("2026-10-12", "08:59"), [care()]).length, 0);
  const at = due(az("2026-10-12", "09:00"), [care()]);
  assert.equal(at.length, 1);
  assert.deepEqual(at[0].payload, { type: "care", key: "rosa", stage: "first" });
  assert.equal(at[0].dedupeKey, "care:rosa:2026-10-12:first");
  assert.equal(due(az("2026-10-12", "09:10"), [care()], ["care:rosa:2026-10-12:first"]).length, 0, "not twice");
  assert.equal(due(az("2026-10-13", "09:00"), [care()], ["care:rosa:2026-10-12:first"]).length, 1, "again tomorrow");
});

test("no reminder once the person was checked today", () => {
  const checked = care({ doneAt: az("2026-10-12", "08:30") });
  assert.equal(due(az("2026-10-12", "09:00"), [checked]).length, 0);
  assert.equal(due(az("2026-10-12", "11:00"), [checked]).length, 0, "no escalation either");
  const yesterday = care({ doneAt: az("2026-10-11", "09:05") });
  assert.equal(due(az("2026-10-12", "09:00"), [yesterday]).length, 1, "yesterday's check doesn't count");
});

test("escalates two hours later if still not checked", () => {
  const first = "care:rosa:2026-10-12:first";
  assert.equal(due(az("2026-10-12", "10:59"), [care()], [first]).length, 0);
  const late = due(az("2026-10-12", "11:00"), [care()], [first]);
  assert.equal(late[0].payload.stage, "overdue");
});

test("if the server wakes up late it sends only the escalation, not both", () => {
  const late = due(az("2026-10-12", "11:30"), [care()]);
  assert.equal(late.length, 1);
  assert.equal(late[0].payload.stage, "overdue");
  assert.deepEqual(late[0].alsoMarkSent, ["care:rosa:2026-10-12:first"]);
});

test("nothing after 9 PM, and stale morning reminders aren't sent at night", () => {
  assert.equal(due(az("2026-10-12", "21:00"), [care({ timeLocal: "20:00" })]).length, 0);
  assert.equal(due(az("2026-10-12", "20:30"), [care()]).length, 0, "9 AM reminder is too stale by 8:30 PM");
});

test("during a heat warning, a 4 PM second check unless they were checked after 1 PM", () => {
  const heat = { event: "Extreme Heat Warning", ends: "2026-10-13T03:00:00Z" };
  const sentMorning = ["care:rosa:2026-10-12:first", "care:rosa:2026-10-12:overdue", "heat:Extreme Heat Warning:2026-10-13T03:00:00Z"];
  const morningCheck = care({ doneAt: az("2026-10-12", "09:30") });
  const afternoon = due(az("2026-10-12", "16:00"), [morningCheck], sentMorning, heat);
  assert.deepEqual(afternoon.map((m) => m.payload.stage), ["afternoon"]);
  const lateCheck = care({ doneAt: az("2026-10-12", "13:15") });
  assert.equal(due(az("2026-10-12", "16:00"), [lateCheck], sentMorning, heat).length, 0);
  assert.equal(due(az("2026-10-12", "16:00"), [morningCheck], sentMorning, null).length, 0, "no warning, no second check");
});

test("official heat warnings are announced once, during the day", () => {
  const heat = { event: "Excessive Heat Warning", ends: "2026-10-13T03:00:00Z" };
  assert.equal(due(az("2026-10-12", "05:59"), [], [], heat).length, 0);
  const msg = due(az("2026-10-12", "06:00"), [], [], heat);
  assert.deepEqual(msg[0].payload, { type: "heat", event: heat.event, ends: heat.ends });
  assert.equal(due(az("2026-10-12", "07:00"), [], [msg[0].dedupeKey], heat).length, 0);
});

test("Best time reminders fire at the start and are dropped if 30 minutes late", () => {
  const w = { kind: "window", key: "w1", fireAt: az("2026-10-12", "06:00") };
  assert.equal(due(az("2026-10-12", "05:59"), [w]).length, 0);
  assert.equal(due(az("2026-10-12", "06:00"), [w]).length, 1);
  assert.equal(due(az("2026-10-12", "06:29"), [w]).length, 1);
  assert.equal(due(az("2026-10-12", "06:30"), [w]).length, 0);
});

test("only well-formed reminders are accepted from the phone", () => {
  assert.deepEqual(parseReminders([{ kind: "care", key: "a1", time: "09:30" }])[0].timeLocal, "09:30");
  assert.equal(parseReminders([{ kind: "care", key: "a1", time: "25:00" }]), null);
  assert.equal(parseReminders([{ kind: "care", key: "Grandma Rosa", time: "09:00" }]), null, "keys are opaque ids, not names");
  assert.equal(parseReminders([{ kind: "window", key: "w", at: "soon" }]), null);
  assert.equal(parseReminders([{ kind: "other", key: "x" }]), null);
  assert.equal(parseReminders(Array.from({ length: 51 }, (_, i) => ({ kind: "care", key: `k${i}`, time: "09:00" }))), null);
});
