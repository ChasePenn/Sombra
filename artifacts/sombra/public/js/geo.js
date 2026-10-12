/*
  Finding where someone is, as reliably as a browser allows. Used by every "Use my
  location" button and by the live dot on the map.

  Browsers fail in a few known ways, and each one is handled here:
  - A quick, low-power fix usually works in a second or two (Wi-Fi or cell towers). If it
    times out or isn't available, try again with GPS, which is slower but works outdoors.
  - Some browsers never answer at all when the permission prompt is dismissed, so our own
    timer gives up instead of spinning forever.
  - If both tries fail, a fix from the last 30 minutes is used (and marked as older).
  - "Blocked" is reported separately, so the screen can say how to turn location back on.

  The exact position stays on the phone. Only a rounded point (about 1 km) is ever sent
  to sombra's server.
*/

const LAST_FIX = "sombra.last-fix";
const STALE_OK_MS = 30 * 60 * 1000;

/** @typedef {{ lat: number, lon: number, accuracy: number, at: number, stale?: boolean }} Fix */
/** @typedef {"denied" | "unavailable" | "timeout" | "unsupported" | "insecure"} GeoProblem */

export class GeoError extends Error {
  /** @param {GeoProblem} problem */
  constructor(problem) {
    super(problem);
    this.problem = problem;
  }
}

function geolocation() {
  if (typeof window !== "undefined" && window.isSecureContext === false) throw new GeoError("insecure");
  if (typeof navigator === "undefined" || !navigator.geolocation) throw new GeoError("unsupported");
  return navigator.geolocation;
}

/** @param {GeolocationPosition} position @returns {Fix} */
function toFix(position) {
  return {
    lat: position.coords.latitude,
    lon: position.coords.longitude,
    accuracy: Math.round(position.coords.accuracy || 0),
    at: position.timestamp || Date.now(),
  };
}

/** @param {Fix} fix */
function remember(fix) {
  try { localStorage.setItem(LAST_FIX, JSON.stringify(fix)); } catch { /* private mode: fine */ }
}

/** The last fix this phone got, if it's recent enough to be useful. */
export function lastFix(maxAgeMs = STALE_OK_MS, now = Date.now()) {
  try {
    const fix = JSON.parse(localStorage.getItem(LAST_FIX) || "null");
    if (fix && Number.isFinite(fix.lat) && Number.isFinite(fix.lon) && now - fix.at <= maxAgeMs) return fix;
  } catch { /* ignore */ }
  return null;
}

/** @param {GeolocationPositionError} error @returns {GeoProblem} */
function problemOf(error) {
  if (error && error.code === 1) return "denied";
  if (error && error.code === 3) return "timeout";
  return "unavailable";
}

/** One getCurrentPosition call that always settles, even if the browser never answers. */
function once(geo, options, guardMs) {
  return new Promise((resolve, reject) => {
    let done = false;
    const guard = setTimeout(() => {
      if (done) return;
      done = true;
      // The browser never answered (often a permission prompt that was closed, not answered).
      const error = new GeoError("timeout");
      error.hung = true;
      reject(error);
    }, guardMs);
    try {
      geo.getCurrentPosition(
        (position) => { if (!done) { done = true; clearTimeout(guard); resolve(toFix(position)); } },
        (error) => { if (!done) { done = true; clearTimeout(guard); reject(new GeoError(problemOf(error))); } },
        options,
      );
    } catch {
      done = true;
      clearTimeout(guard);
      reject(new GeoError("unavailable"));
    }
  });
}

/**
 * Where the phone is now. Resolves with a fix, or rejects with a GeoError whose
 * `problem` says why. `onRetry` is called when the slower GPS try starts.
 * @param {{ onRetry?: () => void, quickMs?: number, preciseMs?: number, graceMs?: number }} [options]
 * @returns {Promise<Fix>}
 */
export async function locate({ onRetry, quickMs = 8000, preciseMs = 20000, graceMs = 7000 } = {}) {
  const geo = geolocation();
  try {
    const fix = await once(geo, { enableHighAccuracy: false, timeout: quickMs, maximumAge: 2 * 60 * 1000 }, quickMs + graceMs);
    remember(fix);
    return fix;
  } catch (error) {
    // A block won't change by asking again; the person has to allow it.
    if (error.problem === "denied") throw error;
    // A browser that didn't answer at all won't answer a second time either.
    if (error.hung) {
      const recent = lastFix();
      if (recent) return { ...recent, stale: true };
      throw error;
    }
  }
  onRetry?.();
  try {
    const fix = await once(geo, { enableHighAccuracy: true, timeout: preciseMs, maximumAge: 0 }, preciseMs + graceMs);
    remember(fix);
    return fix;
  } catch (error) {
    if (error.problem === "denied") throw error;
    const recent = lastFix();
    if (recent) return { ...recent, stale: true };
    throw error;
  }
}

/**
 * Follows the phone as it moves. Calls onFix with each new position and onProblem if
 * following stops working. Returns a function that stops following.
 * @param {(fix: Fix) => void} onFix
 * @param {(problem: GeoProblem) => void} [onProblem]
 */
export function follow(onFix, onProblem) {
  let geo;
  try { geo = geolocation(); } catch (error) { onProblem?.(error.problem); return () => {}; }
  let best = null;
  let lastSaved = 0;
  const id = geo.watchPosition(
    (position) => {
      const fix = toFix(position);
      // A rough network fix arriving after a good GPS fix would make the dot jump; skip it
      // unless the good one is getting old.
      if (best && fix.accuracy > best.accuracy * 4 && fix.at - best.at < 60_000) return;
      best = fix;
      if (fix.at - lastSaved > 30_000) { remember(fix); lastSaved = fix.at; }
      onFix(fix);
    },
    (error) => onProblem?.(problemOf(error)),
    { enableHighAccuracy: true, maximumAge: 5000, timeout: 30000 },
  );
  return () => geo.clearWatch(id);
}

/** "granted", "denied", "prompt", or "unknown" when the browser won't say (older Safari). */
export async function permission() {
  try {
    const status = await navigator.permissions.query({ name: "geolocation" });
    return status.state;
  } catch {
    return "unknown";
  }
}

/** Which kind of phone or computer, for "how to turn location back on" help. */
export function platform(userAgent = typeof navigator === "undefined" ? "" : navigator.userAgent) {
  if (/iPhone|iPad|iPod/i.test(userAgent) || (/Macintosh/.test(userAgent) && typeof document !== "undefined" && "ontouchend" in document)) return "ios";
  if (/Android/i.test(userAgent)) return "android";
  return "desktop";
}

/** Distance in meters between two points. */
export function metersBetween(a, b) {
  const r = 6371000;
  const rad = (d) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * r * Math.asin(Math.sqrt(h));
}

/** The "lat=…&lon=…" part of a request, rounded to about 1 km so exact spots never leave the phone. */
export function roundedQuery(point) {
  const r = (n) => (Math.round(n * 100) / 100).toFixed(2);
  return `lat=${r(point.lat)}&lon=${r(point.lon)}`;
}
