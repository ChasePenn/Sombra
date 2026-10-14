import assert from "node:assert/strict";
import test from "node:test";
import { pickCoolDown, walkMinutes } from "../lib/cool-now.js";

const place = (id, kind, distanceM, open, extra = {}) => ({ id, kind, name: `${kind} ${id}`, lat: 33.45, lon: -112.07, distanceM, open, ...extra });

test("air conditioning beats a closer fountain", () => {
  const pick = pickCoolDown([place(1, "water", 120, null), place(2, "library", 700, true)]);
  assert.equal(pick.best.id, 2);
  assert.equal(pick.hoursUnknown, false);
  assert.equal(pick.others[0].id, 1, "the closer water is offered as a backup");
});

test("closed places are never picked", () => {
  const pick = pickCoolDown([place(1, "library", 200, false), place(2, "mall", 900, true)]);
  assert.equal(pick.best.id, 2);
  assert.ok(!pick.others.some((o) => o.id === 1));
});

test("official cooling centers get a head start over a slightly closer building", () => {
  const pick = pickCoolDown([place(1, "library", 1000, true), place(2, "cooling", 1150, true, { official: true })]);
  assert.equal(pick.best.id, 2);
});

test("unknown hours are used only when nothing indoors is known to be open, and say so", () => {
  const pick = pickCoolDown([place(1, "community", 500, null), place(2, "shade", 100, null)]);
  assert.equal(pick.best.id, 1);
  assert.equal(pick.hoursUnknown, true);
});

test("too far for AC: the nearest shade or water instead", () => {
  const pick = pickCoolDown([place(1, "library", 5000, true), place(2, "shade", 300, null)]);
  assert.equal(pick.best.id, 2);
});

test("nothing usable gives no pick", () => {
  assert.equal(pickCoolDown([]), null);
  assert.equal(pickCoolDown([place(1, "library", 300, false)]), null);
});

test("walk time counts street detours", () => {
  assert.equal(walkMinutes(800), 13);
  assert.equal(walkMinutes(10), 1);
});

test("a respite center is picked only when it's clearly closer than a cooling center", () => {
  assert.equal(pickCoolDown([place(1, "respite", 900, true), place(2, "cooling", 1400, true)]).best.id, 2);
  assert.equal(pickCoolDown([place(1, "respite", 300, true), place(2, "cooling", 1400, true)]).best.id, 1);
});
