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
    { properties: { event: "Extreme Heat Warning", severity: "Extreme", ends: "2026-07-10T20:00:00-07:00" } },
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
