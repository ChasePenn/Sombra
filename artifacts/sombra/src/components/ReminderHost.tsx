import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation } from 'wouter';
import { dueReminder, phoenixDate } from '@workspace/heat-safety/session';
import type { WorkerSession } from '@workspace/heat-safety/session';
import * as store from '../../public/js/store.js';
import { trackWorkerSession } from '../../public/js/checkin-service.js';
import { useSession } from '../lib/session';
import { checkInCopy, fill } from '../lib/copy';
import { sameName } from '../lib/activity';
import { Sheet } from './Sheet';

type Due = NonNullable<ReturnType<typeof dueReminder>>;

/** Mounted once. Foreground-only reminders for active work sessions. */
export function ReminderHost() {
  const { lang, accountId, t } = useSession();
  const [loc, setLocation] = useLocation();
  const [rem, setRem] = useState<{ session: WorkerSession; due: Due } | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(false);
  const eligible = (loc === '/app' || loc.startsWith('/app/')) && !loc.startsWith('/app/check-in');
  const eligibleRef = useRef(eligible);
  eligibleRef.current = eligible;
  const remRef = useRef(rem);
  remRef.current = rem;
  const running = useRef(false);

  const check = useCallback(async () => {
    if (running.current || remRef.current || !eligibleRef.current || document.visibilityState === 'hidden') return;
    running.current = true;
    try {
      const [sessions, checkins] = await Promise.all([store.getSessions(), store.getCheckins()]);
      const today = phoenixDate();
      for (const s of sessions) {
        if (s.date !== today) continue;
        const due = dueReminder(s, checkins.filter((c) => sameName(c.workerName, s.workerName)), Date.now());
        if (due && !s.remindersShown.includes(due.key)) {
          if (eligibleRef.current && !remRef.current) setRem({ session: s, due });
          break;
        }
      }
    } catch { /* reminders are best-effort */ }
    finally { running.current = false; }
  }, []);

  useEffect(() => {
    setRem(null);
    const id = window.setInterval(check, 15000);
    const onOnline = () => { store.syncActivity().catch(() => undefined).finally(() => { window.dispatchEvent(new Event('sombra:activity')); check(); }); };
    window.addEventListener('focus', check);
    window.addEventListener('sombra:activity', check);
    window.addEventListener('online', onOnline);
    document.addEventListener('visibilitychange', check);
    check();
    return () => {
      window.clearInterval(id);
      window.removeEventListener('focus', check);
      window.removeEventListener('sombra:activity', check);
      window.removeEventListener('online', onOnline);
      document.removeEventListener('visibilitychange', check);
    };
  }, [check, accountId]);

  useEffect(() => { if (eligible) check(); }, [eligible, check]);

  if (!rem || !eligible) return null;
  const c = checkInCopy(lang);
  const name = rem.session.workerName;
  const { due } = rem;
  const vars = { name, minutes: due.minutes ?? '', cups: due.cups ?? '' };
  const title = c[`rem_${due.type}`];
  const body = fill(c[`rem_${due.type}Body`], vars);

  const mark = async () => {
    const latest = (await store.getSessions()).find((s) => s.date === rem.session.date && sameName(s.workerName, name)) ?? rem.session;
    if (!latest.remindersShown.includes(due.key)) await store.saveSession({ ...latest, remindersShown: [...latest.remindersShown, due.key] });
  };
  const act = async (kind: 'dismiss' | 'primary') => {
    setBusy(true); setErr(false);
    try {
      await mark();
      if (kind === 'primary') {
        if (due.type === 'break') await trackWorkerSession(name, 'start-break');
        else if (due.type === 'water') await trackWorkerSession(name, 'water');
        else setLocation(`/app/check-in?worker=${encodeURIComponent(name)}`);
      }
      setRem(null);
    } catch {
      setErr(true);
    } finally {
      setBusy(false);
    }
  };
  const primary = due.type === 'break' ? c.startBreak : due.type === 'water' ? c.addCup : c.openSheet;

  return (
    <Sheet title={title} onClose={() => act('dismiss')} closeLabel={t.close}>
      <div className={`reminder rem-${due.type}`}>
        <p className="rem-body">{body}</p>
        {err && <p className="error" role="alert">{c.trackError}</p>}
        <div className="sheet-actions">
          <button type="button" className="btn btn-primary" onClick={() => act('primary')} disabled={busy}>{primary}</button>
          <button type="button" className="btn btn-quiet" onClick={() => act('dismiss')} disabled={busy}>{c.later}</button>
        </div>
      </div>
    </Sheet>
  );
}
