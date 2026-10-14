/*
  Saves the official Heat Relief Network sites (Maricopa Association of Governments) to
  src/data/heat-relief.json. The server asks the live feed first; this copy is what it
  uses if the feed can't be reached. Run weekly by the "Cool spots data" workflow.

  node scripts/fetch-heat-relief.mjs [out-file]
*/
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const out = process.argv[2] ?? path.resolve(here, "../src/data/heat-relief.json");
const URL_ = "https://services1.arcgis.com/MdyCMZnX1raZ7TS3/arcgis/rest/services/HRN_Public_view/FeatureServer/0/query";
// Keep in step with FIELDS in src/lib/heat-relief.ts.
const FIELDS = [
  "OBJECTID", "Location", "Organization", "Address", "PrimaryPhone", "HeatRelief_Type", "Start_Date", "End_Date",
  "Status", "Active", "Pets", "ADA_accessible", "Note",
  ...["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"].flatMap((d) => [`${d}Open`, `${d}Close`]),
];

async function current() {
  try { return JSON.parse(await readFile(out, "utf8")); } catch { return null; }
}

try {
  const params = new URLSearchParams({ where: "1=1", outFields: FIELDS.join(","), outSR: "4326", f: "json", resultRecordCount: "2000" });
  const res = await fetch(`${URL_}?${params}`, { signal: AbortSignal.timeout(60_000) });
  if (!res.ok) throw new Error(`answered ${res.status}`);
  const data = await res.json();
  if (!Array.isArray(data.features)) throw new Error(data.error?.message ?? "no features");
  const features = data.features.map(({ attributes, geometry }) => ({
    attributes: Object.fromEntries(FIELDS.map((f) => [f, attributes[f] ?? null])),
    geometry: geometry ? { x: Math.round(geometry.x * 1e6) / 1e6, y: Math.round(geometry.y * 1e6) / 1e6 } : null,
  }));
  // Off-season the feed can legitimately be empty; keep last season's copy for its dates.
  const previous = await current();
  if (features.length === 0 && previous?.features?.length) {
    console.log("::notice::Heat Relief Network is empty right now (off-season); keeping the saved copy.");
    process.exit(0);
  }
  const updated = new Date(Date.now() - 7 * 3_600_000).toISOString().slice(0, 10);
  await mkdir(path.dirname(out), { recursive: true });
  await writeFile(out, JSON.stringify({ source: "Maricopa Association of Governments, Heat Relief Network", updated, features }).replace(/\},\{"attributes"/g, '},\n{"attributes"'));
  console.log(`::notice::Heat Relief Network: ${features.length} sites`);
} catch (error) {
  const previous = await current();
  if (previous) {
    console.log(`::warning::Couldn't refresh the Heat Relief Network (${error.message}); keeping the saved copy from ${previous.updated}.`);
    process.exit(0);
  }
  console.log(`::error::Couldn't download the Heat Relief Network: ${error.message}`);
  process.exit(1);
}
