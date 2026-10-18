// "Cool down now": the one place to head for right now.

const INDOOR = ['library', 'community', 'mall', 'cooling', 'respite'];
export const isIndoor = (kind) => INDOOR.includes(kind);

/** Farther than this, a walk in the heat to air conditioning stops making sense. */
const MAX_INDOOR_M = 3200;

/** About 80 m a minute on foot, and streets add roughly 30% to the straight line. */
export const walkMinutes = (meters) => Math.max(1, Math.round((meters * 1.3) / 80));

// Cooling centers get a head start.
const weight = (p) => p.distanceM * (p.kind === 'cooling' ? 0.8 : p.kind === 'respite' ? 1.3 : 1);

/** @returns {{ best: object, hoursUnknown: boolean, others: object[] } | null} */
export function pickCoolDown(places) {
  const usable = places.filter((p) => p.open !== false);
  const indoorOpen = usable.filter((p) => isIndoor(p.kind) && p.open === true && p.distanceM <= MAX_INDOOR_M).sort((a, b) => weight(a) - weight(b));
  const indoorMaybe = usable.filter((p) => isIndoor(p.kind) && p.open === null && p.distanceM <= MAX_INDOOR_M).sort((a, b) => a.distanceM - b.distanceM);
  const outdoor = usable.filter((p) => !isIndoor(p.kind)).sort((a, b) => a.distanceM - b.distanceM);

  let best = indoorOpen[0];
  let hoursUnknown = false;
  if (!best && indoorMaybe[0]) { best = indoorMaybe[0]; hoursUnknown = true; }
  if (!best) best = outdoor[0];
  if (!best) return null;

  // Two backups: another indoor option, and the nearest water or shade if it's closer.
  const others = [];
  const nextIndoor = [...indoorOpen, ...indoorMaybe].find((p) => p.id !== best.id);
  const nearOutdoor = outdoor.find((p) => p.id !== best.id && p.distanceM < best.distanceM);
  if (nearOutdoor) others.push(nearOutdoor);
  if (nextIndoor) others.push(nextIndoor);
  for (const p of [...indoorOpen, ...outdoor]) {
    if (others.length >= 2) break;
    if (p.id !== best.id && !others.some((o) => o.id === p.id)) others.push(p);
  }
  return { best, hoursUnknown, others: others.slice(0, 2) };
}
