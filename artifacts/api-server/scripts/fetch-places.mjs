/*
  Downloads every cool spot sombra lists (water fountains, libraries, community centers,
  malls, shade shelters) for metro Phoenix and Tucson from OpenStreetMap, and saves them to
  src/data/places.json. The server answers from this file, so Cool spots works even when the
  shared OpenStreetMap servers are busy. A monthly GitHub workflow runs this again.

  node scripts/fetch-places.mjs [out-file]
*/
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const out = process.argv[2] ?? path.resolve(here, "../src/data/places.json");

// south, west, north, east
const REGIONS = [
  { name: "Phoenix metro", box: [33.15, -112.65, 33.95, -111.45], min: 400 },
  { name: "Tucson", box: [32.0, -111.2, 32.5, -110.65], min: 100 },
];

const SERVERS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
  "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
];

const KIND_CODE = { water: 0, library: 1, community: 2, mall: 3, shade: 4 };

function kindOf(tags) {
  if (tags.amenity === "drinking_water") return "water";
  if (tags.amenity === "library") return "library";
  if (tags.amenity === "community_centre") return "community";
  if (tags.shop === "mall") return "mall";
  if (tags.amenity === "shelter") return "shade";
  return null;
}

const query = (box) => `[out:json][timeout:120][bbox:${box.join(",")}];(node[amenity=drinking_water];nwr[amenity~"^(library|community_centre)$"];nwr[shop=mall];node[amenity=shelter];);out center;`;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function download(box) {
  let last;
  for (let round = 0; round < 3; round++) {
    for (const url of SERVERS) {
      try {
        const res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": "sombra-heat-safety (https://github.com/ChasePenn/sombra)" },
          body: new URLSearchParams({ data: query(box) }),
          signal: AbortSignal.timeout(150_000),
        });
        if (!res.ok) throw new Error(`${url} answered ${res.status}`);
        const data = await res.json();
        if (!Array.isArray(data.elements)) throw new Error(`${url} sent no elements`);
        return data.elements;
      } catch (err) {
        last = err;
        // "::warning::" shows the reason on the GitHub run page.
        console.warn(`::warning::try failed: ${err.message}`);
      }
    }
    await wait(20_000);
  }
  throw last;
}

const places = [];
const seen = new Set();
for (const region of REGIONS) {
  const elements = await download(region.box);
  let count = 0;
  for (const el of elements) {
    const tags = el.tags ?? {};
    const kind = kindOf(tags);
    const lat = el.lat ?? el.center?.lat;
    const lon = el.lon ?? el.center?.lon;
    if (!kind || lat == null || lon == null) continue;
    // Unnamed buildings aren't useful; unnamed fountains and shelters are.
    if (!tags.name && kind !== "water" && kind !== "shade") continue;
    const id = `${el.type?.[0] ?? "n"}${el.id}`;
    if (seen.has(id)) continue;
    seen.add(id);
    places.push([el.id, KIND_CODE[kind], Math.round(lat * 1e5) / 1e5, Math.round(lon * 1e5) / 1e5, tags.name ?? null, tags.opening_hours ?? null]);
    count++;
  }
  console.log(`::notice::${region.name}: ${count} places`);
  // Sanity check: a broken answer shouldn't replace good data.
  if (count < region.min) throw new Error(`Only ${count} places for ${region.name}; not saving.`);
}

places.sort((a, b) => a[2] - b[2] || a[3] - b[3]);
const body = {
  source: "OpenStreetMap contributors (ODbL)",
  // Phoenix date (UTC-7 all year).
  updated: new Date(Date.now() - 7 * 3_600_000).toISOString().slice(0, 10),
  regions: REGIONS.map(({ name, box }) => ({ name, box })),
  kinds: Object.keys(KIND_CODE),
  fields: ["id", "kind", "lat", "lon", "name", "openingHours"],
  places,
};
await mkdir(path.dirname(out), { recursive: true });
await writeFile(out, JSON.stringify(body).replace(/\],\[/g, "],\n["));
console.log(`Saved ${places.length} places to ${out}`);
