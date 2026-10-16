import assert from "node:assert/strict";
import test from "node:test";
import { findBestWindows } from "../lib/best-window.js";
import table from "../config/work_rest_table.json" with { type: "json" };

// A typical Phoenix summer day: cool morning, extreme afternoon.
const day = (date, temps) => temps.map((wbgtF, i) => ({ date, time: `${String(5 + i).padStart(2, "0")}:00`, wbgtF }));
const today = day("2026-07-10", [74, 76, 79, 82, 85, 87, 89, 91, 92, 92, 91, 89, 86, 83, 80, 78]);
const tomorrow = day("2026-07-11", [72, 74, 77, 80, 84, 86, 88, 90, 91, 91, 90, 88, 85, 82, 79, 77]);
const base = { hours: [...today, ...tomorrow], intensity: "moderate", newToHeat: false, table };

test("picks the coolest early-morning window", () => {
  const { best } = findBestWindows({ ...base, durationHours: 2, now: "2026-07-10T04:00" });
  assert.equal(best.date, "2026-07-11");
  assert.equal(best.start, "05:00");
  assert.equal(best.end, "07:00");
});

test("ignores hours that already passed", () => {
  const { best } = findBestWindows({ ...base, durationHours: 2, now: "2026-07-10T14:10", hours: today });
  assert.ok(best.start >= "14:00", best.start);
  assert.equal(best.start, "19:00");
});

test("lists the Very high stretches to avoid", () => {
  const { avoid } = findBestWindows({ ...base, durationHours: 1, now: "2026-07-10T04:00", hours: today });
  assert.deepEqual(avoid, [{ date: "2026-07-10", start: "11:00", end: "17:00" }]);
});

test("alternatives never overlap the best window", () => {
  const { best, alternatives } = findBestWindows({ ...base, durationHours: 2, now: "2026-07-10T04:00" });
  for (const alt of alternatives) {
    assert.ok(alt.date !== best.date || alt.start >= best.end || alt.end <= best.start);
  }
});

test("extra caution makes the same window riskier", () => {
  const normal = findBestWindows({ ...base, durationHours: 3, now: "2026-07-10T04:00", hours: today });
  const careful = findBestWindows({ ...base, durationHours: 3, now: "2026-07-10T04:00", hours: today, categoryIncrease: 1 });
  assert.equal(careful.best.category, normal.best.category + 1);
});

test("returns no window when the activity is longer than what is left today", () => {
  const { best } = findBestWindows({ ...base, durationHours: 4, now: "2026-07-10T18:30", hours: today });
  assert.equal(best, null);
});

test("other good times are never High heat when the best time is cooler", () => {
  // Elevated in the early morning, High mid-morning, Extreme after.
  const wbgt = { "05:00": 83, "06:00": 83, "07:00": 84, "08:00": 84, "09:00": 86, "10:00": 86, "11:00": 91, "12:00": 92, "13:00": 92, "14:00": 92 };
  const hours = Object.entries(wbgt).map(([time, wbgtF]) => ({ date: "2026-07-11", time, wbgtF }));
  const result = findBestWindows({ hours, durationHours: 2, intensity: "moderate", newToHeat: false, table, now: "2026-07-10T20:00" });
  assert.ok(result.best);
  assert.ok(result.alternatives.every((w) => w.category < 3 || w.category <= result.best.category), JSON.stringify(result.alternatives));
});
