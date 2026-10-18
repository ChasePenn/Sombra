// Every way a browser can fail to find someone, and what sombra does about it.
import assert from "node:assert/strict";
import test, { beforeEach } from "node:test";

const store = new Map();
globalThis.localStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
globalThis.window = { isSecureContext: true };

// A fake navigator.geolocation.
function fakeGeo(script) {
  const calls = [];
  const geo = {
    getCurrentPosition(ok, fail, options) {
      calls.push(options);
      const step = script.shift() ?? "hang";
      if (step === "hang") return;
      setTimeout(() => {
        if (typeof step === "number") fail({ code: step });
        else ok({ coords: { latitude: step.lat, longitude: step.lon, accuracy: step.accuracy ?? 20 }, timestamp: Date.now() });
      }, 5);
    },
    watchPosition(ok, fail) {
      geo.watcher = { ok, fail };
      return 7;
    },
    clearWatch(id) { geo.cleared = id; },
  };
  Object.defineProperty(globalThis, "navigator", { value: { geolocation: geo, userAgent: "test" }, configurable: true });
  return { geo, calls };
}

const { locate, follow, lastFix, platform, roundedQuery, GeoError } = await import("../public/js/geo.js");
const DENIED = 1, UNAVAILABLE = 2, TIMEOUT = 3;
const fast = { quickMs: 30, preciseMs: 30, graceMs: 50 };

beforeEach(() => { store.clear(); globalThis.window.isSecureContext = true; });

test("a quick fix is used when the browser has one", async () => {
  const { calls } = fakeGeo([{ lat: 33.4484, lon: -112.074 }]);
  const fix = await locate(fast);
  assert.equal(fix.lat, 33.4484);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].enableHighAccuracy, false);
  assert.ok(lastFix(), "the fix is remembered for later");
});

test("if the quick try times out, GPS is tried next", async () => {
  const { calls } = fakeGeo([TIMEOUT, { lat: 33.5, lon: -112.1 }]);
  let retried = false;
  const fix = await locate({ ...fast, onRetry: () => { retried = true; } });
  assert.equal(fix.lat, 33.5);
  assert.equal(retried, true);
  assert.equal(calls[1].enableHighAccuracy, true);
  assert.equal(calls[1].maximumAge, 0);
});

test("if the quick try can't find a position, GPS is tried next", async () => {
  fakeGeo([UNAVAILABLE, { lat: 33.5, lon: -112.1 }]);
  assert.equal((await locate(fast)).lat, 33.5);
});

test("a blocked permission is reported right away, without asking twice", async () => {
  const { calls } = fakeGeo([DENIED]);
  await assert.rejects(locate(fast), (e) => e instanceof GeoError && e.problem === "denied");
  assert.equal(calls.length, 1);
});

test("a browser that never answers doesn't leave the button spinning", async () => {
  const started = Date.now();
  const { calls } = fakeGeo(["hang", "hang"]);
  await assert.rejects(locate({ quickMs: 10, preciseMs: 10, graceMs: 20 }), (e) => e.problem === "timeout");
  assert.equal(calls.length, 1, "a browser that never answered isn't asked again");
  assert.ok(Date.now() - started < 1000);
});

test("when both tries fail, a fix from the last half hour is used and marked older", async () => {
  store.set("sombra.last-fix", JSON.stringify({ lat: 33.4, lon: -112.0, accuracy: 30, at: Date.now() - 10 * 60_000 }));
  fakeGeo([TIMEOUT, UNAVAILABLE]);
  const fix = await locate(fast);
  assert.equal(fix.lat, 33.4);
  assert.equal(fix.stale, true);
});

test("an old fix (over 30 minutes) is not used", async () => {
  store.set("sombra.last-fix", JSON.stringify({ lat: 33.4, lon: -112.0, accuracy: 30, at: Date.now() - 45 * 60_000 }));
  fakeGeo([TIMEOUT, UNAVAILABLE]);
  await assert.rejects(locate(fast), (e) => e.problem === "unavailable");
});

test("no geolocation, or an insecure page, is reported clearly", async () => {
  Object.defineProperty(globalThis, "navigator", { value: { userAgent: "test" }, configurable: true });
  await assert.rejects(locate(fast), (e) => e.problem === "unsupported");
  fakeGeo([{ lat: 1, lon: 1 }]);
  globalThis.window.isSecureContext = false;
  await assert.rejects(locate(fast), (e) => e.problem === "insecure");
});

test("following skips a rough fix that would make the dot jump, then stops cleanly", () => {
  const { geo } = fakeGeo([]);
  const seen = [];
  const stop = follow((fix) => seen.push(fix));
  const at = Date.now();
  geo.watcher.ok({ coords: { latitude: 33.45, longitude: -112.07, accuracy: 10 }, timestamp: at });
  geo.watcher.ok({ coords: { latitude: 33.47, longitude: -112.1, accuracy: 900 }, timestamp: at + 5000 });
  geo.watcher.ok({ coords: { latitude: 33.4502, longitude: -112.0701, accuracy: 12 }, timestamp: at + 10000 });
  assert.deepEqual(seen.map((f) => f.accuracy), [10, 12]);
  stop();
  assert.equal(geo.cleared, 7);
});

test("following reports when it stops working", () => {
  const { geo } = fakeGeo([]);
  let problem = null;
  follow(() => {}, (p) => { problem = p; });
  geo.watcher.fail({ code: DENIED });
  assert.equal(problem, "denied");
});

test("help text matches the phone", () => {
  assert.equal(platform("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)"), "ios");
  assert.equal(platform("Mozilla/5.0 (Linux; Android 15; Pixel 9)"), "android");
  assert.equal(platform("Mozilla/5.0 (Windows NT 10.0; Win64; x64)"), "desktop");
});

test("only a rounded point is ever put in a request", () => {
  assert.equal(roundedQuery({ lat: 33.448376, lon: -112.074036 }), "lat=33.45&lon=-112.07");
});
