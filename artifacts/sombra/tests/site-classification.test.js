import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  bestCategoryScore,
  isHighConfidence,
  resolveSiteFactors,
} from "../lib/site-classification.js";

const labels = JSON.parse(
  await readFile(new URL("../public/config/clip_labels.json", import.meta.url), "utf8"),
);
const adjustments = JSON.parse(
  await readFile(new URL("../config/site_adjustments.json", import.meta.url), "utf8"),
);

test("groups prompt scores by category using the best matching label", () => {
  const result = bestCategoryScore(
    [
      { label: labels.surface.dark_roof[0], score: 0.31 },
      { label: labels.surface.dark_roof[1], score: 0.76 },
      { label: labels.surface.asphalt[0], score: 0.19 },
    ],
    labels.surface,
  );
  assert.deepEqual(result, {
    key: "dark_roof",
    score: 0.76,
    matchedPrompt: labels.surface.dark_roof[1],
  });
});

test("uses the 40 percent threshold inclusively", () => {
  assert.equal(isHighConfidence({ score: 0.4 }), true);
  assert.equal(isHighConfidence({ score: 0.3999 }), false);
  assert.equal(isHighConfidence(null), false);
});

test("maps other surfaces to the documented default and resolves shade multipliers", () => {
  assert.deepEqual(resolveSiteFactors(adjustments, "other", "partial"), {
    siteAlbedo: 0.2,
    solarMultiplier: 0.5,
  });
  assert.deepEqual(resolveSiteFactors(adjustments, "asphalt", "full_shade"), {
    siteAlbedo: 0.08,
    solarMultiplier: 0,
  });
});

test("rejects invalid site factor configuration rather than inventing values", () => {
  assert.throws(
    () => resolveSiteFactors({ albedo: {}, solar_multiplier: {} }, "unknown", "unknown"),
    /valid surface/,
  );
});
