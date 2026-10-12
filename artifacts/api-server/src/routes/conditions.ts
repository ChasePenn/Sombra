import { Router, type IRouter, type Request } from "express";
import { WEATHER_TIMEZONE } from "../config/weather";
import { snapshotElements } from "../lib/places-snapshot";

export { snapshotElements };

/*
  Outdoor conditions beyond heat:
  - GET /conditions   official National Weather Service alerts + UV index and air quality
  - GET /places/cool  nearby water refill spots, libraries, malls and shelters (OpenStreetMap).
                      Metro Phoenix and Tucson answer from a saved monthly copy; elsewhere asks
                      the live map servers and falls back to the last good answer.
  Each upstream source is optional: if one fails, the others are still returned.
*/

const router: IRouter = Router();
const REQUEST_TIMEOUT_MS = 8_000;
const CACHE_TTL_MS = 10 * 60 * 1000;

export const NWS_ALERTS_URL = "https://api.weather.gov/alerts/active";
export const AIR_QUALITY_URL = "https://air-quality-api.open-meteo.com/v1/air-quality";
export const OVERPASS_URL = "https://overpass-api.de/api/interpreter";
// The main Overpass server has been overloaded since spring 2026 and sometimes turns
// requests away; two community servers are the backup.
// List from https://wiki.openstreetmap.org/wiki/Overpass_API (public instances).
export const OVERPASS_MIRRORS = [
  OVERPASS_URL,
  "https://overpass.private.coffee/api/interpreter",
  "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
];
// Places barely change day to day; keeping them a day spares the shared servers.
const PLACES_TTL_MS = 24 * 60 * 60 * 1000;
// NWS asks every client to identify itself.
const NWS_USER_AGENT = "sombra-heat-safety (https://github.com/ChasePenn/sombra)";

type CacheEntry = { expires: number; value: unknown };
const cache = new Map<string, CacheEntry>();

async function cached<T>(key: string, load: () => Promise<T>, ttl = CACHE_TTL_MS): Promise<T> {
  const hit = cache.get(key);
  if (hit && hit.expires > Date.now()) return hit.value as T;
  const value = await load();
  cache.set(key, { expires: Date.now() + ttl, value });
  if (cache.size > 500) cache.delete(cache.keys().next().value as string);
  return value;
}

export function parseCoordinates(req: Request): { lat: number; lon: number } | null {
  const lat = Number(req.query.lat);
  const lon = Number(req.query.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
    return null;
  }
  // About 1 km precision is plenty and keeps exact locations out of cache keys and upstream calls.
  return { lat: Math.round(lat * 100) / 100, lon: Math.round(lon * 100) / 100 };
}

// --- Official alerts -------------------------------------------------------

interface NwsFeature {
  properties?: {
    event?: string;
    severity?: string;
    headline?: string;
    instruction?: string | null;
    ends?: string | null;
    expires?: string | null;
  };
}

const HEAT_EVENTS = /heat/i;
const AIR_EVENTS = /dust|air quality|smoke|ozone/i;

export function summarizeAlerts(features: NwsFeature[], now = Date.now()) {
  return features
    .map((feature) => feature.properties ?? {})
    .filter((p) => typeof p.event === "string" && p.event.length > 0)
    // Never show an alert that has already ended.
    .filter((p) => {
      const end = Date.parse(p.ends ?? p.expires ?? "");
      return Number.isNaN(end) || end > now;
    })
    .map((p) => ({
      event: p.event as string,
      kind: HEAT_EVENTS.test(p.event as string) ? "heat" : AIR_EVENTS.test(p.event as string) ? "air" : "other",
      severity: p.severity ?? "Unknown",
      headline: p.headline ?? p.event,
      instruction: p.instruction ? p.instruction.slice(0, 600) : null,
      ends: p.ends ?? p.expires ?? null,
    }))
    // Heat alerts first, then air, then everything else.
    .sort((a, b) => ["heat", "air", "other"].indexOf(a.kind) - ["heat", "air", "other"].indexOf(b.kind))
    .slice(0, 5);
}

