import saved from "../data/places.json";

/*
  The saved copy of cool spots for metro Phoenix and Tucson (scripts/fetch-places.mjs,
  refreshed monthly). Answering from it means Cool spots doesn't depend on the busy public
  OpenStreetMap servers while someone is standing in the heat waiting for it.
*/

export type Snapshot = {
  updated: string;
  regions: Array<{ name: string; box: [number, number, number, number] }>;
  kinds: string[];
  places: Array<[number, number, number, number, string | null, string | null]>;
};

export type SnapshotElement = { id: number; lat: number; lon: number; tags: Record<string, string> };

const TAGS: Record<string, Record<string, string>> = {
  water: { amenity: "drinking_water" },
  library: { amenity: "library" },
  community: { amenity: "community_centre" },
  mall: { shop: "mall" },
  shade: { amenity: "shelter" },
};

export const savedPlaces = saved as unknown as Snapshot;

/** How far the search reaches, matching the live query (about 3 km each way). */
const REACH_M = 3000;

function boxAround(lat: number, lon: number) {
  const dLat = REACH_M / 111_320;
  const dLon = REACH_M / (111_320 * Math.cos((lat * Math.PI) / 180));
  return { south: lat - dLat, north: lat + dLat, west: lon - dLon, east: lon + dLon };
}

/**
 * Places from the saved copy near a point, shaped like Overpass elements.
 * `complete` is false when the 3 km box reaches past the saved area, so the caller
 * knows a live lookup could find more.
 */
export function snapshotElements(lat: number, lon: number, snapshot: Snapshot = savedPlaces) {
  const b = boxAround(lat, lon);
  const complete = snapshot.regions.some(({ box: [s, w, n, e] }) => b.south >= s && b.north <= n && b.west >= w && b.east <= e);
  const touches = snapshot.regions.some(({ box: [s, w, n, e] }) => b.north >= s && b.south <= n && b.east >= w && b.west <= e);
  if (!touches) return { elements: [] as SnapshotElement[], complete: false, covered: false, updated: snapshot.updated };
  const elements: SnapshotElement[] = [];
  for (const [id, kind, pLat, pLon, name, hours] of snapshot.places) {
    if (pLat < b.south || pLat > b.north || pLon < b.west || pLon > b.east) continue;
    const tags = { ...TAGS[snapshot.kinds[kind]] };
    if (name) tags.name = name;
    if (hours) tags.opening_hours = hours;
    elements.push({ id, lat: pLat, lon: pLon, tags });
  }
  return { elements, complete, covered: true, updated: snapshot.updated };
}
