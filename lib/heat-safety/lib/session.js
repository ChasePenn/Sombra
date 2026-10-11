const hourMs = 3600000;
export function phoenixDate(now = Date.now()) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/Phoenix", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(now));
  const part = (type) => parts.find((p) => p.type === type).value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}
export function hourInstant(date, time, nextDay = false) {
  return Date.parse(`${date}T${time}:00-07:00`) + (nextDay ? 24 * hourMs : 0);
}
export function emptySession(workerName, date = phoenixDate()) {
  return { workerName, date, startedAt: null, endedAt: null, breaks: [], waterLogs: [], planHours: [], siteType: "", remindersShown: [] };
}
export function sessionContext(session, now = Date.now()) {
  const end = Math.min(now, session.endedAt ? Date.parse(session.endedAt) : now);
  const start = session.startedAt ? Date.parse(session.startedAt) : end;
  const breakMs = session.breaks.reduce((sum, b) => sum + Math.max(0, Math.min(end, b.end ? Date.parse(b.end) : end) - Math.max(start, Date.parse(b.start))), 0);
  const hoursWorked = Math.max(0, (end - start - breakMs) / hourMs);
  const waterCups = session.waterLogs.filter((w) => Date.parse(w.time) <= now).reduce((sum, w) => sum + w.cups, 0);
  const validHours = session.planHours.filter((h) => Number.isFinite(h.at) && Number.isFinite(h.waterCups));
  let recommendedCups = validHours.length ? 0 : null;
  if (recommendedCups !== null && session.startedAt) {
    for (const h of validHours) recommendedCups += Math.max(0, Math.min(end, h.at + hourMs) - Math.max(start, h.at)) / hourMs * h.waterCups;
    recommendedCups = Math.min(48, recommendedCups);
  }
  const current = validHours.find((h) => now >= h.at && now < h.at + hourMs);
  const next = validHours.find((h) => now >= h.at - hourMs && now < h.at);
  return {
    activityAvailable: session.activityAvailable !== false,
    workerName: session.workerName, firstName: session.workerName.trim().split(/\s+/)[0],
    hoursWorked, waterCups, recommendedCups, breaksTaken: session.breaks.filter((b) => b.end).length,
    currentWbgtF: current?.wbgtF ?? null, nextWbgtF: next?.wbgtF ?? null,
    currentCategory: current?.category ?? null, nextCategory: next?.category ?? null,
    siteType: session.siteType || "", currentHour: current ?? null,
  };
}
export function applySessionAction(session, action, now = Date.now()) {
  const iso = new Date(now).toISOString();
  const next = structuredClone(session);
  if (action === "water") next.waterLogs.push({ time: iso, cups: 1 });
  else if (action === "start") { if (!next.startedAt) next.startedAt = iso; }
  else if (action === "start-break") {
    if (next.startedAt && !next.endedAt && !next.breaks.some((b) => !b.end)) next.breaks.push({ start: iso, end: null });
  } else if (action === "end-break") {
    const b = next.breaks.find((b) => !b.end); if (b) b.end = iso;
  } else if (action === "end") {
    if (next.startedAt && !next.endedAt) { next.endedAt = iso; for (const b of next.breaks) if (!b.end) b.end = iso; }
  } else throw new Error("Unsupported session action");
  return next;
}
export function dueReminder(session, checkins, now = Date.now()) {
  const active = Boolean(session.startedAt && !session.endedAt);
  const own = checkins.filter((c) => c.workerName === session.workerName && phoenixDate(Date.parse(c.time)) === session.date).sort((a,b) => b.time.localeCompare(a.time));
  const last = own[0];
  if (last?.level === "DANGER") return null;
  const followAt = last?.detailsJson?.recheckAt;
  if (followAt && (last.level === "CAUTION" || active) && Date.parse(followAt) <= now) {
    const key = `followup:${last.id || last.time}`;
    if (!session.remindersShown.includes(key)) return { key, type: "followup" };
  }
  if (!active) return null;
  const context = sessionContext(session, now);
  const h = context.currentHour;
  if (session.breaks.some((b) => !b.end)) return null;
  const workedHour = h?.at ?? Date.parse(session.startedAt) + Math.floor((now-Date.parse(session.startedAt))/hourMs)*hourMs;
  const hourKey = `checkin:${workedHour}`;
  if (!session.remindersShown.includes(hourKey) && (!last || Date.parse(last.time) < workedHour)) return { key: hourKey, type: "checkin" };
  if (!h) return null;
  const breakAt = h.at + h.workMinutes * 60000;
  const breakKey = `break:${h.at}`;
  if (h.restMinutes > 0 && now >= breakAt && !session.remindersShown.includes(breakKey)) return { key: breakKey, type: "break", minutes: h.restMinutes };
  const interval = h.waterCups > 0 ? hourMs / h.waterCups : hourMs;
  const slot = Math.floor((now - h.at) / interval);
  const waterKey = `water:${h.at}:${slot}`;
  const recentWater = session.waterLogs.some((w) => Date.parse(w.time) >= h.at + slot * interval);
  if (h.waterCups > 0 && !recentWater && !session.remindersShown.includes(waterKey)) return { key: waterKey, type: "water", cups: h.waterCups };
  return null;
}