async function loadAlerts(lat: number, lon: number) {
  const url = new URL(NWS_ALERTS_URL);
  url.searchParams.set("point", `${lat},${lon}`);
  // The weather.gov API has short hiccups; one retry two seconds later covers most of them.
  let lastError: unknown = null;
  for (const delay of [0, 2_000]) {
    if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
    try {
      const response = await fetch(url, {
        headers: { "User-Agent": NWS_USER_AGENT, Accept: "application/geo+json" },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (!response.ok) throw new Error(`NWS alerts failed with ${response.status}`);
      const data = (await response.json()) as { features?: NwsFeature[] };
      return summarizeAlerts(data.features ?? []);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

// --- UV and air quality ----------------------------------------------------

interface AirQualityHourly {
  time: string[];
  us_aqi?: Array<number | null>;
  uv_index?: Array<number | null>;
  dust?: Array<number | null>;
}

export function aqiLevel(aqi: number | null) {
  if (aqi == null) return null;
  if (aqi <= 50) return "good";
  if (aqi <= 100) return "moderate";
  if (aqi <= 150) return "sensitive";
  if (aqi <= 200) return "unhealthy";
  if (aqi <= 300) return "very_unhealthy";
  return "hazardous";
}

export function uvLevel(uv: number | null) {
  if (uv == null) return null;
  if (uv < 3) return "low";
  if (uv < 6) return "moderate";
  if (uv < 8) return "high";
  if (uv < 11) return "very_high";
  return "extreme";
}

/** Reduce hourly air data to what the app shows: now, today's peak, and when the peak happens. */
export function summarizeAirQuality(hourly: AirQualityHourly, nowIso: string) {
  const today = nowIso.slice(0, 10);
  const nowHour = nowIso.slice(0, 13);
  const pick = (values: Array<number | null> | undefined, [min, max]: [number, number]) => {
    if (!values) return { now: null, peak: null, peakTime: null };
    let now: number | null = null;
    let peak: number | null = null;
    let peakTime: string | null = null;
    hourly.time.forEach((time, index) => {
      const value = values[index];
      // Drop readings outside physically possible ranges instead of showing bad data.
      if (value == null || !Number.isFinite(value) || value < min || value > max) return;
      if (time.slice(0, 13) === nowHour) now = value;
      if (time.slice(0, 10) === today && (peak == null || value > peak)) {
        peak = value;
        peakTime = time.slice(11, 16);
      }
    });
    return { now, peak, peakTime };
  };
  const uv = pick(hourly.uv_index, [0, 20]);
  const aqi = pick(hourly.us_aqi, [0, 500]);
  const dust = pick(hourly.dust, [0, 5000]);
  return {
    uv: { ...uv, level: uvLevel(uv.peak) },
    aqi: { ...aqi, level: aqiLevel(aqi.peak) },
    dustPeak: dust.peak,
  };
}

function phoenixNowIso() {
  // Phoenix stays on UTC-7 year-round.
  return new Date(Date.now() - 7 * 60 * 60 * 1000).toISOString().slice(0, 16);
}

async function loadAirQuality(lat: number, lon: number) {
  const url = new URL(AIR_QUALITY_URL);
  url.searchParams.set("latitude", String(lat));
  url.searchParams.set("longitude", String(lon));
  url.searchParams.set("hourly", "us_aqi,uv_index,dust");
  url.searchParams.set("timezone", WEATHER_TIMEZONE);
  url.searchParams.set("forecast_days", "1");
  const response = await fetch(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  if (!response.ok) throw new Error(`Air quality failed with ${response.status}`);
  const data = (await response.json()) as { hourly?: AirQualityHourly };
  if (!data.hourly?.time) throw new Error("Air quality response had no hourly data");
  return summarizeAirQuality(data.hourly, phoenixNowIso());
}

/** The current official heat alert for a point (rounded to about 1 km), or null. Used by push reminders. */
export async function heatAlertFor(lat: number, lon: number) {
  const point = { lat: Math.round(lat * 100) / 100, lon: Math.round(lon * 100) / 100 };
  const alerts = await cached(`alerts:${point.lat},${point.lon}`, () => loadAlerts(point.lat, point.lon));
  const heat = alerts.find((alert) => alert.kind === "heat");
  return heat ? { event: heat.event, ends: heat.ends } : null;
}

router.get("/conditions", async (req, res): Promise<void> => {
  const point = parseCoordinates(req);
  if (!point) {
    res.status(400).json({ error: "Choose a location first." });
    return;
  }
  const key = `${point.lat},${point.lon}`;
  const [alerts, air] = await Promise.allSettled([
    cached(`alerts:${key}`, () => loadAlerts(point.lat, point.lon)),
    cached(`air:${key}`, () => loadAirQuality(point.lat, point.lon)),
  ]);
  if (alerts.status === "rejected") req.log.error({ err: alerts.reason }, "Unable to load NWS alerts");
  if (air.status === "rejected") req.log.error({ err: air.reason }, "Unable to load air quality");
  res.json({
    alerts: alerts.status === "fulfilled" ? alerts.value : null,
    air: air.status === "fulfilled" ? air.value : null,
  });
});

// --- Cool spots ------------------------------------------------------------

interface OverpassElement {
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
}

export function distanceMeters(a: { lat: number; lon: number }, b: { lat: number; lon: number }) {
  const r = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * r * Math.asin(Math.sqrt(h));
}

export function placeKind(tags: Record<string, string>) {
  if (tags.amenity === "drinking_water") return "water";
  if (tags.amenity === "library") return "library";
  if (tags.amenity === "community_centre") return "community";
  if (tags.shop === "mall") return "mall";
  if (tags.amenity === "shelter") return "shade";
  return null;
}

export function summarizePlaces(elements: OverpassElement[], origin: { lat: number; lon: number }) {
  const seen = new Set<string>();
  return elements
    .map((element) => {
      const tags = element.tags ?? {};
      const kind = placeKind(tags);
      const lat = element.lat ?? element.center?.lat;
      const lon = element.lon ?? element.center?.lon;
      if (!kind || lat == null || lon == null) return null;
      return {
        id: element.id,
        kind,
        name: tags.name ?? null,
        lat,
        lon,
        openingHours: tags.opening_hours ?? null,
        distanceM: Math.round(distanceMeters(origin, { lat, lon })),
      };
    })
    .filter((place): place is NonNullable<typeof place> => place !== null)
    // Overpass "around" is a radius search; anything far outside it is bad data.
    .filter((place) => Number.isFinite(place.distanceM) && place.distanceM <= 3600)
    // Unnamed water fountains and shade shelters are still useful; unnamed buildings are not.
    .filter((place) => place.name || place.kind === "water" || place.kind === "shade")
    .filter((place) => {
      const key = `${place.kind}:${place.name ?? place.id}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => a.distanceM - b.distanceM)
    .slice(0, 30);
}

/** A box about 3 km around the point. Box filters cost the Overpass server far less than radius searches. */
export function placesQuery(lat: number, lon: number) {
  const dLat = 3000 / 111_320;
  const dLon = 3000 / (111_320 * Math.cos((lat * Math.PI) / 180));
  const box = [lat - dLat, lon - dLon, lat + dLat, lon + dLon].map((n) => n.toFixed(4)).join(",");
  return `[out:json][timeout:15][bbox:${box}];(node[amenity=drinking_water];nwr[amenity~"^(library|community_centre)$"];nwr[shop=mall];node[amenity=shelter];);out center 80;`;
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function loadPlaces(lat: number, lon: number) {
  const query = placesQuery(lat, lon);
  // The main server is busy but usually answers on a second try a few seconds later.
  // Overpass asks clients to back off for 30 s after a 429, so that case skips straight to the next server.
  const attempts: Array<{ url: string; delay: number }> = [
    { url: OVERPASS_URL, delay: 0 },
    { url: OVERPASS_URL, delay: 5_000 },
    ...OVERPASS_MIRRORS.filter((url) => url !== OVERPASS_URL).map((url) => ({ url, delay: 0 })),
  ];
  let lastError: unknown = null;
  let mainRateLimited = false;
  for (const { url, delay } of attempts) {
    if (url === OVERPASS_URL && mainRateLimited) continue;
    if (delay) await wait(delay);
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": NWS_USER_AGENT },
        body: new URLSearchParams({ data: query }),
        signal: AbortSignal.timeout(10_000),
      });
      if (response.status === 429 && url === OVERPASS_URL) mainRateLimited = true;
      if (!response.ok) throw new Error(`Overpass ${url} failed with ${response.status}`);
      const data = (await response.json()) as { elements?: OverpassElement[] };
      return summarizePlaces(data.elements ?? [], { lat, lon });
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

// The last good live answer for each spot, served if the map servers are down later.
const lastGood = new Map<string, { places: ReturnType<typeof summarizePlaces>; updated: string }>();

router.get("/places/cool", async (req, res): Promise<void> => {
  const point = parseCoordinates(req);
  if (!point) {
    res.status(400).json({ error: "Choose a location first." });
    return;
  }
  const saved = snapshotElements(point.lat, point.lon);
  const fromSaved = () => ({ places: summarizePlaces(saved.elements, point), source: "saved", updated: saved.updated });
  if (saved.complete) {
    res.json(fromSaved());
    return;
  }
  const key = `places:${point.lat},${point.lon}`;
  try {
    const places = await cached(key, () => loadPlaces(point.lat, point.lon), PLACES_TTL_MS);
    const updated = lastGood.get(key)?.places === places ? lastGood.get(key)!.updated : phoenixNowIso().slice(0, 10);
    lastGood.set(key, { places, updated });
    if (lastGood.size > 500) lastGood.delete(lastGood.keys().next().value as string);
    res.json({ places, source: "live", updated });
  } catch (error) {
    req.log.error({ err: error }, "Unable to load nearby cool spots");
    const last = lastGood.get(key);
    if (last) {
      res.json({ ...last, source: "live" });
      return;
    }
    // Near the edge of the saved area: part of the answer beats none.
    if (saved.covered && saved.elements.length) {
      res.json(fromSaved());
      return;
    }
    res.status(502).json({ error: "Nearby places are temporarily unavailable." });
  }
});

export default router;
