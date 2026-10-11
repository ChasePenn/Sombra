export const SYMPTOM_IDS = Object.freeze(["dizzy", "headache", "nausea", "weak", "hot_dry", "confused", "fainted"]);
const dangerSymptoms = new Set(["hot_dry", "confused", "fainted"]);
const ranks = { OK: 0, CAUTION: 1, DANGER: 2 };

// Shared, deterministic rules: usable offline and re-run on the server.
export function evaluateSafety({ symptoms = [], hoursWorked = 0, waterCups = 0, recommendedCups = null }) {
  if (symptoms.some((id) => dangerSymptoms.has(id))) return "DANGER";
  if (symptoms.length > 0) return "CAUTION";
  if (Number.isFinite(hoursWorked) && hoursWorked >= 1 &&
      Number.isFinite(waterCups) && Number.isFinite(recommendedCups) &&
      recommendedCups > 0 && waterCups < recommendedCups * 0.5) return "CAUTION";
  return "OK";
}

export function enforceSafetyFloor(ruleLevel, proposedLevel) {
  if (!(ruleLevel in ranks)) throw new Error("Invalid safety level");
  return proposedLevel in ranks && ranks[proposedLevel] > ranks[ruleLevel] ? proposedLevel : ruleLevel;
}
