import { Router, type IRouter, type Request } from "express";
import { WEATHER_TIMEZONE } from "../config/weather";

/*
  Outdoor conditions beyond heat:
  - GET /conditions   official National Weather Service alerts + UV index and air quality
  - GET /places/cool  nearby water refill spots, libraries, malls and shelters (OpenStreetMap)
  Each upstream source is optional: if one fails, the others are still returned.
*/

const router: IRouter = Router();
const REQUEST_TIMEOUT_MS = 8_000;
const CACHE_TTL_MS = 10 * 60 * 1000;

export const NWS_ALERTS_URL = "https://api.weather.gov/alerts/active";
export const AIR_QUALITY_URL = "https://air-quality-api.open-meteo.com/v1/air-quality";
export const OVERPASS_URL = "https://overpass-api.de/api/interpreter";
// Public Overpass servers are busy and sometimes refuse requests; try mirrors in order.
export const OVERPASS_MIRRORS = [
  OVERPASS_URL,
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
];
// NWS asks every client to identify itself.
const NWS_USER_AGENT = "sombra-heat-safety (https://github.com/ChasePenn/sombra)";

type CacheEntry = { expires: number; value: unknown };
const cache = new Map<string, CacheEntry>();

async function cached<T>(key: string, load: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && hit.expires > Date.now()) return hit.value as T;
  const value = await load();
  cache.set(key, { expires: Date.now() + CACHE_TTL_MS, value });
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
  const response = await fetch(url, {
    headers: { "User-Agent": NWS_USER_AGENT, Accept: "application/geo+json" },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`NWS alerts failed with ${response.status}`);
  const data = (await response.json()) as { features?: NwsFeature[] };
  return summarizeAlerts(data.features ?? []);
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
    .slice(0, 20);
}

async function loadPlaces(lat: number, lon: number) {
  const radius = 3000;
  const around = `(around:${radius},${lat},${lon})`;
  const query = `[out:json][timeout:15];(
    node["amenity"="drinking_water"]${around};
    nwr["amenity"="library"]${around};
    nwr["amenity"="community_centre"]${around};
    nwr["shop"="mall"]${around};
    node["amenity"="shelter"]${around};
  );out center 80;`;
  let lastError: unknown = null;
  for (const url of OVERPASS_MIRRORS) {
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": NWS_USER_AGENT },
        body: new URLSearchParams({ data: query }),
        signal: AbortSignal.timeout(20_000),
      });
      if (!response.ok) throw new Error(`Overpass ${url} failed with ${response.status}`);
      const data = (await response.json()) as { elements?: OverpassElement[] };
      return summarizePlaces(data.elements ?? [], { lat, lon });
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

router.get("/places/cool", async (req, res): Promise<void> => {
  const point = parseCoordinates(req);
  if (!point) {
    res.status(400).json({ error: "Choose a location first." });
    return;
  }
  try {
    const places = await cached(`places:${point.lat},${point.lon}`, () => loadPlaces(point.lat, point.lon));
    res.json({ places });
  } catch (error) {
    req.log.error({ err: error }, "Unable to load nearby cool spots");
    res.status(502).json({ error: "Nearby places are temporarily unavailable." });
  }
});

export default router;
