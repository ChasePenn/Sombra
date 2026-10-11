import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useLocation } from 'wouter';
import { Pencil, Plus, Users } from 'lucide-react';
import * as store from '../../public/js/store.js';
import type { Checkin, CrewMember } from '../../public/js/store.js';
import { checkInCopy, fill } from '../lib/copy';
import { fmtTime, initial, isLevel, latestFor, latestToday, levelRank } from '../lib/activity';
import { useSession } from '../lib/session';
import { intensityLabel, modeUi, type Intensity } from '../lib/copy';
import { AppShell } from '../components/AppShell';
import { setGroupEnabled } from '../lib/local';
import { Sheet } from '../components/Sheet';
import { IntensityPicker, Switch } from '../components/Controls';

type Draft = { index: number | null; name: string; intensity: Intensity; newToHeat: boolean };

export default function Crew() {
  const { t, lang, accountId, profile } = useSession();
  const [crew, setCrew] = useState<CrewMember[] | null>(null);
  const [err, setErr] = useState(false);
  const [nonce, setNonce] = useState(0);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [saveErr, setSaveErr] = useState(false);
  const [checkins, setCheckins] = useState<Checkin[]>([]);
  const [, setLocation] = useLocation();

  useEffect(() => {
    let live = true;
    const load = () => store.getCheckins().then((x) => live && setCheckins(x)).catch(() => undefined);
    load();
    window.addEventListener('sombra:activity', load);
    window.addEventListener('focus', load);
    return () => { live = false; window.removeEventListener('sombra:activity', load); window.removeEventListener('focus', load); };
  }, [accountId]);

  const rings = useMemo(() => {
    const latest = latestToday(checkins);
    const seen = new Set<string>();
    const people: string[] = [];
    [profile?.name, ...(crew ?? []).map((m) => m.name)].forEach((n) => {
      if (n && !seen.has(n.trim().toLowerCase())) { seen.add(n.trim().toLowerCase()); people.push(n); }
    });
    return people
      .map((name, order) => ({ name, order, last: latestFor(latest, name) }))
      .sort((a, b) => levelRank(a.last?.level) - levelRank(b.last?.level) || a.order - b.order);
  }, [checkins, crew, profile]);

  useEffect(() => {
    let live = true;
    setErr(false);
    store.getCrew().then((c) => live && setCrew(c)).catch(() => live && setErr(true));
    return () => { live = false; };
  }, [accountId, nonce]);

  const persist = async (next: CrewMember[]) => {
    setBusy(true); setSaveErr(false);
    try {
      setCrew(await store.saveCrew(next));
      if (next.length > 0) setGroupEnabled(true);
      setDraft(null);
    } catch {
      setSaveErr(true);
    } finally {
      setBusy(false);
    }
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!draft || !draft.name.trim() || !crew) return;
    const member: CrewMember = { name: draft.name.trim(), intensity: draft.intensity, newToHeat: draft.newToHeat };
    const next = draft.index === null ? [...crew, member] : crew.map((c, i) => (i === draft.index ? { ...c, ...member } : c));
    persist(next);
  };
  const remove = () => {
    if (!draft || draft.index === null || !crew) return;
    persist(crew.filter((_, i) => i !== draft.index));
  };
  const openNew = () => { setSaveErr(false); setDraft({ index: null, name: '', intensity: profile?.usualIntensity ?? 'moderate', newToHeat: false }); };
  const ui = modeUi(lang);
  const ci = checkInCopy(lang);

  return (
    <AppShell>
      <div className="page">
        <div className="page-head" style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 12 }}>
          <div><h1>{t.crew}</h1><p>{t.crewSub}</p></div>
          {crew && crew.length > 0 && <button type="button" className="btn btn-secondary" style={{ minHeight: 48, padding: '0 14px' }} onClick={openNew}><Plus size={20} aria-hidden="true" />{t.addPerson}</button>}
        </div>
        {rings.length > 0 && (
          <section className="rings-wrap" aria-labelledby="rings-h">
            <h2 id="rings-h" className="group-label" style={{ marginTop: 0 }}>{ci.crewToday}</h2>
            <p className="seg-hint" style={{ margin: '0 4px 10px' }}>{ci.crewTap}</p>
            <ul className="rings">
              {rings.map(({ name, last }) => {
                const lvl = last && isLevel(last.level) ? last.level : null;
                return (
                  <li key={name}>
                    <button type="button" className={`ring lv-${lvl ?? 'none'}`} onClick={() => setLocation(`/app/check-in?worker=${encodeURIComponent(name)}`)}
                      aria-label={`${fill(ci.checkInFor, { name })}. ${lvl ? ci[`level_${lvl}`] : ci.level_unknown}${last ? `, ${fill(ci.lastAt, { time: fmtTime(last.time, lang) })}` : ''}`}>
                      <span className="ring-circle" aria-hidden="true">{initial(name)}</span>
                      <span className="ring-name">{name}</span>
                      <span className="ring-lvl">{lvl ? ci[`level_${lvl}`] : ci.level_unknown}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        )}
        {err && <div className="error" role="alert">{t.somethingWrong}<button className="btn btn-quiet" onClick={() => setNonce((n) => n + 1)}>{t.retry}</button></div>}
        {!err && crew === null && <div className="skel" style={{ padding: 0 }} aria-hidden="true"><span style={{ height: 60 }} /><span style={{ height: 60 }} /><span style={{ height: 60 }} /></div>}
        {!err && crew?.length === 0 && (
          <div className="empty">
            <span className="feat-icon" aria-hidden="true"><Users size={22} /></span>
            <h2>{t.noCrew}</h2><p>{t.noCrewSub}</p>
            <button type="button" className="btn btn-primary" onClick={openNew}><Plus size={20} aria-hidden="true" />{t.addPerson}</button>
          </div>
        )}
        {crew && crew.length > 0 && (
          <ul className="list group">
            {crew.map((c, i) => (
              <li key={c.id ?? `${c.name}-${i}`} className="person">
                <span className="avatar" aria-hidden="true">{c.name.slice(0, 1).toUpperCase()}</span>
                <span className="row-main">
                  {c.name}{c.newToHeat && <span className="tag">{ui.newToHeatQuestion ? t.newToHeat : ''}</span>}
                  <small>{intensityLabel(lang, c.intensity)}</small>
                </span>
                <button type="button" className="icon-btn" aria-label={`${t.edit} ${c.name}`} onClick={() => { setSaveErr(false); setDraft({ index: i, name: c.name, intensity: c.intensity, newToHeat: c.newToHeat }); }}><Pencil size={20} /></button>
              </li>
            ))}
          </ul>
        )}
      </div>
      {draft && (
        <Sheet title={draft.index === null ? t.addPerson : t.editPerson} onClose={() => setDraft(null)} closeLabel={t.close}>
          <form onSubmit={submit}>
            <div className="field">
              <label htmlFor="c-name">{t.personName}</label>
              <input id="c-name" className="input" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} required />
            </div>
            <div className="field">
              <span className="label">{t.workType}</span>
              <IntensityPicker lang={lang} label={t.workType} value={draft.intensity} onChange={(v) => setDraft({ ...draft, intensity: v })} />
            </div>
            <div className="row" style={{ padding: '4px 0', borderTop: 0 }}>
              <span className="row-main">{t.newToHeat}<small>{t.newToHeatHint}</small></span>
              <Switch label={t.newToHeat} checked={draft.newToHeat} onChange={(v) => setDraft({ ...draft, newToHeat: v })} />
            </div>
            {saveErr && <p className="error" role="alert">{t.somethingWrong}</p>}
            <div className="sheet-actions">
              <button type="submit" className="btn btn-primary" disabled={busy || !draft.name.trim()}>{busy ? t.saving : t.save}</button>
              {draft.index !== null && <button type="button" className="btn btn-quiet" style={{ color: 'var(--danger-ink)' }} onClick={remove} disabled={busy}>{t.remove}</button>}
            </div>
          </form>
        </Sheet>
      )}
    </AppShell>
  );
}
