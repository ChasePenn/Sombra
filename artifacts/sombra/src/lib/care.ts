import { getCareContacts, saveCareContacts, type CareContact } from './local';
import { phoenixNow } from './time';

/** Is this person still waiting for today's check-in, and has their reminder time passed? */
export function isDue(contact: CareContact, now = phoenixNow()) {
  const today = now.slice(0, 10);
  const checkedToday = contact.lastChecked != null && phoenixNow(new Date(contact.lastChecked)).slice(0, 10) === today;
  return !checkedToday && now.slice(11, 16) >= contact.time;
}

export function checkedTodayAt(contact: CareContact, now = phoenixNow()) {
  if (!contact.lastChecked) return null;
  const local = phoenixNow(new Date(contact.lastChecked));
  return local.slice(0, 10) === now.slice(0, 10) ? local.slice(11, 16) : null;
}

export function markChecked(id: string) {
  const next = getCareContacts().map((c) => (c.id === id ? { ...c, lastChecked: new Date().toISOString() } : c));
  saveCareContacts(next);
  return next;
}

const minutes = (clock: string) => Number(clock.slice(0, 2)) * 60 + Number(clock.slice(3, 5));

/** Minutes past the reminder time with no check-in today (0 when not overdue). */
export function overdueMinutes(contact: CareContact, now = phoenixNow()) {
  if (!isDue(contact, now)) return 0;
  return Math.max(0, minutes(now.slice(11, 16)) - minutes(contact.time));
}

export const ESCALATE_AFTER_MIN = 120;
export const AFTERNOON_CHECK = '16:00';

/** During a heat warning, a second check is due at 4 PM unless they were checked after 1 PM. */
export function needsAfternoonCheck(contact: CareContact, now = phoenixNow()) {
  if (now.slice(11, 16) < AFTERNOON_CHECK) return false;
  const at = checkedTodayAt(contact, now);
  return at == null ? contact.time < AFTERNOON_CHECK : at < '13:00';
}
