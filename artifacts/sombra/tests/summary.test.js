import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { buildShiftSummary, groupScheduleHours } from "../lib/summary.js";

import { resolveAudienceMode } from "../lib/modes.js";

// Work mode's words ("Work normally", "shift") sit on top of the shared copy.
const load = async (id) => JSON.parse(await readFile(new URL(`../config/modes/${id}.json`, import.meta.url), "utf8"));
const workerMode = resolveAudienceMode({
  "../config/modes/workers.json": await load("workers"),
  "../config/modes/work.json": await load("work"),
}, "work");
const en = workerMode.locales.en;
const es = workerMode.locales.es;
const hour = (time, category = 0, overrides = {}) => ({
  time,
  category,
  wbgtF: 75 + category * 3,
  work: "NL",
  restMinutes: 0,
  stopWork: false,
  ...overrides,
});
const summary = (hours, overrides = {}) => buildShiftSummary({
  hours,
  workerName: "Luis",
  date: "2026-07-10",
  now: new Date("2026-07-10T14:30:00Z"),
  timezone: "America/Phoenix",
  strings: en,
  formatTime: (time) => time,
  ...overrides,
});

test("starts with normal work until the first scheduled shade break", () => {
  const result = summary([
    hour("07:00"),
    hour("08:00"),
    hour("09:00", 2, { work: 50, restMinutes: 10 }),
  ]);
  assert.equal(result.message, "Work normally until 09:00.");
  assert.equal(result.activeCategory, 0);
  assert.equal(result.activeRisk, "Low");
  assert.equal(result.currentHourIndex, 0);
  assert.equal(result.greeting, "Good morning, Luis");
});

test("uses the current scheduled break length and the block's full time range", () => {
  const result = summary([
    hour("13:00", 3, { work: 40, restMinutes: 20 }),
    hour("14:00", 3, { work: 40, restMinutes: 20 }),
    hour("15:00", 4, { work: 30, restMinutes: 30, wbgtF: 89 }),
  ], { now: new Date("2026-07-10T20:20:00Z") });
  assert.equal(result.message, "Take 20-minute shade breaks every hour from 13:00 to 15:00.");
  assert.equal(result.hottest, "Hottest at 15:00: Very high");
  assert.equal(result.activeCategory, 3);
});

test("prioritizes rescheduling heavy work when the schedule says stop work", () => {
  const result = summary([
    hour("13:00", 4, { restMinutes: 40, work: 20 }),
    hour("14:00", 5, { stopWork: true, restMinutes: 50, work: 10 }),
  ], { intensity: "hard" });
  assert.equal(result.message, "Too hot for heavy work after 14:00. Move it earlier if you can.");
});

test("normal-work copy contains no no-limit or zero-rest jargon", () => {
  const result = summary([hour("07:00"), hour("08:00")]);
  assert.equal(result.message, "Work normally during this shift. Keep water nearby.");
  assert.doesNotMatch(result.message, /No limit|0 min|WBGT|Category/);
});

test("uses the site's timezone for current risk and does not mark a future shift Now", () => {
  const hours = [hour("07:00", 0), hour("08:00", 1)];
  const today = summary(hours, { now: new Date("2026-07-10T15:20:00Z") });
  const tomorrow = summary(hours, { date: "2026-07-11", now: new Date("2026-07-10T15:20:00Z") });
  assert.equal(today.currentHourIndex, 1);
  assert.equal(today.activeCategory, 1);
  assert.equal(tomorrow.currentHourIndex, -1);
  assert.equal(tomorrow.isToday, false);
});

test("recognizes the current hour in an overnight shift after midnight", () => {
  const result = summary([hour("23:00"), hour("00:00", 1), hour("01:00", 1)], {
    now: new Date("2026-07-11T07:20:00Z"),
  });
  assert.equal(result.currentHourIndex, 1);
  assert.equal(result.activeCategory, 1);
  assert.equal(result.isToday, true);
});

test("uses Spanish resources for greeting, action, risk, and hottest-hour copy", () => {
  const result = summary([hour("13:00", 3, { work: 40, restMinutes: 20 })], {
    strings: es,
    now: new Date("2026-07-10T20:20:00Z"),
  });
  assert.equal(result.greeting, "Buenas tardes, Luis");
  assert.equal(result.activeRisk, "Alto");
  assert.match(result.message, /Descansa 20 minutos a la sombra/);
  assert.match(result.hottest, /hora más calurosa/);
});

test("groups only consecutive hours of the same risk, including across midnight", () => {
  const groups = groupScheduleHours([
    hour("07:00"),
    hour("08:00"),
    hour("10:00"),
    hour("11:00", 1),
    hour("23:00", 2),
    hour("00:00", 2),
  ]);
  assert.deepEqual(groups.map((group) => group.hours.map((item) => item.time)), [
    ["07:00", "08:00"],
    ["10:00"],
    ["11:00"],
    ["23:00", "00:00"],
  ]);
});

test("English and Spanish result resources have matching keys", () => {
  const keys = (value, prefix = "") => Object.entries(value).flatMap(([key, item]) =>
    typeof item === "object" ? keys(item, `${prefix}${key}.`) : `${prefix}${key}`,
  ).sort();
  assert.deepEqual(keys(en), keys(es));
});
