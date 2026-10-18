import test from "node:test";
import assert from "node:assert/strict";
import { SYMPTOM_IDS, evaluateSafety, enforceSafetyFloor } from "../lib/safety.js";

// Every combination of the seven symptoms.
const DANGER_SIGNS = new Set(["hot_dry", "confused", "fainted"]);

function* subsets(items) {
  for (let mask = 0; mask < 1 << items.length; mask += 1) {
    yield items.filter((_, i) => mask & (1 << i));
  }
}

test("all 128 symptom combinations get the documented level", () => {
  let count = 0;
  for (const symptoms of subsets(SYMPTOM_IDS)) {
    const expected = symptoms.some((s) => DANGER_SIGNS.has(s)) ? "DANGER" : symptoms.length ? "CAUTION" : "OK";
    assert.equal(evaluateSafety({ symptoms }), expected, `symptoms: ${symptoms.join(", ") || "none"}`);
    count += 1;
  }
  assert.equal(count, 128);
});

test("a heat-stroke sign is an emergency no matter what else is true", () => {
  for (const sign of DANGER_SIGNS) {
    for (const context of [
      { hoursWorked: 0, waterCups: 0, recommendedCups: null },
      { hoursWorked: 8, waterCups: 40, recommendedCups: 8 }, // drank plenty
      { hoursWorked: Number.NaN, waterCups: Number.NaN, recommendedCups: Number.NaN }, // broken session data
      { hoursWorked: -3, waterCups: -1, recommendedCups: -5 },
    ]) {
      assert.equal(evaluateSafety({ ...context, symptoms: [sign] }), "DANGER", `${sign} with ${JSON.stringify(context)}`);
    }
  }
});

test("an unrecognized symptom is treated with caution, never as fine", () => {
  assert.equal(evaluateSafety({ symptoms: ["something-new"] }), "CAUTION");
  assert.equal(evaluateSafety({ symptoms: ["something-new", "confused"] }), "DANGER");
});

test("water deficit: caution only after an hour and below half the recommended amount", () => {
  const level = (hoursWorked, waterCups, recommendedCups) => evaluateSafety({ symptoms: [], hoursWorked, waterCups, recommendedCups });
  assert.equal(level(0.99, 0, 8), "OK", "under an hour");
  assert.equal(level(1, 3.99, 8), "CAUTION", "just under half");
  assert.equal(level(1, 4, 8), "OK", "exactly half");
  assert.equal(level(5, 0, null), "OK", "no plan means no water target, not a caution");
  assert.equal(level(5, 0, 0), "OK");
});

test("a proposed level can raise the rule level but never lower it", () => {
  const levels = ["OK", "CAUTION", "DANGER"];
  for (const rule of levels) {
    for (const proposed of [...levels, "nonsense", undefined]) {
      const result = enforceSafetyFloor(rule, proposed);
      assert.ok(levels.indexOf(result) >= levels.indexOf(rule), `${proposed} must not lower ${rule}`);
    }
  }
  assert.throws(() => enforceSafetyFloor("MAYBE", "OK"));
});
