import { phoenixDate, type WorkerSession } from "@workspace/heat-safety/session";
export function validSession(s: WorkerSession, now = Date.now()): boolean {
  const instant = (value:string) => Number.isFinite(Date.parse(value)) && Date.parse(value) <= now + 60000;
  const day = Date.parse(`${s.date}T12:00:00-07:00`);
  if (!Number.isFinite(day) || phoenixDate(day) !== s.date || !s.workerName.trim()) return false;
  if (s.startedAt && (!instant(s.startedAt) || phoenixDate(Date.parse(s.startedAt)) !== s.date)) return false;
  if (s.endedAt && (!s.startedAt || !instant(s.endedAt) || Date.parse(s.endedAt) < Date.parse(s.startedAt))) return false;
  const start = s.startedAt ? Date.parse(s.startedAt) : null;
  const end = s.endedAt ? Date.parse(s.endedAt) : now;
  let previous = start ?? 0;
  let open = false;
  for (const b of s.breaks) {
    if (start === null || open || !instant(b.start) || Date.parse(b.start) < previous || Date.parse(b.start) > end) return false;
    if (b.end && (!instant(b.end) || Date.parse(b.end) < Date.parse(b.start) || Date.parse(b.end) > end)) return false;
    previous = b.end ? Date.parse(b.end) : end;
    open = !b.end;
  }
  if (s.waterLogs.some((w) => !instant(w.time) || phoenixDate(Date.parse(w.time)) !== s.date)) return false;
  const dayStart = Date.parse(`${s.date}T00:00:00-07:00`);
  const seen = new Set<number>();
  for (const h of s.planHours) {
    if (!Number.isFinite(h.at) || h.at < dayStart || h.at >= dayStart + 48*3600000 || seen.has(h.at) || h.workMinutes + h.restMinutes > 60) return false;
    seen.add(h.at);
  }
  return true;
}
