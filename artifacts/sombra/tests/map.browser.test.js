/*
  The Map screen in a real browser, against the production build, with the phone's
  location faked by the browser itself:
  1. location already allowed: the blue dot appears without asking, spots load, and
     distances are measured from exactly where the person is;
  2. walking: the dot follows, and a new 1 km area loads new spots;
  3. only rounded points (2 decimals) are ever sent to the server;
  4. location blocked: the target button explains how to turn it back on;
  5. map tiles down: a second map style loads instead.

  Needs CHROME_BIN and a built app (pnpm run build).
*/
import assert from "node:assert/strict";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import { once } from "node:events";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test, { after, before } from "node:test";
import { chromium } from "playwright-core";

const dist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../dist/public");
const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".json": "application/json", ".webmanifest": "application/manifest+json" };
const skip = !process.env.CHROME_BIN && "needs CHROME_BIN";
// A 1x1 PNG for map tiles.
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=", "base64");

let server, origin, browser;

before(async () => {
  if (skip) return;
  await stat(path.join(dist, "index.html")).catch(() => { throw new Error("Build the app first: pnpm --filter @workspace/sombra run build"); });
  server = createServer(async (req, res) => {
    const url = new URL(req.url, "http://x");
    let file = path.join(dist, decodeURIComponent(url.pathname));
    try { if (!(await stat(file)).isFile()) throw new Error("dir"); } catch { file = path.join(dist, "index.html"); }
    res.writeHead(200, { "Content-Type": types[path.extname(file)] ?? "application/octet-stream" });
    createReadStream(file).pipe(res);
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  origin = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ executablePath: process.env.CHROME_BIN, args: ["--no-sandbox"] });
});
after(async () => { await browser?.close(); server?.close(); });

/** Spots placed around whatever (rounded) point was asked for. */
function placesAround(lat, lon) {
  return [
    { id: 11, kind: "water", name: null, lat: lat + 0.002, lon, openingHours: null, distanceM: 222 },
    { id: 12, kind: "library", name: "Burton Barr Library", lat: lat - 0.006, lon: lon + 0.004, openingHours: "Mo-Su 00:00-24:00", distanceM: 760 },
    { id: 13, kind: "mall", name: "Arizona Center", lat: lat + 0.01, lon: lon - 0.01, openingHours: null, distanceM: 1450 },
  ];
}

async function newPage({ geolocation, allow = true, tilesDown = false }) {
  const context = await browser.newContext({
    permissions: allow ? ["geolocation"] : [],
    geolocation,
    viewport: { width: 390, height: 844 },
  });
  await context.addInitScript(() => {
    localStorage.setItem("sombra.profile", JSON.stringify({ name: "Luis", language: "en", usualIntensity: "moderate", newToHeat: false, mode: "everyday" }));
    localStorage.setItem("sombra.welcome-dismissed", "true");
  });
  const asked = [];
  const tiles = { osm: 0, carto: 0 };
  await context.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.hostname === "tile.openstreetmap.org") {
      tiles.osm++;
      return tilesDown ? route.fulfill({ status: 503, body: "" }) : route.fulfill({ body: PNG, contentType: "image/png" });
    }
    if (url.hostname.endsWith("basemaps.cartocdn.com")) { tiles.carto++; return route.fulfill({ body: PNG, contentType: "image/png" }); }
    if (url.origin !== origin) return route.fulfill({ status: 404, body: "" });
    if (url.pathname === "/api/places/cool") {
      asked.push(url.search);
      const lat = Number(url.searchParams.get("lat"));
      const lon = Number(url.searchParams.get("lon"));
      return route.fulfill({ json: { places: placesAround(lat, lon), source: "saved", updated: "2026-10-12" } });
    }
    if (url.pathname === "/api/conditions") { asked.push(url.search); return route.fulfill({ json: { alerts: [], air: null } }); }
    if (url.pathname.startsWith("/api/")) return route.fulfill({ status: 404, json: { error: "not mocked" } });
    return route.continue();
  });
  const page = await context.newPage();
  return { context, page, asked, tiles };
}

const dot = (page) => page.evaluate(() => {
  const el = document.querySelector("path.map-me");
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
});

