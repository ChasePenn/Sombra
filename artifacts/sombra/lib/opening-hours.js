// Minimal reader for OpenStreetMap opening_hours, covering the common forms.
const DAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

function expandDays(spec) {
  const days = new Set();
  for (const part of spec.split(",")) {
    const range = part.trim().split("-");
    const start = DAYS.indexOf(range[0]);
    const end = DAYS.indexOf(range[1] ?? range[0]);
    if (start < 0 || end < 0) return null;
    for (let i = start; ; i = (i + 1) % 7) {
      days.add(i);
      if (i === end) break;
    }
  }
  return days;
}

function toMinutes(clock) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(clock.trim());
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

/** @param {string|null} text  @param {{day: number, minutes: number}} now  day 0 = Sunday */
export function isOpenNow(text, now) {
  if (!text || typeof text !== "string") return null;
  const value = text.trim();
  if (value === "24/7") return true;
  let decided = null;
  for (const rawRule of value.split(";")) {
    const rule = rawRule.trim();
    if (!rule) continue;
    if (/\bPH\b|\bSH\b|week|[A-Z][a-z]{2} \d/.test(rule)) return null; // holidays, weeks, dates: not supported
    const match = /^((?:Mo|Tu|We|Th|Fr|Sa|Su)(?:[-,](?:Mo|Tu|We|Th|Fr|Sa|Su))*)?\s*(.*)$/.exec(rule);
    if (!match) return null;
    const days = match[1] ? expandDays(match[1]) : new Set([0, 1, 2, 3, 4, 5, 6]);
    if (!days) return null;
    const times = match[2].trim();
    if (!days.has(now.day)) continue;
    // Later rules override earlier ones, as in the OSM spec.
    if (times === "off" || times === "closed") { decided = false; continue; }
    if (times === "" || times === "24/7" || times === "00:00-24:00") { decided = true; continue; }
    let open = false;
    for (const span of times.split(",")) {
      const [from, to] = span.split("-");
      const start = toMinutes(from ?? "");
      let end = toMinutes(to ?? "");
      if (start == null || end == null) return null;
      if (end <= start) end += 24 * 60; // past midnight
      if ((now.minutes >= start && now.minutes < end) || (now.minutes + 24 * 60 >= start && now.minutes + 24 * 60 < end)) open = true;
    }
    decided = open;
  }
  return decided ?? false;
}
