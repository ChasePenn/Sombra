import { buildWorkRestSchedule } from "./schedule.js";

/**
 * Find the safest time window for an activity.
 *
 * @param {object} input
 * @param {{date: string, time: string, wbgtF: number}[]} input.hours  hourly forecast, any order
 * @param {number} input.durationHours  how long the activity lasts (1-8)
 * @param {"easy"|"moderate"|"hard"} input.intensity
 * @param {boolean} input.newToHeat
 * @param {0|1} input.categoryIncrease  1 when the mode or personal risk adds caution
 * @param {object} input.table  work/rest table
 * @param {string} input.now  current local time "YYYY-MM-DDTHH:MM"
 * @returns {{best: Window|null, alternatives: Window[], avoid: {date: string, start: string, end: string}[]}}
 *
 * A window is scored by its hottest hour first (the risk you actually face), then by
 * total heat, then by how soon it starts. Windows never cross midnight.
 */
export function findBestWindows({ hours, durationHours, intensity, newToHeat, categoryIncrease = 0, table, now }) {
  if (!Number.isInteger(durationHours) || durationHours < 1 || durationHours > 8) {
    throw new TypeError("durationHours must be a whole number from 1 to 8.");
  }
  const sorted = [...hours]
    .filter((hour) => hour && Number.isFinite(hour.wbgtF) && /^\d{4}-\d{2}-\d{2}$/.test(hour.date) && /^\d{2}:\d{2}$/.test(hour.time))
    .sort((a, b) => `${a.date}T${a.time}`.localeCompare(`${b.date}T${b.time}`));

  const scheduled = buildWorkRestSchedule({
    hours: sorted,
    intensity,
    newToHeat,
    table,
    categoryIncrease,
  }).hours.map((entry, index) => ({ ...entry, date: sorted[index].date, time: sorted[index].time }));

  // Only hours that haven't started yet (the current hour counts if it began under 30 minutes ago).
  const nowKey = now.slice(0, 16);
  const upcoming = scheduled.filter((hour) => {
    const startKey = `${hour.date}T${hour.time}`;
    const halfPast = `${hour.date}T${hour.time.slice(0, 3)}30`;
    return startKey >= nowKey || halfPast > nowKey;
  });

  const windows = [];
  for (let i = 0; i + durationHours <= upcoming.length; i += 1) {
    const slice = upcoming.slice(i, i + durationHours);
    const sameDay = slice.every((hour) => hour.date === slice[0].date);
    const consecutive = slice.every((hour, k) => k === 0 || hourNumber(hour.time) === hourNumber(slice[k - 1].time) + 1);
    if (!sameDay || !consecutive) continue;
    const peak = slice.reduce((max, hour) => (hour.category > max.category ? hour : max), slice[0]);
    windows.push({
      date: slice[0].date,
      start: slice[0].time,
      end: formatHour(hourNumber(slice[slice.length - 1].time) + 1),
      category: peak.category,
      label: peak.label,
      peakWbgtF: Math.max(...slice.map((hour) => hour.wbgtF)),
      totalHeat: slice.reduce((sum, hour) => sum + hour.wbgtF, 0),
      work: peak.work,
      restMinutes: peak.restMinutes,
      waterQt: slice.reduce((sum, hour) => sum + hour.waterQt, 0),
      stopWork: slice.some((hour) => hour.stopWork),
    });
  }

  const ranked = [...windows].sort((a, b) =>
    a.category - b.category ||
    a.totalHeat - b.totalHeat ||
    `${a.date}T${a.start}`.localeCompare(`${b.date}T${b.start}`));

  const best = ranked[0] ?? null;
  const alternatives = [];
  for (const candidate of ranked.slice(1)) {
    if (alternatives.length >= 2) break;
    const overlaps = [best, ...alternatives].some((chosen) => chosen && chosen.date === candidate.date &&
      hourNumber(candidate.start) < hourNumber(chosen.end) && hourNumber(chosen.start) < hourNumber(candidate.end));
    // "Other good times" must still be good: never High heat or worse unless nothing better exists.
    const goodEnough = candidate.category <= best?.category + 1 && (candidate.category < 3 || candidate.category <= best?.category);
    if (!overlaps && best && goodEnough) alternatives.push(candidate);
  }

  // Stretches of Very high or Extreme heat (category 4+) to stay out of.
  const avoid = [];
  for (const hour of upcoming) {
    if (hour.category < 4) continue;
    const last = avoid[avoid.length - 1];
    if (last && last.date === hour.date && last.end === hour.time) {
      last.end = formatHour(hourNumber(hour.time) + 1);
    } else {
      avoid.push({ date: hour.date, start: hour.time, end: formatHour(hourNumber(hour.time) + 1) });
    }
  }

  return { best, alternatives, avoid };
}

function hourNumber(time) {
  return Number(time.slice(0, 2));
}

function formatHour(hour) {
  return `${String(hour).padStart(2, "0")}:00`;
}
