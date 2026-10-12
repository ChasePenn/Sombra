import { useEffect, useState } from 'react';
import { roundedQuery } from '../../public/js/geo.js';
import { Phone, Check } from 'lucide-react';
import { useSession } from '../lib/session';
import { fill } from '../lib/copy';
import { featureCopy } from '../lib/features-copy';
import { getCareContacts, getWindowReminders, saveWindowReminders, type CareContact } from '../lib/local';
import { ESCALATE_AFTER_MIN, isDue, markChecked, needsAfternoonCheck, overdueMinutes } from '../lib/care';
import { getLastPlace } from '../lib/local';
import { showReminder } from '../lib/pwa';
import { pushIsOn } from '../lib/push';
import { phoenixNow } from '../lib/time';
import { Sheet } from './Sheet';

const NOTIFIED = 'sombra.care-notified';

function notifiedToday(id: string, today: string) {
  try { return (JSON.parse(window.localStorage.getItem(NOTIFIED) || '{}') as Record<string, string>)[id] === today; } catch { return false; }
}
function rememberNotified(id: string, today: string) {
  try {
    const map = JSON.parse(window.localStorage.getItem(NOTIFIED) || '{}') as Record<string, string>;
    window.localStorage.setItem(NOTIFIED, JSON.stringify({ ...map, [id]: today }));
  } catch { /* the reminder may show again; harmless */ }
}

/** Mounted once. While sombra is open, reminds you to check on the people you added. */
export function CareReminderHost() {
  const { lang, t } = useSession();
  const f = featureCopy[lang];
  const [due, setDue] = useState<CareContact | null>(null);
  const [windowDue, setWindowDue] = useState<{ activity: string; hours: number } | null>(null);
  const [dueKind, setDueKind] = useState<'first' | 'overdue' | 'afternoon'>('first');
  const [heatWarning, setHeatWarning] = useState(false);

  // Watch for National Weather Service heat warnings at the last planned place (every 30 minutes).
  useEffect(() => {
    const check = () => {
      const place = getLastPlace();
      if (!place || getCareContacts().length === 0) return;
      fetch(`/api/conditions?${roundedQuery(place)}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((d: { alerts: { kind: string }[] | null } | null) => setHeatWarning(Boolean(d?.alerts?.some((a) => a.kind === 'heat'))))
        .catch(() => undefined);
    };
    check();
    const id = window.setInterval(check, 30 * 60 * 1000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    const tick = () => {
      const now = phoenixNow();
      const today = now.slice(0, 10);
      // Best time reminders: fire once when the window starts, then forget it.
      const windows = getWindowReminders();
      const startedWindow = windows.find((w) => `${w.date}T${w.start}` <= now);
      if (startedWindow) {
        saveWindowReminders(windows.filter((w) => w.id !== startedWindow.id));
        const late = `${startedWindow.date}T${startedWindow.start}` < phoenixNow(new Date(Date.now() - 30 * 60 * 1000));
        if (!late) {
          // With push on, the server already sent this as a notification; just show it in the app.
          if (!pushIsOn()) void showReminder(`${fill(f.reminderDue, { activity: startedWindow.activity })}. ${fill(f.reminderDueBody, { hours: startedWindow.hours })}`, `sombra-window-${startedWindow.id}`);
          setWindowDue(startedWindow);
        }
      }
      const contacts = getCareContacts();
      // 1) first reminder, 2) escalation 2 hours later, 3) afternoon re-check during heat warnings
      const pick: [CareContact, 'first' | 'overdue' | 'afternoon'] | undefined =
        contacts.filter((c) => isDue(c, now) && !notifiedToday(c.id, today)).map((c) => [c, 'first'] as [CareContact, 'first'])[0] ??
        contacts.filter((c) => overdueMinutes(c, now) >= ESCALATE_AFTER_MIN && !notifiedToday(`${c.id}:overdue`, today)).map((c) => [c, 'overdue'] as [CareContact, 'overdue'])[0] ??
        (heatWarning ? contacts.filter((c) => needsAfternoonCheck(c, now) && !notifiedToday(`${c.id}:afternoon`, today)).map((c) => [c, 'afternoon'] as [CareContact, 'afternoon'])[0] : undefined);
      if (!pick) return;
      const [next, kind] = pick;
      rememberNotified(kind === 'first' ? next.id : `${next.id}:${kind}`, today);
      setDue(next);
      setDueKind(kind);
      const title = kind === 'overdue' ? fill(f.careOverdueTitle, { name: next.name }) : fill(f.careDue, { name: next.name });
      const body = kind === 'overdue' ? f.careOverdueBody : f.careDueBody;
      if (!pushIsOn()) void showReminder(`${title}. ${body}`, `sombra-care-${next.id}-${kind}`);
    };
    tick();
    const id = window.setInterval(tick, 60_000);
    window.addEventListener('focus', tick);
    return () => { window.clearInterval(id); window.removeEventListener('focus', tick); };
  }, [f, heatWarning]);

  if (windowDue && !due) {
    return (
      <Sheet title={fill(f.reminderDue, { activity: windowDue.activity })} onClose={() => setWindowDue(null)} closeLabel={t.close}>
        <p>{fill(f.reminderDueBody, { hours: windowDue.hours })}</p>
        <div className="sheet-actions"><button type="button" className="btn btn-primary btn-block" onClick={() => setWindowDue(null)}>OK</button></div>
      </Sheet>
    );
  }
  if (!due) return null;
  return (
    <Sheet title={dueKind === 'overdue' ? fill(f.careOverdueTitle, { name: due.name }) : fill(f.careDue, { name: due.name })} onClose={() => setDue(null)} closeLabel={t.close}>
      {dueKind === 'afternoon' && <p className="sheet-kicker">{f.careAfternoon}</p>}
      <p>{dueKind === 'overdue' ? f.careOverdueBody : f.careDueBody}</p>
      <div className="sheet-actions">
        {due.phone && <a className="btn btn-secondary btn-block" href={`tel:${due.phone.replace(/[^\d+]/g, '')}`}><Phone size={18} aria-hidden="true" />{f.careCall}</a>}
        <button type="button" className="btn btn-primary btn-block" onClick={() => { markChecked(due.id); setDue(null); }}><Check size={18} aria-hidden="true" />{f.careMark}</button>
      </div>
    </Sheet>
  );
}
