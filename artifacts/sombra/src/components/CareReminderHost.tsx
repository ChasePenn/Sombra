import { useEffect, useState } from 'react';
import { Phone, Check } from 'lucide-react';
import { useSession } from '../lib/session';
import { fill } from '../lib/copy';
import { featureCopy } from '../lib/features-copy';
import { getCareContacts, type CareContact } from '../lib/local';
import { isDue, markChecked } from '../lib/care';
import { showReminder } from '../lib/pwa';
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

  useEffect(() => {
    const tick = () => {
      const now = phoenixNow();
      const today = now.slice(0, 10);
      const next = getCareContacts().find((c) => isDue(c, now) && !notifiedToday(c.id, today));
      if (!next) return;
      rememberNotified(next.id, today);
      setDue(next);
      void showReminder(`${fill(f.careDue, { name: next.name })}. ${f.careDueBody}`, `sombra-care-${next.id}`);
    };
    tick();
    const id = window.setInterval(tick, 60_000);
    window.addEventListener('focus', tick);
    return () => { window.clearInterval(id); window.removeEventListener('focus', tick); };
  }, [f]);

  if (!due) return null;
  return (
    <Sheet title={fill(f.careDue, { name: due.name })} onClose={() => setDue(null)} closeLabel={t.close}>
      <p>{f.careDueBody}</p>
      <div className="sheet-actions">
        {due.phone && <a className="btn btn-secondary btn-block" href={`tel:${due.phone.replace(/[^\d+]/g, '')}`}><Phone size={18} aria-hidden="true" />{f.careCall}</a>}
        <button type="button" className="btn btn-primary btn-block" onClick={() => { markChecked(due.id); setDue(null); }}><Check size={18} aria-hidden="true" />{f.careMark}</button>
      </div>
    </Sheet>
  );
}
