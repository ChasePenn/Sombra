import type { Lang } from './copy';

/** Phoenix local time as "YYYY-MM-DDTHH:MM" (Arizona has no daylight saving time). */
export function phoenixNow(date = new Date()) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Phoenix', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).formatToParts(date).map(({ type, value }) => [type, value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

export function nextDate(isoDate: string) {
  const d = new Date(`${isoDate}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/** "14:00" -> "2 PM" (English) or "2 p. m." style handled by Intl for Spanish. */
export function clock(time: string, lang: Lang) {
  const [h, m] = time.split(':').map(Number);
  const d = new Date(Date.UTC(2000, 0, 1, h, m));
  return new Intl.DateTimeFormat(lang === 'es' ? 'es-US' : 'en-US', {
    hour: 'numeric', minute: m ? '2-digit' : undefined, timeZone: 'UTC',
  }).format(d);
}
