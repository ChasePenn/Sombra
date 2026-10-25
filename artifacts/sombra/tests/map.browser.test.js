// Map screen in a real browser with a faked location.
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

/** One official cooling center, open all day every day, a little farther than the library. */
function reliefAround(lat, lon) {
  return [{
    id: 501, type: "cooling", name: "Valley Cooling Center", org: "City of Phoenix", address: "1 Main St", phone: "602-555-0100",
    lat: lat - 0.007, lon: lon + 0.005, start: "2026-05-01", end: "2026-10-31", hours: Array(7).fill([0, 1440]), status: 1,
    pets: true, accessible: true, distanceM: 900,
  }];
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
      return route.fulfill({ json: { places: placesAround(lat, lon), source: "saved", updated: "2026-10-12", relief: reliefAround(lat, lon), reliefSeason: { open: 158, until: "2026-10-31", lastEnd: null }, reliefUpdated: "2026-10-13" } });
    }
    if (url.pathname === "/api/weather/geocode") {
      return route.fulfill({ json: [{ name: "Tempe", admin1: "Arizona", latitude: 33.4255, longitude: -111.94 }] });
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

    // The water spot is 0.002° north of the rounded point (33.45).
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

test("a searched place stays put while live location keeps running", { skip }, async () => {
  const { context, page, asked } = await newPage({ geolocation: { latitude: 33.4484, longitude: -112.074, accuracy: 15 } });
  try {
    await page.goto(`${origin}/app/cool-spots`);
    await page.waitForSelector("path.map-me", { timeout: 15_000 });
    await page.getByRole("button", { name: "Change" }).click();
    await page.locator("#place-search").fill("Tempe");
    await page.getByRole("button", { name: /Tempe/ }).click();
    await page.getByText("Near Tempe, Arizona").waitFor({ timeout: 5000 });
    const deadline = Date.now() + 5000;
    while (!asked.some((q) => q.includes("lat=33.43&lon=-111.94")) && Date.now() < deadline) await page.waitForTimeout(100);
    assert.ok(asked.some((q) => q.includes("lat=33.43&lon=-111.94")), "Tempe's spots were asked for");
    // The phone moves to a new area; the search choice must not be replaced.
    await context.setGeolocation({ latitude: 33.466, longitude: -112.057, accuracy: 12 });
    await page.waitForTimeout(2500);
    assert.equal(asked.some((q) => q.includes("lat=33.47&lon=-112.06")), false, "didn't jump back to the phone's area");
    await page.getByText("Near Tempe, Arizona").waitFor({ timeout: 1000 });
    // "Back to me" / the target button returns to following.
    await page.locator(".map-locate").click();
    const until = Date.now() + 10_000;
    while (!asked.some((q) => q.includes("lat=33.47&lon=-112.06")) && Date.now() < until) await page.waitForTimeout(100);
    assert.ok(asked.some((q) => q.includes("lat=33.47&lon=-112.06")), "following again loads the phone's area");
  } finally {
    await context.close();
  }
});

test("allowing location from the target button starts the live dot", { skip }, async () => {
  const { context, page } = await newPage({ allow: false, geolocation: { latitude: 33.4484, longitude: -112.074, accuracy: 15 } });
  try {
    await context.addInitScript(() => localStorage.setItem("sombra.last-place", JSON.stringify({ lat: 33.4255, lon: -111.94, name: "Tempe, Arizona" })));
    await page.goto(`${origin}/app/cool-spots`);
    await page.waitForSelector(".map-locate", { timeout: 15_000 });
    // The person says yes to the prompt.
    await context.grantPermissions(["geolocation"], { origin });
    await page.locator(".map-locate").click();
    await page.waitForSelector("path.map-me", { timeout: 15_000 });
    await page.getByText("Following you as you move").waitFor({ timeout: 5000 });
    await page.getByText("Near you", { exact: true }).waitFor({ timeout: 5000 });
  } finally {
    await context.close();
  }
});

test("Cool down now points at the best open place with AC, with directions and a call button", { skip }, async () => {
  const { context, page } = await newPage({ geolocation: { latitude: 33.4484, longitude: -112.074, accuracy: 15 } });
  try {
    // Arriving from the heat warning card or a caution check-in.
    await page.goto(`${origin}/app/cool-spots?now=1`);
    const card = page.locator(".cool-now-card");
    await card.waitFor({ timeout: 15_000 });
    const text = await card.innerText();
    // The official center beats the library, and both beat the fountain.
    assert.match(text, /Valley Cooling Center/, text);
    assert.match(text, /Official cooling center · \d+ min walk · Open until midnight/, text);
    assert.match(await card.locator("a.btn-primary").getAttribute("href"), /travelmode=walking/);
    assert.equal(await card.locator('a[href^="tel:602"]').count(), 1, "call button for the official site");
    assert.match(text, /Other options/);
    assert.match(text, /Call 911/);
    assert.ok(!page.url().includes("now=1"), "the one-time link is cleaned up");
    // The official site is on the map and in the list, marked as official.
    assert.ok(await page.locator(".map-pin.is-official").count() >= 1);
    assert.match(await page.locator(".relief-card").innerText(), /open through October 31/);
  } finally {
    await context.close();
  }
});

test("the planner starts from your place, and from tomorrow once today's hours are over", { skip }, async () => {
  for (const [utc, expectTomorrow] of [["2026-07-10T04:30:00Z", true], ["2026-07-10T15:00:00Z", false]]) {
    const { context, page } = await newPage({ allow: false });
    try {
      await page.clock.setFixedTime(new Date(utc)); // 9:30 PM and 8:00 AM in Phoenix
      await context.addInitScript(() => localStorage.setItem("sombra.last-place", JSON.stringify({ lat: 33.45, lon: -112.07, name: "My location" })));
      await page.goto(`${origin}/planner.html?mode=everyday`);
      await page.waitForSelector("#location-search");
      await page.waitForFunction(() => document.querySelector("#location-search").value !== "", null, { timeout: 5000 });
      assert.equal(await page.inputValue("#location-search"), "Current location");
      assert.equal(await page.isChecked("#shift-date-tomorrow"), expectTomorrow, `at ${utc}`);
    } finally {
      await context.close();
    }
  }
});

test("a new screen opens at the top, and going back returns to where you were", { skip }, async () => {
  const context = await browser.newContext({ viewport: { width: 390, height: 700 } });
  const page = await context.newPage();
  await page.route("**/api/**", (route) => route.fulfill({ status: 404, body: "{}" }));
  await page.route(/^https:\/\/(fonts|clerk)/, (route) => route.abort());
  await page.goto(`${origin}/`);
  await page.getByRole("link", { name: "Heat profile" }).waitFor();
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  const scrolled = await page.evaluate(() => window.scrollY);
  assert.ok(scrolled > 200, "the landing page should be long enough to scroll");
  await page.getByRole("link", { name: "Heat profile" }).click();
  await page.waitForURL(/\/app\/profile/);
  assert.equal(await page.evaluate(() => window.scrollY), 0);
  await page.goBack();
  await page.waitForURL(`${origin}/`);
  await page.waitForFunction(() => window.scrollY > 200);
  await context.close();
});
