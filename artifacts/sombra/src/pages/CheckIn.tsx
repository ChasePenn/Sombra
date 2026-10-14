import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useSearch } from 'wouter';
import { ClipboardCheck, Coffee, Droplet, Play, Square, UserRound } from 'lucide-react';
import { emptySession } from '@workspace/heat-safety/session';
import type { WorkerSession, SessionContext } from '@workspace/heat-safety/session';
import * as store from '../../public/js/store.js';
import type { Checkin, CrewMember } from '../../public/js/store.js';
import { getWorkerSession, trackWorkerSession, localCheckinResult, submitCheckin, getResultContext } from '../../public/js/checkin-service.js';
import type { CheckinResult } from '../../public/js/checkin-service.js';
import { useSession } from '../lib/session';
import { audienceModeId, checkInCopy, fill, siteLabel } from '../lib/copy';
import { fmtDay, fmtDuration, fmtTime, initial, isLevel, riskWord, waterText, workState } from '../lib/activity';
import { AppShell } from '../components/AppShell';
import { pushIsOn } from '../lib/push';
import { PageHead } from '../components/Story';
import { Sheet } from '../components/Sheet';
import { DangerScreen, FINE, ResultSheet, SymptomSheet } from '../components/CheckinFlow';

type Outcome = { result: CheckinResult; ctx: SessionContext; saveError?: string };

