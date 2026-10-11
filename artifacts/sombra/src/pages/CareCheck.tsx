import { useEffect, useState, type FormEvent } from 'react';
import { Check, Lock, Phone, Plus, Trash2, TriangleAlert } from 'lucide-react';
import { AppShell } from '../components/AppShell';
import { Sheet } from '../components/Sheet';
import { useSession } from '../lib/session';
import { fill } from '../lib/copy';
import { featureCopy } from '../lib/features-copy';
import { getCareContacts, getLastPlace, saveCareContacts, type CareContact } from '../lib/local';
import { checkedTodayAt, markChecked } from '../lib/care';
import { clock } from '../lib/time';

const initials = (name: string) => name.trim().split(/\s+/).map((p) => p[0]).slice(0, 2).join('').toUpperCase();

export default function CareCheck() {
  const { lang, t } = useSession();
  const f = featureCopy[lang];
  const [contacts, setContacts] = useState<CareContact[]>(getCareContacts);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [time, setTime] = useState('10:00');
  const [heatWarning, setHeatWarning] = useState(false);

  useEffect(() => {
    const sync = () => setContacts(getCareContacts());
    window.addEventListener('sombra:local', sync);
    return () => window.removeEventListener('sombra:local', sync);
  }, []);

  useEffect(() => {
    // Show a stronger nudge when the National Weather Service has a heat alert for the last planned place.
    const place = getLastPlace();
    if (!place) return;
    fetch(`/api/conditions?lat=${place.lat}&lon=${place.lon}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { alerts: { kind: string }[] | null } | null) => setHeatWarning(Boolean(d?.alerts?.some((a) => a.kind === 'heat'))))
      .catch(() => undefined);
  }, []);

  const add = (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    const next = [...contacts, { id: crypto.randomUUID(), name: name.trim(), phone: phone.trim(), time, lastChecked: null }];
    saveCareContacts(next);
    setContacts(next);
    setName(''); setPhone(''); setTime('10:00'); setAdding(false);
    if ('Notification' in window && Notification.permission === 'default') void Notification.requestPermission();
  };

  const remove = (id: string) => {
    const next = contacts.filter((c) => c.id !== id);
    saveCareContacts(next);
    setContacts(next);
  };

  return (
    <AppShell>
      <div className="page">
        <header className="page-head">
          <h1>{f.careTitle}</h1>
          <p>{f.careSub}</p>
        </header>
        <p className="privacy-note"><Lock size={16} aria-hidden="true" />{f.carePrivacy}</p>
        {heatWarning && <p className="alert-strip" role="status"><TriangleAlert size={18} aria-hidden="true" />{f.careWarnOn}</p>}

        {contacts.length === 0 && <p className="notice">{f.careEmpty}</p>}
        <ul className="care-list">
          {contacts.map((c) => {
            const at = checkedTodayAt(c);
            return (
              <li key={c.id} className={`care-card ${at ? 'is-done' : ''}`}>
                <div className="care-top">
                  <span className="care-avatar" aria-hidden="true">{initials(c.name)}</span>
                  <span className="care-copy">
                    <strong>{c.name}</strong>
                    <small>{at ? fill(f.careCheckedAt, { time: clock(at, lang) }) : fill(f.careNotYet, { time: clock(c.time, lang) })}</small>
                  </span>
                  <button type="button" className="icon-btn" aria-label={`${f.careRemove} ${c.name}`} onClick={() => remove(c.id)}><Trash2 size={18} /></button>
                </div>
                <div className="care-actions">
                  {c.phone && <a className="btn btn-secondary" href={`tel:${c.phone.replace(/[^\d+]/g, '')}`}><Phone size={18} aria-hidden="true" />{f.careCall}</a>}
                  <button type="button" className="btn btn-primary" disabled={Boolean(at)} onClick={() => setContacts(markChecked(c.id))}>
                    <Check size={18} aria-hidden="true" />{at ? f.careChecked : f.careMark}
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
        <button type="button" className="btn btn-secondary btn-block" onClick={() => setAdding(true)}><Plus size={18} aria-hidden="true" />{f.careAdd}</button>
        <p className="fine-print care-tips">{f.careTips}</p>
      </div>

      {adding && (
        <Sheet title={f.careAdd} onClose={() => setAdding(false)} closeLabel={t.close}>
          <form onSubmit={add}>
            <div className="field"><label htmlFor="care-name">{f.careName}</label><input id="care-name" className="input" value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" required /></div>
            <div className="field"><label htmlFor="care-phone">{f.carePhone}</label><input id="care-phone" className="input" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} autoComplete="off" /></div>
            <div className="field"><label htmlFor="care-time">{f.careTime}</label><input id="care-time" className="input" type="time" value={time} onChange={(e) => setTime(e.target.value)} required /></div>
            <div className="sheet-actions">
              <button type="submit" className="btn btn-primary btn-block" disabled={!name.trim()}>{f.careSave}</button>
              <button type="button" className="btn btn-quiet btn-block" onClick={() => setAdding(false)}>{f.careCancel}</button>
            </div>
          </form>
        </Sheet>
      )}
    </AppShell>
  );
}
