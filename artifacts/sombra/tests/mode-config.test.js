import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { resolveAudienceMode } from "../lib/modes.js";
import { buildWorkRestSchedule } from "../lib/schedule.js";
const workers = JSON.parse(await readFile(new URL("../config/modes/workers.json", import.meta.url), "utf8"));
const workRestTable = JSON.parse(await readFile(new URL("../config/work_rest_table.json", import.meta.url), "utf8"));
const indexHtml = await readFile(new URL("../public/planner.html", import.meta.url), "utf8");
const workerModule = { "../config/modes/workers.json": workers };
const modeModules = {
  ...workerModule,
  ...Object.fromEntries(await Promise.all(["work", "school", "everyday"].map(async (id) => [
    `../config/modes/${id}.json`,
    JSON.parse(await readFile(new URL(`../config/modes/${id}.json`, import.meta.url), "utf8")),
  ]))),
};

test("the workers mode keeps audience copy, task examples, and check-in questions in configuration", () => {
  assert.equal(resolveAudienceMode(workerModule, "workers"), workers);
  assert.deepEqual(
    workers.locales.en.taskIntensities.map(({ value }) => value).sort(),
    Object.keys(workRestTable.categories["0"]).filter((key) =>
      ["easy", "moderate", "hard"].includes(key),
    ).sort(),
  );
  for (const locale of Object.values(workers.locales)) {
    assert.deepEqual(
      locale.taskIntensities.map(({ value }) => value),
      workers.locales.en.taskIntensities.map(({ value }) => value),
    );
    for (const intensity of locale.taskIntensities) {
      assert.ok(intensity.label.trim());
      assert.ok(intensity.forecastLabel.trim());
      assert.ok(intensity.example.trim());
    }
    assert.ok(Array.isArray(locale.checkIn.questions));
  }
});

test("adding another same-shape audience config needs no audience-specific loader logic", () => {
  const schoolMode = structuredClone(workers);
  schoolMode.id = "schools";
  schoolMode.locales.en.ui.workerName = "Student or staff name";
  const registry = { "../config/modes/schools.json": schoolMode };
  assert.deepEqual(resolveAudienceMode(registry, "schools"), schoolMode);
});

test("unknown or invalid audience mode IDs fail explicitly", () => {
  assert.throws(() => resolveAudienceMode(workerModule, "schools"), /not configured/);
  assert.throws(() => resolveAudienceMode(workerModule, "../schools"), /mode IDs/);
});

test("school applies one configured risk step without double-bumping and stops at Extreme", () => {
  const school = resolveAudienceMode(modeModules, "school");
  const base = {
    hours: [{ time: "13:00", wbgtF: 85 }],
    intensity: "moderate",
    newToHeat: false,
    table: workRestTable,
  };
  const regular = buildWorkRestSchedule({ ...base, categoryIncrease: 0 });
  const adjusted = buildWorkRestSchedule({
    ...base,
    categoryIncrease: school.rules.categoryIncrease,
    stopAtExtreme: school.rules.stopAtExtreme,
  });
  assert.equal(regular.hours[0].category, 3);
  assert.equal(adjusted.hours[0].category, 4);
  const alsoNewToHeat = buildWorkRestSchedule({
    ...base,
    newToHeat: true,
    categoryIncrease: school.rules.categoryIncrease,
    stopAtExtreme: school.rules.stopAtExtreme,
  });
  assert.equal(alsoNewToHeat.hours[0].category, 4);
  const extreme = buildWorkRestSchedule({
    ...base,
    hours: [{ time: "13:00", wbgtF: 90 }],
    categoryIncrease: school.rules.categoryIncrease,
    stopAtExtreme: school.rules.stopAtExtreme,
  });
  assert.equal(extreme.hours[0].category, 5);
  assert.equal(extreme.hours[0].stopWork, true);
});

test("everyday outdoor advice starts at its configured Very High category", () => {
  const outdoors = resolveAudienceMode(modeModules, "everyday");
  assert.equal(outdoors.rules.categoryIncrease, 0);
  assert.equal(outdoors.rules.coolerAdviceCategory, 4);
});

test("mode copy resources have matching nested keys across locales", () => {
  const keys = (value, prefix = "") => Object.entries(value).flatMap(([key, item]) =>
    item && typeof item === "object" ? keys(item, `${prefix}${key}.`) : `${prefix}${key}`,
  ).sort();
  assert.deepEqual(keys(workers.locales.en), keys(workers.locales.es));
});

test("all planner and results copy referenced by the UI exists in each audience locale", () => {
  const getPath = (value, key) => key.split(".").reduce((current, part) => current?.[part], value);
  const references = [
    ...[...indexHtml.matchAll(/data-mode-copy="([^"]+)"/g)].map(([, key]) => `ui.${key}`),
    ...[...indexHtml.matchAll(/data-mode-aria="([^"]+)"/g)].map(([, key]) => `ui.${key}`),
    ...[...indexHtml.matchAll(/data-mode-placeholder="([^"]+)"/g)].map(([, key]) => `ui.${key}`),
    ...[...indexHtml.matchAll(/data-mode-meta="([^"]+)"/g)].map(([, key]) => `ui.${key}`),
    ...[...indexHtml.matchAll(/data-i18n(?:-aria-label)?="([^"]+)"/g)].map(([, key]) => key),
  ];
  for (const locale of Object.values(workers.locales)) {
    for (const key of references) assert.equal(typeof getPath(locale, key), "string", `Missing mode copy: ${key}`);
  }
  for (const { example } of workers.locales.en.taskIntensities) {
    assert.equal(indexHtml.includes(example), false, `Task example should come from the mode config: ${example}`);
  }
});