export default function CheckIn() {
  const { t, lang, profile, profileLoaded, accountId, authLoaded } = useSession();
  const c = checkInCopy(lang);
  const search = useSearch();
  const [, setLocation] = useLocation();
  const paramWorker = useMemo(() => new URLSearchParams(search).get('worker')?.trim() || '', [search]);

  const [who, setWho] = useState('');
  const [crew, setCrew] = useState<CrewMember[]>([]);
  const [session, setSession] = useState<WorkerSession | null>(null);
  const [items, setItems] = useState<Checkin[] | null>(null);
  const [err, setErr] = useState(false);
  const [nonce, setNonce] = useState(0);
  const [sheet, setSheet] = useState<'symptoms' | 'picker' | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [danger, setDanger] = useState<{ name: string; saveError?: string } | null>(null);
  const [trackBusy, setTrackBusy] = useState(false);
  const [trackErr, setTrackErr] = useState(false);
  const [sessionLoadError, setSessionLoadError] = useState(false);
  const [pending, setPending] = useState(store.hasPendingActivity());
  const [syncing, setSyncing] = useState(false);
  const [typed, setTyped] = useState('');
  const [, tick] = useState(0);
  const autoOpened = useRef(false);
  const dangerSaved = useRef(false);
  const pendingRequest = useRef<AbortController | null>(null);
  const requestGeneration = useRef(0);
  useEffect(() => () => pendingRequest.current?.abort(), []);

  // Who is checking in: ?worker in the URL, then the profile name, then ask.
  useEffect(() => {
    if (paramWorker) { setWho(paramWorker); return; }
    if (!profileLoaded) return;
    if (profile?.name) setWho((w) => w || profile.name);
    else setWho((w) => { if (!w) setSheet('picker'); return w; });
  }, [paramWorker, profile, profileLoaded]);

  useEffect(() => { if(authLoaded) store.getCrew().then(setCrew).catch(() => undefined); }, [authLoaded,accountId]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);
  useEffect(() => {
    const on = () => { reload(); setPending(store.hasPendingActivity()); };
    window.addEventListener('sombra:activity', on);
    const id = window.setInterval(() => tick((n) => n + 1), 30000);
    return () => { window.removeEventListener('sombra:activity', on); window.clearInterval(id); };
  }, [reload]);

  useEffect(() => {
    let live = true;
    if (!authLoaded) { setSession(null);setItems(null);return; }
    setErr(false);
    setSession((s)=>s?.workerName === who ? s : null);
    store.getCheckins().then((x) => live && setItems(x)).catch(() => live && setErr(true));
    if (who) {
      setSessionLoadError(false);
      getWorkerSession(who).then((s) => live && setSession(s)).catch(() => {if (live) {setSession(null);setSessionLoadError(true);}});
    }
    setPending(store.hasPendingActivity());
    return () => { live = false; };
  }, [who, accountId, authLoaded, nonce]);

  // Open the symptom sheet immediately once we know who.
  useEffect(() => {
    if (who && !autoOpened.current) { autoOpened.current = true; setSheet('symptoms'); }
  }, [who]);

  const names = useMemo(() => {
    const s = new Set<string>();
    if (profile?.name) s.add(profile.name);
    crew.forEach((m) => m.name && s.add(m.name));
    return [...s];
  }, [profile, crew]);

  const current = () => session ?? emptySession(who);
  const symptomsOf = (sel: string[]) => sel.filter((id) => id !== FINE);
  const cancelPending = () => {
    if (pendingRequest.current && !pendingRequest.current.signal.aborted) {
      pendingRequest.current.abort();requestGeneration.current += 1;setBusy(false);
    }
  };

  const triggerDanger = (symptoms: string[], local: CheckinResult) => {
    // Show this right away, before anything async.
    pendingRequest.current?.abort();
    requestGeneration.current += 1;
    setBusy(false); setOutcome(null);
    setSheet(null);
    setDanger({ name: who });
    if (dangerSaved.current) return;
    dangerSaved.current = true;
    void local;
    submitCheckin({ session: current(), symptoms, note: note.trim() || undefined, language: lang, mode: audienceModeId })
      .then((r) => { if (r.saveError) setDanger((d) => (d ? { ...d, saveError: r.saveError } : d)); })
      .catch(() => setDanger((d) => (d ? { ...d, saveError: 'save' } : d)))
      .finally(reload);
  };

  const toggle = (id: string) => {
    cancelPending();
    let next: string[];
    if (id === FINE) next = selected.includes(FINE) ? [] : [FINE];
    else next = selected.includes(id) ? selected.filter((x) => x !== id) : [...selected.filter((x) => x !== FINE), id];
    setSelected(next);
    const symptoms = symptomsOf(next);
    if (symptoms.length) {
      const local = localCheckinResult(current(), symptoms, lang, audienceModeId);
      if (local.level === 'DANGER') triggerDanger(symptoms, local);
    }
  };

  const submit = async () => {
    if (busy || !selected.length) return;
    const s = current();
    const symptoms = symptomsOf(selected);
    const local = localCheckinResult(s, symptoms, lang, audienceModeId);
    if (local.level === 'DANGER') { triggerDanger(symptoms, local); return; }
    setBusy(true);
    const generation = ++requestGeneration.current;
    const controller = new AbortController();
    pendingRequest.current = controller;
    try {
      const r = await submitCheckin({ session: s, symptoms, note: note.trim() || undefined, language: lang, mode: audienceModeId, signal:controller.signal });
      if (generation !== requestGeneration.current) return;
      const ctx = r.checkin?.detailsJson?.context ?? getResultContext(s);
      if (r.result.level === 'DANGER') setDanger({name:who,saveError:r.saveError});
      else setOutcome({ result: r.result, ctx, saveError: r.saveError });
    } catch {
      if (generation === requestGeneration.current) setOutcome({ result: local, ctx: getResultContext(s), saveError: 'save' });
    } finally {
      if (generation === requestGeneration.current) {
        pendingRequest.current = null;
        setBusy(false); setSheet(null);
        setSelected([]); setNote('');
      }
      reload();
    }
  };

  const openSymptoms = () => { dangerSaved.current = false; setSelected([]); setNote(''); setSheet(who ? 'symptoms' : 'picker'); };

  const choose = (name: string) => {
    const n = name.trim();
    if (!n) return;
    setWho(n); setSession(null); setTyped('');
    setLocation(`/app/check-in?worker=${encodeURIComponent(n)}`, { replace: true });
    dangerSaved.current = false; setSelected([]); setNote('');
    setSheet('symptoms');
    autoOpened.current = true;
  };

  const track = async (action: 'start' | 'start-break' | 'end-break' | 'end' | 'water') => {
    if (!who) return;
    setTrackBusy(true); setTrackErr(false);
    try { setSession(await trackWorkerSession(who, action)); setPending(store.hasPendingActivity()); }
    catch { setTrackErr(true); }
    finally { setTrackBusy(false); }
  };

  const sync = async () => {
    setSyncing(true);
    try { await store.syncActivity(); } catch { /* stays pending */ }
    finally { setSyncing(false); setPending(store.hasPendingActivity()); reload(); }
  };

  const ctx = session ? getResultContext(session) : null;
  const state = workState(session);
  const openBreak = session?.breaks.find((b) => !b.end);
  const qLabel = (id: string) => c.questions.find((q) => q.id === id)?.label ?? id;

  const groups = useMemo(() => {
    const sorted = [...(items ?? [])].sort((a, b) => b.time.localeCompare(a.time));
    const g: { day: string; list: Checkin[] }[] = [];
    const today = fmtDay(new Date().toISOString(), lang);
    sorted.forEach((x) => {
      const d0 = fmtDay(x.time, lang);
      const d = d0 === today ? t.today : d0;
      const last = g[g.length - 1];
      if (last?.day === d) last.list.push(x); else g.push({ day: d, list: [x] });
    });
    return g;
  }, [items, lang, t.today]);

  return (
    <AppShell>
      <div className="page">
        <PageHead story="out" title={c.pageTitle} lead={c.pageSub} />

        {accountId && pending && (
          <div className="notice sync-note" role="status">
            <span>{c.pendingSync}</span>
            <button type="button" className="btn btn-quiet" onClick={sync} disabled={syncing}>{syncing ? c.syncing : c.syncNow}</button>
          </div>
        )}

        <section className="work-card" aria-labelledby="wc-name">
          <div className="wc-head">
            <span className={`avatar wc-av st-${state}`} aria-hidden="true">{who ? initial(who) : <UserRound size={20} />}</span>
            <div className="row-main">
              <h2 id="wc-name">{who || c.pickWorker}</h2>
              {who && <small className={`wc-state st-${state}`}>{c[state]}{openBreak ? ` · ${fill(c.breakOpen, { time: fmtTime(openBreak.start, lang) })}` : ''}</small>}
            </div>
            <button type="button" className="btn btn-quiet" onClick={() => setSheet('picker')}>{c.changeWorker}</button>
          </div>

           {who && (session?.activityAvailable === false ? <>
             <p className="error" role="status">{c.activityUnknown}</p>
             <dl className="stats">
               <div className="stat"><dt>{c.worked}</dt><dd>{c.riskUnknown}</dd></div>
               <div className="stat"><dt>{c.water}</dt><dd>{c.riskUnknown}</dd></div>
               <div className="stat"><dt>{c.breaks}</dt><dd>{c.riskUnknown}</dd></div>
               <div className="stat"><dt>{c.site}</dt><dd>{c.riskUnknown}</dd></div>
             </dl>
             <button className="btn btn-quiet" onClick={reload}>{t.retry}</button>
           </> : session && ctx ? (
            <>
              {/* Before anything is logged, the tiles would all read zero or unknown, so they wait. */}
              {(state !== 'notStarted' || ctx.waterCups > 0 || ctx.breaksTaken > 0) && (
                <>
                  <dl className="stats">
                    <div className="stat stat-big"><dt>{c.worked}</dt><dd className="num">{fmtDuration(ctx.hoursWorked, lang)}</dd></div>
                    <div className="stat stat-big"><dt>{c.water}</dt><dd className="num">{waterText(ctx, lang)}</dd></div>
                    <div className="stat"><dt>{c.breaks}</dt><dd>{fill(c.breaksCount, { count: ctx.breaksTaken })}</dd></div>
                    {ctx.siteType && <div className="stat"><dt>{c.site}</dt><dd>{siteLabel(lang, ctx.siteType)}</dd></div>}
                    {ctx.currentCategory != null && <div className="stat"><dt>{c.heatNow}</dt><dd>{riskWord(ctx.currentCategory, lang)}</dd></div>}
                    {ctx.nextCategory != null && <div className="stat"><dt>{c.heatNext}</dt><dd>{riskWord(ctx.nextCategory, lang)}</dd></div>}
                  </dl>
                  {ctx.recommendedCups === null && <p className="seg-hint">{c.waterUnknown}</p>}
                </>
              )}
              {session.breaks.length > 0 && (
                <ul className="break-list" aria-label={c.breaks}>
                  {session.breaks.map((b) => <li key={b.start}>{fmtTime(b.start, lang)} – {b.end ? fmtTime(b.end, lang) : c.onBreak}</li>)}
                </ul>
              )}
              <div className="track">
                {state === 'notStarted' && <button type="button" className="btn btn-primary btn-block" disabled={trackBusy} onClick={() => track('start')}><Play size={20} aria-hidden="true" />{c.startWork}</button>}
                {state === 'working' && <button type="button" className="btn btn-secondary" disabled={trackBusy} onClick={() => track('start-break')}><Coffee size={20} aria-hidden="true" />{c.startBreak}</button>}
                {state === 'onBreak' && <button type="button" className="btn btn-secondary" disabled={trackBusy} onClick={() => track('end-break')}><Play size={20} aria-hidden="true" />{c.endBreak}</button>}
                 <button type="button" className={`btn btn-water${state === 'notStarted' || state === 'finished' ? ' btn-block' : ''}`} disabled={trackBusy} onClick={() => track('water')}><Droplet size={20} aria-hidden="true" />{c.addCup}</button>
                {(state === 'working' || state === 'onBreak') && <button type="button" className="btn btn-quiet btn-block" disabled={trackBusy} onClick={() => track('end')}><Square size={18} aria-hidden="true" />{c.finishWork}</button>}
              </div>
              {trackErr && <p className="error" role="alert">{c.trackError}</p>}
            </>
           ) : sessionLoadError ? <div className="error" role="alert">{c.trackError}<button className="btn btn-quiet" onClick={reload}>{t.retry}</button></div> : <div className="skel" style={{ padding: 0 }} aria-hidden="true"><span style={{ height: 72 }} /><span style={{ height: 54 }} /></div>)}

          <button type="button" className="btn btn-bark btn-block" onClick={openSymptoms}><ClipboardCheck size={22} aria-hidden="true" />{c.openSheet}</button>
          {/* Only worth saying when closed-app reminders are off. */}
          {!pushIsOn() && <p className="seg-hint">{c.remindersOpen}</p>}
        </section>

        <h2 className="group-label">{c.history}</h2>
        {err && <div className="error" role="alert">{t.somethingWrong}<button className="btn btn-quiet" onClick={reload}>{t.retry}</button></div>}
        {!err && items === null && <div className="skel" style={{ padding: 0 }} aria-hidden="true"><span style={{ height: 64 }} /><span style={{ height: 64 }} /></div>}
        {!err && items?.length === 0 && (
          <div className="empty">
            <span className="feat-icon" aria-hidden="true"><ClipboardCheck size={22} /></span>
            <h2>{c.noHistory}</h2><p style={{ marginBottom: 0 }}>{c.noHistorySub}</p>
          </div>
        )}
        {groups.map((g) => (
          <section key={g.day}>
            <h3 className="day-label">{g.day}</h3>
            <ul className="list group">
              {g.list.map((x, i) => {
                const lvl = isLevel(x.level) ? x.level : null;
                const d = x.detailsJson;
                return (
                  <li key={x.id ?? `${x.time}-${i}`} className="hist">
                    <div className="hist-top">
                      <span className={`dot lv-${lvl ?? 'none'}`} aria-hidden="true" />
                      <span className="row-main"><strong>{x.workerName}</strong></span>
                      <span className={`lvl-chip lv-${lvl ?? 'none'}`}>{lvl ? c[`level_${lvl}`] : c.legacy}</span>
                      <span className="time">{fmtTime(x.time, lang)}</span>
                    </div>
                    {lvl && <p className="hist-sym">{x.symptomsJson.length ? x.symptomsJson.map(qLabel).join(', ') : c.feltFine}</p>}
                    {d?.note && <p className="hist-note">{d.note}</p>}
                    {d?.response?.message && <p className="hist-out">{d.response.message}</p>}
                    {d?.pendingSync && <span className="tag pend">{c.pendingRow}</span>}
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>

      {sheet === 'symptoms' && who && !danger && (
        <SymptomSheet lang={lang} name={who} selected={selected} onToggle={toggle} note={note} onNote={(text)=>{cancelPending();setNote(text);}}
           onSubmit={submit} onClose={() => { pendingRequest.current?.abort(); requestGeneration.current += 1; setBusy(false); setSheet(null); }} busy={busy} ready={authLoaded && !!session} closeLabel={t.close} />
      )}
      {sheet === 'picker' && (
        <Sheet title={c.pickWorker} onClose={() => setSheet(null)} closeLabel={t.close}>
          <p>{c.pickWorkerSub}</p>
          {names.length > 0 ? (
            <div className="pick-list">
              {names.map((n) => (
                <button key={n} type="button" className="pick" aria-pressed={n === who} onClick={() => choose(n)}>
                  <span className="avatar" aria-hidden="true">{initial(n)}</span><span>{n}</span>
                </button>
              ))}
            </div>
          ) : <p className="notice">{c.noWorkers}</p>}
          <form className="pick-form" onSubmit={(e) => { e.preventDefault(); choose(typed); }}>
            <label htmlFor="pick-name" className="vh">{t.personName}</label>
            <input id="pick-name" className="input" maxLength={80} value={typed} placeholder={t.personName} onChange={(e) => setTyped(e.target.value)} />
            <button type="submit" className="btn btn-primary" disabled={!typed.trim()}>{fill(c.useName, { name: typed.trim() || '…' })}</button>
          </form>
        </Sheet>
      )}
      {outcome && (
        <ResultSheet lang={lang} result={outcome.result} ctx={outcome.ctx} name={who} saveError={outcome.saveError}
          onClose={() => setOutcome(null)} closeLabel={t.close} />
      )}
      {danger && <DangerScreen lang={lang} name={danger.name} saveError={danger.saveError} onClose={() => { setDanger(null); setSelected([]); setNote(''); }} />}
    </AppShell>
  );
}
