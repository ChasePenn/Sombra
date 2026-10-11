import test from "node:test";
import assert from "node:assert/strict";
import { SYMPTOM_IDS, evaluateSafety, enforceSafetyFloor } from "../lib/safety.js";
import { emptySession, applySessionAction, sessionContext, dueReminder } from "../lib/session.js";
for (const symptom of SYMPTOM_IDS) test(`${symptom} maps to the fixed safety level`, () => {
  assert.equal(evaluateSafety({ symptoms: [symptom] }), ["hot_dry", "confused", "fainted"].includes(symptom) ? "DANGER" : "CAUTION");
});
test("water deficit starts at one hour and only below 50 percent", () => {
  assert.equal(evaluateSafety({ hoursWorked: .99, waterCups: 0, recommendedCups: 4 }), "OK");
  assert.equal(evaluateSafety({ hoursWorked: 1, waterCups: 1.99, recommendedCups: 4 }), "CAUTION");
  assert.equal(evaluateSafety({ hoursWorked: 1, waterCups: 2, recommendedCups: 4 }), "OK");
  assert.equal(evaluateSafety({ hoursWorked: 2, waterCups: 0, recommendedCups: null }), "OK");
});
test("AI cannot downgrade danger or caution", () => {
  for (const level of ["OK", "CAUTION", "DANGER", "invalid"]) assert.equal(enforceSafetyFloor("DANGER", level), "DANGER");
  assert.equal(enforceSafetyFloor("CAUTION", "OK"), "CAUTION");
});
test("actual time and completed breaks survive session actions", () => {
  let s = applySessionAction(emptySession("Luis", "2026-10-10"), "start", 0);
  s = applySessionAction(s, "start-break", 3600000);
  s = applySessionAction(s, "end-break", 5400000);
  s = applySessionAction(s, "water", 6000000);
  const c = sessionContext(s, 7200000);
  assert.equal(c.hoursWorked, 1.5); assert.equal(c.breaksTaken, 1); assert.equal(c.waterCups, 1); assert.equal(c.recommendedCups, null);
});
test("caution follow-up is due after reopening and does not repeat once acknowledged", () => {
  const s = emptySession("Luis", "2026-10-10"); s.startedAt = "2026-10-10T14:00:00Z";
  const c = { id:"c1",workerName:"Luis",time:"2026-10-10T14:00:00Z",level:"CAUTION",detailsJson:{recheckAt:"2026-10-10T14:15:00Z"} };
  assert.equal(dueReminder(s,[c],Date.parse("2026-10-10T14:16:00Z")).type,"followup");
  s.remindersShown.push("followup:c1"); assert.equal(dueReminder(s,[c],Date.parse("2026-10-10T14:16:00Z")),null);
});
test("caution followup does not require an active work session", () => {
  const s = emptySession("Luis","2026-10-10");
  const c = {id:"c2",workerName:"Luis",time:"2026-10-10T14:00:00Z",level:"CAUTION",detailsJson:{recheckAt:"2026-10-10T14:15:00Z"}};
  assert.equal(dueReminder(s,[c],Date.parse("2026-10-10T14:16:00Z")).type,"followup");
});
test("hourly check-ins still run if weather or schedule is unavailable", () => {
  const s=emptySession("Luis","2026-10-10");s.startedAt="2026-10-10T14:00:00Z";
  assert.equal(dueReminder(s,[],Date.parse("2026-10-10T15:05:00Z")).type,"checkin");
});
