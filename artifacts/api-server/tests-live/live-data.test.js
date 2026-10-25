// Calls the real data services through sombra's routes and fails on missing or odd values.
import assert from "node:assert/strict";
import { once } from "node:events";
import { unlink } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import express from "express";
import { build } from "esbuild";
import test, { after, before } from "node:test";

const dir = path.dirname(fileURLToPath(import.meta.url));
const PHOENIX = { lat: 33.4484, lon: -112.074, name: "Phoenix, Arizona" };
const bundles = [];

async function load(entry) {
  const outfile = path.join(dir, `.${path.basename(entry, ".ts")}.live-bundle.mjs`);
  await build({ entryPoints: [path.resolve(dir, entry)], bundle: true, platform: "node", format: "esm", outfile, external: ["express"], logLevel: "silent" });
  bundles.push(outfile);
  return (await import(`${pathToFileURL(outfile).href}?t=${Date.now()}`)).default;
}

let server;
let base;
before(async () => {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.log = { error: (...args) => console.error(...args) }; next(); });
  app.use(await load("../src/routes/weather.ts"));
  app.use(await load("../src/routes/conditions.ts"));
  server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  server?.close();
  await Promise.all(bundles.map((file) => unlink(file).catch(() => {})));
});

// Outside services have brief outages that aren't sombra's fault.
async function withRetries(check, tries = 3, gapMs = 15_000) {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await check();
    } catch (error) {
      if (attempt >= tries) throw error;
      console.error(`try ${attempt} failed: ${error.message.split("\n")[0]}`);
      await new Promise((resolve) => setTimeout(resolve, gapMs));
    }
  }
}

function phoenixToday() {
  return new Date(Date.now() - 7 * 3600 * 1000).toISOString().slice(0, 10);
}

test("location search finds Phoenix", async () => {
  const res = await fetch(`${base}/weather/geocode?name=Phoenix`);
  assert.equal(res.status, 200);
  const places = await res.json();
  const phx = places.find((p) => p.admin1 === "Arizona");
  assert.ok(phx, "Phoenix, Arizona should be in the results");
  assert.ok(Math.abs(phx.latitude - PHOENIX.lat) < 0.3 && Math.abs(phx.longitude - PHOENIX.lon) < 0.3, `Phoenix geocoded to ${phx.latitude}, ${phx.longitude}`);
});

test("today's heat forecast is complete and physically plausible", () => withRetries(async () => {
  const res = await fetch(`${base}/weather/shift`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ workerName: "check", locationName: PHOENIX.name, latitude: PHOENIX.lat, longitude: PHOENIX.lon, intensity: "moderate", startTime: "06:00", endTime: "20:00", date: phoenixToday(), newToHeat: false }),
  });
  assert.equal(res.status, 200, await res.clone().text());
  const data = await res.json();
  assert.ok(data.hours.length >= 12, `expected at least 12 hours, got ${data.hours.length}`);
  for (const h of data.hours) {
    assert.ok(h.airTempF > 0 && h.airTempF < 130, `air temp ${h.airTempF}`);
    assert.ok(h.humidity >= 0 && h.humidity <= 100, `humidity ${h.humidity}`);
    assert.ok(h.wbgtSunF > 20 && h.wbgtSunF < 105, `WBGT sun ${h.wbgtSunF}`);
    assert.ok(h.wbgtShadeF <= h.wbgtSunF + 0.01, `shade ${h.wbgtShadeF} should not exceed sun ${h.wbgtSunF}`);
    // In humid sun WBGT can sit a few degrees above the air temperature.
    assert.ok(h.wbgtSunF <= h.airTempF + 10, `WBGT ${h.wbgtSunF} is far above air temp ${h.airTempF}`);
  }
}));

test("official alerts and UV / air quality come back", () => withRetries(async () => {
  const res = await fetch(`${base}/conditions?lat=${PHOENIX.lat}&lon=${PHOENIX.lon}`);
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.ok(Array.isArray(data.alerts), "National Weather Service alerts should load (an empty list is fine)");
  assert.ok(data.air, "air quality should load");
  assert.ok(data.air.uv.peak != null && data.air.uv.peak >= 0 && data.air.uv.peak <= 20, `UV peak ${data.air.uv.peak}`);
  assert.ok(data.air.aqi.peak != null && data.air.aqi.peak >= 0 && data.air.aqi.peak <= 500, `AQI peak ${data.air.aqi.peak}`);
}));

test("cool spots near downtown Phoenix include real libraries or water", () => withRetries(async () => {
  const res = await fetch(`${base}/places/cool?lat=${PHOENIX.lat}&lon=${PHOENIX.lon}`);
  assert.equal(res.status, 200);
  const { places } = await res.json();
  assert.ok(places.length >= 3, `expected several places downtown, got ${places.length}`);
  assert.ok(places.every((p) => p.distanceM <= 3600), "every place should be within 3.6 km");
  assert.ok(places.some((p) => p.kind === "library" || p.kind === "water"), `expected a library or water spot downtown, got kinds: ${[...new Set(places.map((p) => p.kind))].join(", ")}`);
}));

test("the saved cool spots list was refreshed in the last 45 days", async () => {
  const res = await fetch(`${base}/places/cool?lat=${PHOENIX.lat}&lon=${PHOENIX.lon}`);
  const { source, updated } = await res.json();
  assert.equal(source, "saved");
  const ageDays = (Date.now() - Date.parse(`${updated}T12:00:00Z`)) / 86_400_000;
  assert.ok(ageDays < 45, `cool spots data is from ${updated}; the weekly "Cool spots data" workflow may be failing`);
});

test("official Heat Relief Network sites come from the live feed", () => withRetries(async () => {
  const res = await fetch(`${base}/places/cool?lat=${PHOENIX.lat}&lon=${PHOENIX.lon}`);
  const { relief, reliefSeason, reliefUpdated } = await res.json();
  assert.ok(Array.isArray(relief), "relief list present (it can be empty off-season)");
  assert.ok(reliefSeason && Number.isInteger(reliefSeason.open), "season summary present");
  const today = new Date(Date.now() - 7 * 3_600_000).toISOString().slice(0, 10);
  // The saved copy is only a fallback; today's date means the live feed answered.
  assert.equal(reliefUpdated, today, `official sites came from the saved copy (${reliefUpdated}); the MAG feed may be down or changed`);
  for (const site of relief) {
    assert.ok(site.name && Number.isFinite(site.lat) && Number.isFinite(site.lon), `bad site ${JSON.stringify(site).slice(0, 120)}`);
    assert.equal(site.hours.length, 7);
  }
}));
