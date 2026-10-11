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
