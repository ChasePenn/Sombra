import { phoenixDate } from '@workspace/heat-safety/session';
import type { WorkerSession, SessionContext } from '@workspace/heat-safety/session';
import { templates } from '@workspace/heat-safety/templates';
import type { Checkin } from '../../public/js/store.js';
import { checkInCopy, fill, type Lang } from './copy';

export type Level = 'OK' | 'CAUTION' | 'DANGER';
export const isLevel = (l: string | undefined): l is Level => l === 'OK' || l === 'CAUTION' || l === 'DANGER';

export const fmtTime = (iso: string, lang: Lang) =>
  new Date(iso).toLocaleTimeString(lang === 'es' ? 'es-US' : 'en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/Phoenix' });
export const fmtDay = (iso: string, lang: Lang) =>
  new Date(iso).toLocaleDateString(lang === 'es' ? 'es-US' : 'en-US', { weekday: 'long', month: 'short', day: 'numeric', timeZone: 'America/Phoenix' });

export function fmtDuration(hours: number, lang: Lang) {
  const total = Math.max(0, Math.round(hours * 60));
  return fill(checkInCopy(lang).duration, { h: Math.floor(total / 60), m: total % 60 });
}

export function riskWord(category: number | null, lang: Lang) {
  const words: string[] | undefined = templates?.[lang]?.riskWords;
  if (category === null || category === undefined || !words) return checkInCopy(lang).riskUnknown;
  return words[Math.max(0, Math.min(words.length - 1, category))] ?? checkInCopy(lang).riskUnknown;
}

export function waterText(ctx: SessionContext, lang: Lang) {
  const c = checkInCopy(lang);
  const fmt = (n:number) => new Intl.NumberFormat(lang,{maximumFractionDigits:1}).format(n);
  return ctx.recommendedCups === null
    ? fill(c.waterNoPlan, { cups: fmt(ctx.waterCups) })
    : fill(c.waterOf, { cups: fmt(ctx.waterCups), rec: fmt(ctx.recommendedCups) });
}

export type WorkState = 'notStarted' | 'working' | 'onBreak' | 'finished';
export function workState(s: WorkerSession | null): WorkState {
  if (!s?.startedAt) return 'notStarted';
  if (s.endedAt) return 'finished';
  if (s.breaks.some((b) => !b.end)) return 'onBreak';
  return 'working';
}

const nameKey = (n: string) => n.trim().toLowerCase();

/** Latest check-in today (Phoenix date) for each worker name. */
export function latestToday(checkins: Checkin[]) {
  const today = phoenixDate();
  const map = new Map<string, Checkin>();
  checkins.forEach((c) => {
    if (phoenixDate(Date.parse(c.time)) !== today) return;
    const k = nameKey(c.workerName);
    const prev = map.get(k);
    if (!prev || prev.time < c.time) map.set(k, c);
  });
  return map;
}
export const latestFor = (map: Map<string, Checkin>, name: string) => map.get(nameKey(name));
export const levelRank = (l: string | undefined) => (l === 'DANGER' ? 0 : l === 'CAUTION' ? 1 : l === 'OK' ? 2 : 3);
export const sameName = (a: string, b: string) => nameKey(a) === nameKey(b);
export const initial = (n: string) => n.trim().slice(0, 1).toUpperCase() || '?';
