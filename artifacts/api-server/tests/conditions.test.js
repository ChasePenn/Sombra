import assert from "node:assert/strict";
import { once } from "node:events";
import { unlink } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import express from "express";
import { build } from "esbuild";
import test, { after, afterEach, before } from "node:test";

const dir = path.dirname(fileURLToPath(import.meta.url));
const bundle = path.join(dir, ".conditions-router.test-bundle.mjs");
const originalFetch = globalThis.fetch;
let server;
let baseUrl;

await build({
  entryPoints: [path.resolve(dir, "../src/routes/conditions.ts")],
  bundle: true, platform: "node", format: "esm", outfile: bundle, external: ["express"], logLevel: "silent",
});
const mod = await import(`${pathToFileURL(bundle).href}?t=${Date.now()}`);

before(async () => {
  const app = express();
  app.use((req, _res, next) => { req.log = { error() {} }; next(); });
  app.use(mod.default);
  server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});
afterEach(() => { globalThis.fetch = originalFetch; });
after(async () => { server.close(); await unlink(bundle).catch(() => {}); });

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

test("heat alerts are listed before other alerts", () => {
  const alerts = mod.summarizeAlerts([
    { properties: { event: "Dust Storm Warning", severity: "Severe" } },
    { properties: { event: "Wind Advisory" } },
    { properties: { event: "Extreme Heat Warning", severity: "Extreme", ends: "2999-07-10T20:00:00-07:00" } },
  ]);
  assert.deepEqual(alerts.map((a) => a.kind), ["heat", "air", "other"]);
  assert.equal(alerts[0].event, "Extreme Heat Warning");
});

test("UV and AQI levels follow the standard EPA bands", () => {
  assert.equal(mod.uvLevel(2), "low");
  assert.equal(mod.uvLevel(7), "high");
  assert.equal(mod.uvLevel(11), "extreme");
  assert.equal(mod.aqiLevel(45), "good");
  assert.equal(mod.aqiLevel(120), "sensitive");
  assert.equal(mod.aqiLevel(350), "hazardous");
});

test("air quality summary finds the current value and today's peak", () => {
  const summary = mod.summarizeAirQuality({
    time: ["2026-07-10T09:00", "2026-07-10T12:00", "2026-07-10T15:00", "2026-07-11T12:00"],
    uv_index: [4, 10.5, 7, 12],
    us_aqi: [40, 90, 110, 300],
  }, "2026-07-10T12:20");
  assert.equal(summary.uv.now, 10.5);
  assert.equal(summary.uv.peak, 10.5);
  assert.equal(summary.uv.level, "very_high");
  assert.equal(summary.aqi.peak, 110);
  assert.equal(summary.aqi.peakTime, "15:00");
});

test("conditions still return air data when the alert service is down", async () => {
  globalThis.fetch = async (url) => {
    if (String(url).startsWith(mod.NWS_ALERTS_URL)) return json({}, 503);
    const phoenixHour = new Date(Date.now() - 7 * 3600 * 1000).toISOString().slice(0, 13) + ":00";
    return json({ hourly: { time: [phoenixHour], uv_index: [9], us_aqi: [60] } });
  };
  const res = await originalFetch(`${baseUrl}/conditions?lat=33.4484&lon=-112.074`);
  const body = await res.json();
  assert.equal(res.status, 200);
  assert.equal(body.alerts, null);
  assert.equal(body.air.uv.level, "very_high");
});

test("conditions require valid coordinates", async () => {
  const res = await originalFetch(`${baseUrl}/conditions?lat=abc&lon=1`);
  assert.equal(res.status, 400);
});

test("cool spots are sorted by distance and unnamed buildings are dropped", () => {
  const origin = { lat: 33.45, lon: -112.07 };
  const places = mod.summarizePlaces([
    { id: 1, lat: 33.46, lon: -112.07, tags: { amenity: "library", name: "Burton Barr Library" } },
    { id: 2, lat: 33.451, lon: -112.07, tags: { amenity: "drinking_water" } },
    { id: 3, lat: 33.452, lon: -112.07, tags: { amenity: "community_centre" } },
    { id: 4, center: { lat: 33.47, lon: -112.07 }, tags: { shop: "mall", name: "Arizona Center" } },
  ], origin);
  assert.deepEqual(places.map((p) => p.id), [2, 1, 4]);
  assert.equal(places[0].kind, "water");
  assert.ok(places[0].distanceM > 100 && places[0].distanceM < 120);
});

test("expired alerts and impossible readings are dropped", () => {
  const alerts = mod.summarizeAlerts([
    { properties: { event: "Extreme Heat Warning", ends: "2020-01-01T00:00:00Z" } },
    { properties: { event: "Heat Advisory", ends: "2999-01-01T00:00:00Z" } },
  ]);
  assert.deepEqual(alerts.map((a) => a.event), ["Heat Advisory"]);
  const air = mod.summarizeAirQuality({ time: ["2026-07-10T12:00", "2026-07-10T13:00"], uv_index: [-3, 99], us_aqi: [900, 60] }, "2026-07-10T12:10");
  assert.equal(air.uv.peak, null);
  assert.equal(air.aqi.peak, 60);
});

