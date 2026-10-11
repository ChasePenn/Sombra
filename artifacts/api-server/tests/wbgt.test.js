import assert from "node:assert/strict";
import test from "node:test";
import { wbgt } from "../src/lib/wbgt.js";

const PHOENIX_SUMMER = {
  tempC: 40,
  rh: 25,
  pressureHpa: 940,
  windMs: 1.5,
  solarWm2: 850,
  directFraction: 0.8,
  zenithDeg: 25,
  albedo: 0.45,
};

test("WBGT rises as solar radiation increases", () => {
  const lowSun = wbgt({ ...PHOENIX_SUMMER, solarWm2: 150 });
  const strongSun = wbgt({ ...PHOENIX_SUMMER, solarWm2: 950 });
  assert.ok(strongSun.wbgtC > lowSun.wbgtC);
});

test("WBGT falls as wind increases", () => {
  const still = wbgt({ ...PHOENIX_SUMMER, windMs: 0.5 });
  const breezy = wbgt({ ...PHOENIX_SUMMER, windMs: 5 });
  assert.ok(breezy.wbgtC < still.wbgtC);
});

test("shade WBGT is below sun WBGT under daytime solar load", () => {
  const sun = wbgt(PHOENIX_SUMMER);
  const shade = wbgt({ ...PHOENIX_SUMMER, solarWm2: 0, directFraction: 0 });
  assert.ok(shade.wbgtC < sun.wbgtC);
});

test("wind is clamped to 0.5 m/s, and input ranges are checked", () => {
  const belowMinimum = wbgt({ ...PHOENIX_SUMMER, windMs: 0 });
  const atMinimum = wbgt({ ...PHOENIX_SUMMER, windMs: 0.5 });
  assert.deepEqual(belowMinimum, atMinimum);
  assert.throws(
    () => wbgt({ ...PHOENIX_SUMMER, albedo: 1.2 }),
    /albedo must be between/,
  );
});

// Fill with conditions and expected outputs from OSHA's outdoor WBGT calculator.
// Each fixture uses SI inputs and Liljegren component-output temperatures in °C.
const VALIDATION_CASES = [];

for (const sample of VALIDATION_CASES) {
  test(`OSHA comparison: ${sample.name}`, () => {
    const actual = wbgt(sample.input);
    assert.ok(Math.abs(actual.wbgtC - sample.expected.wbgtC) <= sample.toleranceC);
    assert.ok(Math.abs(actual.tnwbC - sample.expected.tnwbC) <= sample.toleranceC);
    assert.ok(Math.abs(actual.tgC - sample.expected.tgC) <= sample.toleranceC);
  });
}
