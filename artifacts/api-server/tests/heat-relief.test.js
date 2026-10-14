import assert from "node:assert/strict";
import { unlink } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import { build } from "esbuild";
import test, { after, beforeEach } from "node:test";

const dir = path.dirname(fileURLToPath(import.meta.url));
const bundle = path.join(dir, ".heat-relief.test-bundle.mjs");
await build({ entryPoints: [path.resolve(dir, "../src/lib/heat-relief.ts")], bundle: true, platform: "node", format: "esm", outfile: bundle, logLevel: "silent" });
const mod = await import(`${pathToFileURL(bundle).href}?t=${Date.now()}`);
after(() => unlink(bundle).catch(() => {}));
beforeEach(() => mod.resetReliefCacheForTests());

const json = (body, status = 200) => async () => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const feature = (overrides = {}, geometry = { x: -112.07, y: 33.45 }) => ({
  attributes: {
    OBJECTID: 7, Location: "  Burton Barr Central Library  ", Organization: "City of Phoenix", Address: "1221 N Central Ave", PrimaryPhone: "602-262-4636",
    HeatRelief_Type: "Cooling Center", Start_Date: "2026-05-01", End_Date: "2026-10-31", Status: 1, Active: "Yes", Pets: "No", ADA_accessible: "Yes",
    MondayOpen: "9:00 AM", MondayClose: "9:00 PM", SundayOpen: "1:00 PM", SundayClose: "11:59 PM", SaturdayOpen: null, SaturdayClose: null,
    ...overrides,
  },
  geometry,
});

test("published clock times become minutes, with 11:59 PM meaning end of day", () => {
  assert.equal(mod.parseClock("9:00 AM"), 540);
  assert.equal(mod.parseClock("12:30 PM"), 750);
  assert.equal(mod.parseClock("12:00 AM"), 0);
  assert.equal(mod.parseClock("11:59 PM"), 1440);
  assert.equal(mod.parseClock(null), null);
  assert.equal(mod.parseClock("noonish"), null);
});

test("sites are cleaned up: names trimmed, daily hours read, closed or broken sites dropped", () => {
  const sites = mod.normalizeSites([
    feature(),
    feature({ OBJECTID: 8, Status: 5 }),
    feature({ OBJECTID: 9, Status: 6 }),
    feature({ OBJECTID: 10, Active: "No" }),
    feature({ OBJECTID: 11, HeatRelief_Type: "Donation Site" }),
    feature({ OBJECTID: 12 }, null),
    feature({ OBJECTID: 13 }, { x: -80, y: 25 }),
  ]);
  assert.deepEqual(sites.map((s) => s.id), [7]);
  const [s] = sites;
  assert.equal(s.name, "Burton Barr Central Library");
  assert.equal(s.type, "cooling");
  assert.deepEqual(s.hours[1], [540, 1260], "Monday");
  assert.deepEqual(s.hours[0], [780, 1440], "Sunday until midnight");
  assert.equal(s.hours[6], null, "closed Saturday");
  assert.equal(s.accessible, true);
  assert.equal(s.pets, false);
  assert.equal(s.end, "2026-10-31");
});

test("the season check uses each site's own dates", () => {
  assert.equal(mod.inSeason({ start: "2026-05-01", end: "2026-10-31" }, "2026-10-31"), true);
  assert.equal(mod.inSeason({ start: "2026-05-01", end: "2026-10-31" }, "2026-11-01"), false);
  assert.equal(mod.inSeason({ start: "2026-05-01", end: null }, "2026-07-01"), true);
});

test("live sites are used and kept for a while", async () => {
  let calls = 0;
  const fetcher = async (...args) => { calls++; return json({ features: [feature()] })(...args); };
  const first = await mod.getRelief(fetcher, 1_000_000);
  const second = await mod.getRelief(fetcher, 1_000_000 + 60_000);
  assert.equal(first.sites.length, 1);
  assert.equal(second, first);
  assert.equal(calls, 1);
});

test("if the feed is down or empty, the saved copy is used", async () => {
  const down = await mod.getRelief(async () => { throw new Error("offline"); }, 2_000_000);
  assert.ok(down.sites.length > 50, "saved copy has the season's sites");
  mod.resetReliefCacheForTests();
  const empty = await mod.getRelief(json({ features: [] }), 3_000_000);
  assert.ok(empty.sites.length > 50, "an empty answer doesn't wipe the list");
  mod.resetReliefCacheForTests();
  const broken = await mod.getRelief(json({ error: { message: "Invalid token" } }), 4_000_000);
  assert.ok(broken.sites.length > 50);
});
