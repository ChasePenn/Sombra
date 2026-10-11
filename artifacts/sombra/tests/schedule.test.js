import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { buildWorkRestSchedule } from "../lib/schedule.js";

const table = JSON.parse(
  await readFile(new URL("../config/work_rest_table.json", import.meta.url), "utf8"),
);

function schedule(wbgtF, overrides = {}) {
  return buildWorkRestSchedule({
    hours: [{ time: "10:00", wbgtF }],
    intensity: "moderate",
    newToHeat: false,
    table,
    ...overrides,
  });
}

test("selects each category at its stated WBGT threshold", () => {
  const cases = [
    [77.9, 0],
    [77.99, 0],
    [78, 1],
    [81.99, 1],
    [82, 2],
    [84.99, 2],
    [85, 3],
    [87.99, 3],
    [88, 4],
    [89.99, 4],
    [90, 5],
    [115, 5],
  ];
  for (const [wbgtF, expectedCategory] of cases) {
    assert.equal(schedule(wbgtF).hours[0].category, expectedCategory, `${wbgtF}°F`);
  }
});

test("moves new workers up one category and caps the increase at extreme", () => {
  const belowThreshold = schedule(77, {
    newToHeat: true,
  });
  const extreme = schedule(90, {
    newToHeat: true,
    intensity: "hard",
  });
  assert.equal(belowThreshold.hours[0].category, 1);
  assert.equal(extreme.hours[0].category, 5);
  assert.equal(extreme.hours[0].stopWork, true);
});

test("below 78°F is Low risk unless the worker is new to the heat", () => {
  const experienced = schedule(77.9, { newToHeat: false }).hours[0];
  const newWorker = schedule(77.9, { newToHeat: true }).hours[0];
  assert.equal(experienced.category, 0);
  assert.equal(experienced.label, "Low risk");
  assert.equal(newWorker.category, 1);
  assert.equal(newWorker.label, "Caution");
});

test("preserves no-limit work guidance and uses the supplied WBGT input", () => {
  const result = buildWorkRestSchedule({
    hours: [{ time: "09:00", wbgtF: 87, wbgtSunF: 70, wbgtShadeF: 72 }],
    intensity: "easy",
    newToHeat: false,
    table,
  });
  assert.equal(result.hours[0].category, 3);
  assert.equal(result.hours[0].work, "NL");
  assert.equal(result.hours[0].restMinutes, 0);
});

test("schedules only usable overnight forecast hours in local-time order", () => {
  const forecast = {
    intensity: "moderate",
    newToHeat: false,
    hours: [
      { time: "22:00", wbgtSiteF: 80, wbgtSunF: 81 },
      { time: "00:00", wbgtSiteF: 82, wbgtSunF: 83 },
      { time: "01:00", wbgtSiteF: 84, wbgtSunF: 85 },
    ],
  };
  const schedule = buildWorkRestSchedule({
    hours: forecast.hours.map((hour) => ({
      time: hour.time,
      wbgtF: hour.wbgtSiteF ?? hour.wbgtSunF,
    })),
    intensity: forecast.intensity,
    newToHeat: forecast.newToHeat,
    table,
  });

  assert.deepEqual(
    schedule.hours.map(({ time }) => time),
    ["22:00", "00:00", "01:00"],
  );
  assert.deepEqual(
    schedule.hours.map(({ wbgtF }) => wbgtF),
    [80, 82, 84],
  );
});

test("uses intensity-specific work/rest/water values and converts quarts to cups", () => {
  const result = buildWorkRestSchedule({
    hours: [{ time: "14:00", wbgtF: 83 }],
    intensity: "hard",
    newToHeat: false,
    table,
  });
  assert.deepEqual(
    {
      work: result.hours[0].work,
      rest: result.hours[0].restMinutes,
      water: result.hours[0].waterCups,
    },
    { work: 30, rest: 30, water: 4 },
  );
});

test("never exceeds the per-hour water cap", () => {
  const uncappedTable = structuredClone(table);
  uncappedTable.categories[5].hard.water_qt = 3;
  const result = buildWorkRestSchedule({
    hours: [{ time: "12:00", wbgtF: 90 }],
    intensity: "hard",
    newToHeat: false,
    table: uncappedTable,
  });
  assert.equal(result.hours[0].waterCups, 6);
  assert.ok(result.hours[0].waterCups <= result.maxWaterCupsPerHour);
});

test("never exceeds the daily water cap across a long schedule", () => {
  const result = buildWorkRestSchedule({
    hours: Array.from({ length: 14 }, (_, index) => ({
      time: `${String(index).padStart(2, "0")}:00`,
      wbgtF: 90,
    })),
    intensity: "hard",
    newToHeat: false,
    table,
  });
  assert.equal(result.totalWaterCups, 48);
  assert.ok(result.hours.every((hour) => hour.waterCups <= 6));
  assert.equal(result.hours.at(-1).waterCups, 0);
});

test("rejects missing or invalid WBGT instead of returning a fabricated schedule", () => {
  assert.throws(() => schedule(Number.NaN), /finite wbgtF/);
  assert.throws(
    () => buildWorkRestSchedule({
      hours: [{ time: "10:00" }],
      intensity: "moderate",
      newToHeat: false,
      table,
    }),
    /finite wbgtF/,
  );
});

test("being new to the heat and having a risk factor still adds only one level", () => {
  const hours = [{ time: "10:00", wbgtF: 82.5 }]; // Elevated (2)
  const one = buildWorkRestSchedule({ hours, intensity: "moderate", newToHeat: true, table, categoryIncrease: 0 });
  const both = buildWorkRestSchedule({ hours, intensity: "moderate", newToHeat: true, table, categoryIncrease: 1 });
  assert.equal(one.hours[0].category, 3);
  assert.equal(both.hours[0].category, 3, "the two adjustments must not stack");
});

test("stop-work is only flagged at the top level, for hard work or modes that stop at extreme", () => {
  const at = (wbgtF, intensity, stopAtExtreme = false) =>
    buildWorkRestSchedule({ hours: [{ time: "13:00", wbgtF }], intensity, newToHeat: false, table, stopAtExtreme }).hours[0].stopWork;
  assert.equal(at(90, "hard"), true);
  assert.equal(at(89.9, "hard"), false);
  assert.equal(at(95, "moderate"), false);
  assert.equal(at(95, "easy", true), true);
});

test("hours past the 12-quart daily limit are marked, so the app can explain the zero", () => {
  const hours = Array.from({ length: 14 }, (_, i) => ({ time: `${String(6 + i).padStart(2, "0")}:00`, wbgtF: 92 }));
  const result = buildWorkRestSchedule({ hours, intensity: "hard", newToHeat: false, table });
  assert.equal(result.hours[0].dailyCapReached, false);
  assert.equal(result.hours.at(-1).waterCups, 0);
  assert.equal(result.hours.at(-1).dailyCapReached, true);
});
