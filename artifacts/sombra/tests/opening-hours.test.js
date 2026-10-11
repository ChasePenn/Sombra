import assert from "node:assert/strict";
import test from "node:test";
import { isOpenNow } from "../lib/opening-hours.js";

const tue = (h, m = 0) => ({ day: 2, minutes: h * 60 + m });
const sun = (h, m = 0) => ({ day: 0, minutes: h * 60 + m });

test("24/7 is always open", () => assert.equal(isOpenNow("24/7", sun(3)), true));
test("weekday hours", () => {
  assert.equal(isOpenNow("Mo-Fr 09:00-17:00", tue(10)), true);
  assert.equal(isOpenNow("Mo-Fr 09:00-17:00", tue(17)), false);
  assert.equal(isOpenNow("Mo-Fr 09:00-17:00", sun(10)), false);
});
test("multiple rules and split hours", () => {
  const hours = "Mo-Sa 10:00-12:00,13:00-18:00; Su off";
  assert.equal(isOpenNow(hours, tue(12, 30)), false);
  assert.equal(isOpenNow(hours, tue(15)), true);
  assert.equal(isOpenNow(hours, sun(15)), false);
});
test("day lists and wraparound ranges", () => {
  assert.equal(isOpenNow("Tu,Th 08:00-11:00", tue(9)), true);
  assert.equal(isOpenNow("Sa-Mo 10:00-16:00", sun(11)), true);
});
test("hours past midnight", () => assert.equal(isOpenNow("18:00-02:00", tue(1)), true));
test("unknown formats return null instead of guessing", () => {
  assert.equal(isOpenNow("Mo-Fr 09:00-17:00; PH off", tue(10)), null);
  assert.equal(isOpenNow("sunrise-sunset", tue(10)), null);
  assert.equal(isOpenNow(null, tue(10)), null);
});
