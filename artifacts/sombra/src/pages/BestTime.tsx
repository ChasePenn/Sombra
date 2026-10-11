import { useMemo, useState } from 'react';
import { Link } from 'wouter';
import { BellRing, CalendarClock, Droplet, Ban } from 'lucide-react';
import { AppShell } from '../components/AppShell';
import { LocationPicker, useInitialPlace } from '../components/LocationPicker';
import { Segmented } from '../components/Controls';
import { useSession } from '../lib/session';
import { audienceModeId, fill, modeRules } from '../lib/copy';
import { activityIntensity, featureCopy } from '../lib/features-copy';
import { getRiskFactors, getWindowReminders, saveWindowReminders } from '../lib/local';
import { clock, nextDate, phoenixNow } from '../lib/time';
import { pushIsOn } from '../lib/push';
import { findBestWindows } from '../../lib/best-window.js';
import table from '../../config/work_rest_table.json';

type Hour = { time: string; wbgtSunF: number };
type Window = ReturnType<typeof findBestWindows>['best'];

const riskClass = (category: number) => `risk-${Math.max(0, Math.min(5, category))}`;

export default function BestTime() {
  const { lang, profile } = useSession();
  const f = featureCopy[lang];
  const [place, setPlace] = useInitialPlace();
  const modeKey = f.activities[audienceModeId] ? audienceModeId : 'everyday';
  const presets = f.activities[modeKey];
  // The activity decides how hard it is, so people don't have to answer the same question twice.
  const [activityIndex, setActivityIndex] = useState(0);
  const activity = presets[activityIndex] ?? presets[0];
  const intensity = activityIntensity[modeKey]?.[activityIndex] ?? profile?.usualIntensity ?? 'moderate';
  const [duration, setDuration] = useState(2);
  const [state, setState] = useState<'idle' | 'loading' | 'error' | 'done'>('idle');
  const [result, setResult] = useState<ReturnType<typeof findBestWindows> | null>(null);
  const caution = getRiskFactors().length > 0 || (modeRules().categoryIncrease ?? 0) > 0;
  const [reminder, setReminder] = useState<string | null>(null);

  const planHref = (w: NonNullable<Window>) => {
    if (!place) return '/app';
    const q = new URLSearchParams({ lat: String(place.lat), lon: String(place.lon), place: place.name, date: w.date, start: w.start, end: w.end, intensity });
    return `/app?${q.toString()}`;
  };

  const remind = (w: NonNullable<Window>) => {
    const id = `${w.date}T${w.start}`;
    const others = getWindowReminders().filter((r) => r.id !== id);
    saveWindowReminders([...others, { id, date: w.date, start: w.start, activity, hours: duration }]);
    setReminder(id);
    if ('Notification' in window && Notification.permission === 'default') void Notification.requestPermission();
  };
  const cancelReminder = (id: string) => {
    saveWindowReminders(getWindowReminders().filter((r) => r.id !== id));
    setReminder(null);
  };

  const dayLabel = useMemo(() => {
    const today = phoenixNow().slice(0, 10);
    return (date: string) => (date === today ? f.today : f.tomorrow);
  }, [f.today, f.tomorrow]);

  const find = async () => {
    if (!place) return;
    setState('loading');
    try {
      const today = phoenixNow().slice(0, 10);
      const days = [today, nextDate(today)];
      const responses = await Promise.all(days.map(async (date) => {
        const res = await fetch('/api/weather/shift', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({
            workerName: profile?.name || 'sombra', locationName: place.name, latitude: place.lat, longitude: place.lon,
            intensity, startTime: '05:00', endTime: '22:00', date, newToHeat: Boolean(profile?.newToHeat),
          }),
        });
        if (!res.ok) throw new Error('forecast');
        const data = (await res.json()) as { hours: Hour[] };
        return data.hours.map((h) => ({ date, time: h.time, wbgtF: h.wbgtSunF }));
      }));
      setResult(findBestWindows({
        hours: responses.flat(), durationHours: duration, intensity, newToHeat: Boolean(profile?.newToHeat),
        categoryIncrease: caution ? 1 : 0, table, now: phoenixNow(),
      }));
      setState('done');
    } catch {
      setState('error');
    }
  };

  const advice = (w: NonNullable<Window>) => {
    if (w.work === 'NL') return lang === 'es' ? 'Ritmo normal. Ten agua cerca.' : 'Normal pace. Keep water nearby.';
    return lang === 'es'
      ? `Trabaja ${w.work} min y descansa ${w.restMinutes} en la sombra cada hora.`
      : `Go ${w.work} min, then rest ${w.restMinutes} in the shade each hour.`;
  };
  const span = (w: { date: string; start: string; end: string }) => `${dayLabel(w.date)} ${clock(w.start, lang)}–${clock(w.end, lang)}`;
  const liters = (qt: number) => Math.max(0.5, Math.round(qt * 0.946 * 2) / 2).toLocaleString(lang);

  return (
    <AppShell>
      <div className="page">
        <header className="page-head">
          <h1>{f.bestTitle}</h1>
          <p>{f.bestCard}</p>
        </header>

        <LocationPicker value={place} onChange={setPlace} />

        <div className="field">
          <span className="label">{f.activity}</span>
          <div className="chips" role="group" aria-label={f.activity}>
            {presets.map((p, i) => (
              <button key={p} type="button" className="chip" aria-pressed={activityIndex === i} onClick={() => setActivityIndex(i)}>{p}</button>
            ))}
          </div>
          <p className="seg-hint">{fill(f.countsAs, { level: f.effortWord[intensity] })}</p>
        </div>
        <div className="field">
          <span className="label">{f.howLong}</span>
          <Segmented label={f.howLong} value={String(duration)} onChange={(v) => setDuration(Number(v))}
            options={[1, 2, 3, 4, 6].map((n) => ({ value: String(n), label: fill(f.hours, { n }) }))} />
        </div>
        <button type="button" className="btn btn-primary btn-block" disabled={!place || state === 'loading'} onClick={find}>
          {state === 'loading' ? f.finding : f.find}
        </button>

        {state === 'error' && <p className="error" role="alert">{f.forecastFailed}</p>}

        {state === 'done' && result && (
          <section className="best-results" aria-live="polite">
            {result.best ? (
              <>
                <div className={`best-card ${riskClass(result.best.category)}`}>
                  <span className="best-kicker"><CalendarClock size={18} aria-hidden="true" />{f.bestLabel} · {activity}</span>
                  <strong className="best-span">{span(result.best)}</strong>
                  <span className="best-risk">{fill(f.bestRisk, { risk: f.riskWords[result.best.category] })}</span>
                  <p className="best-advice">{advice(result.best)}</p>
                  <p className="best-water"><Droplet size={16} aria-hidden="true" fill="currentColor" />{fill(f.bringWater, { liters: liters(result.best.waterQt) })}</p>
                  {result.best.category >= 4 && <p className="best-warn">{f.noSafe}</p>}
                </div>
                {result.alternatives.length > 0 && (
                  <div className="card-plain">
                    <h2>{f.otherTimes}</h2>
                    <ul className="time-list">
                      {result.alternatives.map((w) => (
                        <li key={`${w.date}${w.start}`}><span className={`dot ${riskClass(w.category)}`} />{span(w)}<small>{f.riskWords[w.category]}</small></li>
                      ))}
                    </ul>
                  </div>
                )}
                {result.avoid.length > 0 && (
                  <div className="card-plain">
                    <h2><Ban size={18} aria-hidden="true" /> {f.avoid}</h2>
                    <ul className="time-list">
                      {result.avoid.map((w) => <li key={`${w.date}${w.start}`}><span className="dot risk-4" />{span(w)}</li>)}
                    </ul>
                  </div>
                )}
                <div className="best-actions">
                  <Link href={planHref(result.best)} className="btn btn-primary btn-block">{f.planThis}</Link>
                  {reminder === `${result.best.date}T${result.best.start}` ? (
                    <>
                      <p className="notice" role="status">{fill(pushIsOn() ? f.reminderSetPush : f.reminderSet, { when: span(result.best) })}</p>
                      <button type="button" className="btn btn-quiet btn-block" onClick={() => cancelReminder(`${result.best!.date}T${result.best!.start}`)}>{f.reminderCancel}</button>
                    </>
                  ) : (
                    <button type="button" className="btn btn-secondary btn-block" onClick={() => remind(result.best!)}><BellRing size={18} aria-hidden="true" />{f.remindMe}</button>
                  )}
                </div>
              </>
            ) : (
              <p className="notice">{f.forecastFailed}</p>
            )}
          </section>
        )}
      </div>
    </AppShell>
  );
}