test("cool spots query uses a box about 3 km around the point", async () => {
  const q = mod.placesQuery(33.45, -112.07);
  const box = q.match(/bbox:([^\]]+)/)[1].split(",").map(Number);
  assert.ok(Math.abs(box[0] - 33.423) < 0.002 && Math.abs(box[2] - 33.477) < 0.002, q);
  assert.ok(Math.abs(box[1] - -112.102) < 0.003 && Math.abs(box[3] - -112.038) < 0.003, q);
  assert.match(q, /drinking_water/);
});

const fakeSaved = {
  updated: "2026-10-01",
  regions: [{ name: "Test", box: [33, -113, 34, -111] }],
  kinds: ["water", "library", "community", "mall", "shade"],
  places: [[1, 1, 33.5, -112, "Burton Barr Library", "Mo-Th 09:00-21:00"], [2, 0, 33.51, -112.01, null, null], [3, 0, 33.9, -112, null, null]],
};

test("saved cool spots near a point come back shaped like map data", () => {
  const inside = mod.snapshotElements(33.5, -112, fakeSaved);
  assert.equal(inside.complete, true);
  assert.deepEqual(inside.elements.map((e) => e.id), [1, 2]);
  assert.deepEqual(inside.elements[0].tags, { amenity: "library", name: "Burton Barr Library", opening_hours: "Mo-Th 09:00-21:00" });
  assert.deepEqual(inside.elements[1].tags, { amenity: "drinking_water" });
  const places = mod.summarizePlaces(inside.elements, { lat: 33.5, lon: -112 });
  assert.equal(places[0].kind, "library");
});

test("saved cool spots know when a search reaches past the saved area", () => {
  const edge = mod.snapshotElements(33.99, -112, fakeSaved);
  assert.equal(edge.complete, false);
  assert.equal(edge.covered, true);
  const outside = mod.snapshotElements(40, -100, fakeSaved);
  assert.equal(outside.covered, false);
  assert.equal(outside.elements.length, 0);
});

test("downtown Phoenix cool spots answer from the saved copy, even with the map servers down", async () => {
  let calls = 0;
  globalThis.fetch = async (url) => { if (String(url).includes("interpreter")) calls++; throw new Error("map servers down"); };
  const res = await originalFetch(`${baseUrl}/places/cool?lat=33.4484&lon=-112.074`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.source, "saved");
  assert.match(body.updated, /^\d{4}-\d{2}-\d{2}$/);
  assert.ok(body.places.length >= 3, `expected several downtown places, got ${body.places.length}`);
  assert.ok(body.places.every((p) => p.distanceM <= 3600));
  assert.equal(calls, 0, "no live map lookup needed");
  // Official sites come along too (here from the saved copy, since every fetch fails).
  assert.ok(Array.isArray(body.relief));
  assert.ok(body.reliefSeason && typeof body.reliefSeason.open === "number");
});

test("outside the saved area, a live lookup is used and its failure is reported", async () => {
  const asked = [];
  globalThis.fetch = async (url) => { if (String(url).includes("interpreter")) asked.push(String(url)); return new Response("busy", { status: 429 }); };
  const res = await originalFetch(`${baseUrl}/places/cool?lat=35.2&lon=-111.65`);
  assert.equal(res.status, 502);
  assert.ok(asked.length >= 2, "tried the backup servers too");
  assert.equal(asked.filter((u) => u === mod.OVERPASS_URL).length, 1, "a busy main server isn't asked twice");
});

test("outside the saved area, live results come back marked live", async () => {
  globalThis.fetch = async (url) => String(url).includes("arcgis") ? json({ features: [] }) : json({ elements: [{ id: 9, lat: 35.201, lon: -111.65, tags: { amenity: "library", name: "Flagstaff Library" } }] });
  const res = await originalFetch(`${baseUrl}/places/cool?lat=35.21&lon=-111.66`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.source, "live");
  assert.equal(body.places[0].name, "Flagstaff Library");
});

test("official sites near a point: in season only, nearest first, with the season's end", () => {
  const site = (id, lat, start, end) => ({ id, type: "cooling", name: `Site ${id}`, org: null, address: null, phone: null, lat, lon: -112.07, start, end, hours: [], status: 1, pets: null, accessible: null });
  const data = { updated: "2026-10-13", sites: [site(1, 33.46, "2026-05-01", "2026-10-31"), site(2, 33.45, "2026-05-01", "2026-10-16"), site(3, 33.45, "2026-05-01", "2026-09-30"), site(4, 34.9, "2026-05-01", "2026-10-31")] };
  const near = mod.reliefNear(data, { lat: 33.45, lon: -112.07 }, "2026-10-20");
  assert.deepEqual(near.relief.map((s) => s.id), [1], "ended sites and far-away sites are left out");
  assert.deepEqual(near.reliefSeason, { open: 2, until: "2026-10-31", lastEnd: null });
  const off = mod.reliefNear(data, { lat: 33.45, lon: -112.07 }, "2026-11-05");
  assert.equal(off.relief.length, 0);
  assert.deepEqual(off.reliefSeason, { open: 0, until: null, lastEnd: "2026-10-31" });
});