test("with location allowed, the dot shows, follows, and distances are exact", { skip }, async () => {
  const { context, page, asked } = await newPage({ geolocation: { latitude: 33.448376, longitude: -112.074036, accuracy: 15 } });
  try {
    await page.goto(`${origin}/app/cool-spots`);
    // No prompt and no tap needed: the dot appears and spots load for this spot.
    await page.waitForSelector("path.map-me", { timeout: 15_000 });
    await page.waitForSelector(".spot-list .spot", { timeout: 15_000 });
    await page.getByText("Following you as you move").waitFor({ timeout: 5000 });
    assert.ok(await page.locator(".map-pin").count() >= 3, "spot pins are on the map");

    // The water spot is 0.002° north of the rounded point (33.45); the person is at 33.448376,
    // so it's ~402 m (0.25 mi) away, not the server's 222 m.
    const first = await page.locator(".spot-list .spot").first().innerText();
    assert.match(first, /0\.[3-4] mi away/, first);

    // Walk 2 km north-east: the dot moves and the new area's spots are asked for.
    const before = await dot(page);
    await context.setGeolocation({ latitude: 33.466, longitude: -112.057, accuracy: 12 });
    await page.waitForFunction(() => [...document.querySelectorAll(".spot-list .spot")].length > 0, null, { timeout: 5000 });
    const deadline = Date.now() + 10_000;
    while (!asked.some((q) => q.includes("lat=33.47&lon=-112.06")) && Date.now() < deadline) await page.waitForTimeout(100);
    assert.ok(asked.some((q) => q.includes("lat=33.47&lon=-112.06")), `new area loaded; asked: ${asked.join(" ")}`);
    const afterMove = await dot(page);
    assert.ok(afterMove && before, "the dot is still shown");

    // Every request carried only a rounded point.
    for (const q of asked) assert.match(q, /^\?lat=-?\d+\.\d{2}&lon=-?\d+\.\d{2}$/, `request ${q} sent a precise location`);

    // Tapping a spot in the list opens its card on the map, with directions.
    await page.locator(".spot-main").first().click();
    await page.waitForSelector(".map-pop", { timeout: 5000 });
    const href = await page.locator(".map-pop a").getAttribute("href");
    assert.match(href, /google\.com\/maps\/dir\/.*travelmode=walking/);
  } finally {
    await context.close();
  }
});

test("with location blocked, the target button says how to turn it back on", { skip }, async () => {
  const { context, page } = await newPage({ allow: false });
  try {
    // A place picked by search, so the map shows.
    await context.addInitScript(() => localStorage.setItem("sombra.last-place", JSON.stringify({ lat: 33.45, lon: -112.07, name: "Phoenix, Arizona" })));
    await page.goto(`${origin}/app/cool-spots`);
    await page.waitForSelector(".map-locate", { timeout: 15_000 });
    assert.equal(await page.locator("path.map-me").count(), 0, "no dot, and no surprise prompt");
    await page.locator(".map-locate").click();
    const problem = page.locator(".place-problem");
    await problem.waitFor({ timeout: 15_000 });
    assert.match(await problem.innerText(), /blocked for this site.*Location → Allow/);
    // Spots for the searched place still work.
    await page.waitForSelector(".spot-list .spot", { timeout: 10_000 });
  } finally {
    await context.close();
  }
});

test("if the main map tiles won't load, a second map style is used", { skip }, async () => {
  const { context, page, tiles } = await newPage({ allow: false, tilesDown: true });
  try {
    await context.addInitScript(() => localStorage.setItem("sombra.last-place", JSON.stringify({ lat: 33.45, lon: -112.07, name: "Phoenix, Arizona" })));
    await page.goto(`${origin}/app/cool-spots`);
    await page.waitForSelector(".spot-map .leaflet-tile", { timeout: 15_000 });
    const deadline = Date.now() + 10_000;
    while (tiles.carto === 0 && Date.now() < deadline) await page.waitForTimeout(100);
    assert.ok(tiles.osm >= 4, "tried the main tiles first");
    assert.ok(tiles.carto > 0, "switched to the backup tiles");
  } finally {
    await context.close();
  }
});
