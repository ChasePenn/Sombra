import saved from "../data/heat-relief.json";

/*
  The official Heat Relief Network for metro Phoenix: cooling centers, hydration stations
  and respite centers run by cities, nonprofits and churches, published by the Maricopa
  Association of Governments (https://azmag.gov/Programs/Heat-Relief-Network).

  The public map's data feed is queried directly (it's hosted by Esri and reliable), kept
  for 6 hours, and backed by a saved copy (scripts/fetch-heat-relief.mjs, refreshed weekly)
  for when it can't be reached.
*/

export const HRN_URL = "https://services1.arcgis.com/MdyCMZnX1raZ7TS3/arcgis/rest/services/HRN_Public_view/FeatureServer/0/query";
const FIELDS = [
  "OBJECTID", "Location", "Organization", "Address", "PrimaryPhone", "HeatRelief_Type", "Start_Date", "End_Date",
  "Status", "Active", "Pets", "ADA_accessible", "Note",
  ...["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"].flatMap((d) => [`${d}Open`, `${d}Close`]),
];

export type ReliefSite = {
  id: number;
  type: "cooling" | "hydration" | "respite";
  name: string;
  org: string | null;
  address: string | null;
  phone: string | null;
  lat: number;
  lon: number;
  /** Season, as YYYY-MM-DD. */
  start: string | null;
  end: string | null;
  /** Opening minutes for Sunday..Saturday, or null when closed that day. */
  hours: Array<[number, number] | null>;
  /** 1 regular hours, 2/3 hours change with heat warnings, 4 open only during warnings. */
  status: number;
  pets: boolean | null;
  accessible: boolean | null;
};

export type ReliefData = { updated: string; sites: ReliefSite[] };

type Feature = { attributes: Record<string, unknown>; geometry?: { x: number; y: number } };

const TYPES: Record<string, ReliefSite["type"]> = { "Cooling Center": "cooling", "Hydration Station": "hydration", "Respite Center": "respite" };
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** "8:00 AM" -> 480, "11:59 PM" -> 1440 (end of day). */
export function parseClock(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const m = value.trim().match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (!m) return null;
  let h = Number(m[1]) % 12;
  if (m[3].toUpperCase() === "PM") h += 12;
  const minutes = h * 60 + Number(m[2]);
  return minutes === 23 * 60 + 59 ? 24 * 60 : minutes;
}

/** Dates arrive as "2026-05-01" (date-only fields) or epoch milliseconds. */
function dateOnly(value: unknown): string | null {
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}/.test(value)) return value.slice(0, 10);
  if (typeof value === "number" && Number.isFinite(value)) return new Date(value).toISOString().slice(0, 10);
  return null;
}

const text = (value: unknown) => (typeof value === "string" && value.trim() ? value.trim().replace(/\s+/g, " ") : null);
const yesNo = (value: unknown) => (value === "Yes" ? true : value === "No" ? false : null);

export function normalizeSites(features: Feature[]): ReliefSite[] {
  const sites: ReliefSite[] = [];
  for (const { attributes: a, geometry: g } of features) {
    const type = TYPES[String(a.HeatRelief_Type)];
    const name = text(a.Location);
    const status = Number(a.Status);
    if (!type || !name || !g || !Number.isFinite(g.x) || !Number.isFinite(g.y)) continue;
    // 5 temporarily closed, 6 permanently closed; "Active" is the publisher's own switch.
    if (status >= 5 || a.Active === "No") continue;
    if (Math.abs(g.y - 33.5) > 1.5 || Math.abs(g.x + 112.1) > 1.5) continue; // outside the region: bad point
    sites.push({
      id: Number(a.OBJECTID),
      type,
      name,
      org: text(a.Organization),
      address: text(a.Address),
      phone: text(a.PrimaryPhone),
      lat: Math.round(g.y * 1e5) / 1e5,
      lon: Math.round(g.x * 1e5) / 1e5,
      start: dateOnly(a.Start_Date),
      end: dateOnly(a.End_Date),
      hours: DAYS.map((d) => {
        const open = parseClock(a[`${d}Open`]);
        const close = parseClock(a[`${d}Close`]);
        return open != null && close != null && close > open ? [open, close] as [number, number] : null;
      }),
      status: Number.isFinite(status) ? status : 1,
      pets: yesNo(a.Pets),
      accessible: yesNo(a.ADA_accessible),
    });
  }
  return sites;
}

/** Is the site within its season on this Phoenix date? */
export const inSeason = (site: Pick<ReliefSite, "start" | "end">, today: string) =>
  (!site.start || site.start <= today) && (!site.end || today <= site.end);

export async function fetchRelief(fetcher: typeof fetch = fetch): Promise<ReliefData> {
  const params = new URLSearchParams({ where: "1=1", outFields: FIELDS.join(","), outSR: "4326", f: "json", resultRecordCount: "2000" });
  const res = await fetcher(`${HRN_URL}?${params}`, { signal: AbortSignal.timeout(10_000), headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`Heat Relief Network answered ${res.status}`);
  const data = (await res.json()) as { features?: Feature[]; error?: { message?: string } };
  if (!Array.isArray(data.features)) throw new Error(`Heat Relief Network sent no sites${data.error?.message ? `: ${data.error.message}` : ""}`);
  const phoenixToday = new Date(Date.now() - 7 * 3_600_000).toISOString().slice(0, 10);
  return { updated: phoenixToday, sites: normalizeSites(data.features) };
}

// The saved copy keeps the feed's raw answer, so it's read the same way as a live one.
const savedRaw = saved as unknown as { updated: string; features: Feature[] };
export const savedRelief: ReliefData = { updated: savedRaw.updated, sites: normalizeSites(savedRaw.features) };

const TTL_MS = 6 * 60 * 60 * 1000;
let cache: { at: number; data: ReliefData } | null = null;
let inflight: Promise<ReliefData> | null = null;

/** The current list: live when possible, else the last good answer, else the saved copy. */
export async function getRelief(fetcher: typeof fetch = fetch, now = Date.now()): Promise<ReliefData> {
  if (cache && now - cache.at < TTL_MS) return cache.data;
  inflight ??= fetchRelief(fetcher)
    .then((data) => {
      // An empty answer during the season is more likely a broken feed than no sites at all.
      if (data.sites.length === 0 && (cache?.data.sites.length || savedRelief.sites.length)) throw new Error("Heat Relief Network returned no sites");
      cache = { at: now, data };
      return data;
    })
    .finally(() => { inflight = null; });
  try {
    return await inflight;
  } catch {
    // Try again in 10 minutes rather than on every request.
    const fallback = cache?.data ?? savedRelief;
    cache = { at: now - TTL_MS + 10 * 60 * 1000, data: fallback };
    return fallback;
  }
}

export function resetReliefCacheForTests() { cache = null; inflight = null; }
