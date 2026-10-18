import { Icon as ModeIcon } from '../components/Icon';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import * as store from '../../public/js/store.js';
import { useSession } from '../lib/session';
import { IntensityPicker, LanguagePicker } from '../components/Controls';
import { audienceModeId, availableModes, currentMode, modeWasChosen, type Intensity } from '../lib/copy';

export default function Welcome({ onDismiss }: { onDismiss: () => void }) {
  const { t, previewLang, setPreviewLang, setProfile } = useSession();
  const [idx, setIdx] = useState(0);
  const [name, setName] = useState('');
  const [intensity, setIntensity] = useState<Intensity>('moderate');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(false);
  const track = useRef<HTMLDivElement>(null);
  // Two steps only: what you're planning for, then your name.
  const slides = [
    { title: currentMode(previewLang).welcomeQuestion ?? '' },
    { title: t.aboutYou },
  ];
  const last = slides.length - 1;
  const go = (i: number) => {
    const el = track.current;
    if (!el) return;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    el.scrollTo({ left: i * el.clientWidth, behavior: reduce ? 'auto' : 'smooth' });
    setIdx(i);
  };
  // Picking a mode reloads the app in that mode; then go straight on to the name step.
  const choose = (id: string) => {
    const url = new URL(window.location.href);
    url.searchParams.set('mode', id);
    url.searchParams.set('welcome', 'name');
    window.location.assign(url.toString());
  };
  useEffect(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.get('welcome') !== 'name') return;
    url.searchParams.delete('welcome');
    window.history.replaceState(window.history.state, '', url);
    const timer = window.setTimeout(() => go(last), 60);
    return () => window.clearTimeout(timer);
    // Once, on arrival.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const onScroll = () => {
    const el = track.current;
    if (el) setIdx(Math.round(el.scrollLeft / el.clientWidth));
  };
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true); setErr(false);
    try {
      const saved = await store.saveProfile({ name: name.trim(), language: previewLang, mode: audienceModeId, usualIntensity: intensity, newToHeat: false, notificationsEnabled: false });
      setProfile(saved);
    } catch {
      setErr(true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="welcome">
      <div className="welcome-top">
        <a href={import.meta.env.BASE_URL} className="brand wordmark" aria-label="sombra">
          <img src={`${import.meta.env.BASE_URL}brand/sombra-icon.svg`} alt="" />
          <span>sombra</span>
        </a>
        {idx < last ? (
          <button type="button" className="btn btn-quiet" onClick={() => go(last)}>{t.skip}</button>
        ) : (
          <button type="button" className="btn btn-quiet" onClick={onDismiss}>{t.notNow}</button>
        )}
      </div>
      <div className="slides" ref={track} onScroll={onScroll}>
        {slides.map(({ title }, i) => (
          <section key={title} className="slide" aria-hidden={idx !== i} aria-label={`${i + 1} / ${slides.length}`}>
            {i === 0 ? (
              <div className="mode-welcome">
                <h1>{currentMode(previewLang).welcomeQuestion}</h1>
                <div className="mode-choice-list" role="group" aria-label={currentMode(previewLang).welcomeQuestion}>
                  {availableModes(previewLang).map((mode) => (
                    <button
                      className={`mode-choice tone-${({ work: 'orange', school: 'blue', everyday: 'green' } as Record<string, string>)[mode.id] ?? 'orange'}`}
                      type="button"
                      key={mode.id}
                      aria-pressed={modeWasChosen && audienceModeId === mode.id}
                      onClick={() => choose(mode.id)}
                    >
                      <span className="mode-choice-icon"><ModeIcon name={mode.icon} size={26} /></span>
                      <span className="mode-choice-copy"><strong>{mode.name}</strong></span>
                      <span className="mode-choice-mark" aria-hidden="true" />
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <form onSubmit={submit} className="form-slide-inner">
                <h1 style={{ marginBottom: 22 }}>{title}</h1>
                <div className="field">
                  <label htmlFor="w-name">{t.name}</label>
                  <input id="w-name" className="input" value={name} onChange={(e) => setName(e.target.value)} autoComplete="given-name" required tabIndex={idx === i ? 0 : -1} />
                </div>
                <div className="field">
                  <span className="label">{t.language}</span>
                  <LanguagePicker label={t.language} value={previewLang} onChange={setPreviewLang} />
                </div>
                <div className="field">
                  <span className="label">{t.usualWork}</span>
                  <IntensityPicker lang={previewLang} label={t.usualWork} value={intensity} onChange={setIntensity} />
                </div>
                {err && <p className="error" role="alert">{t.somethingWrong}</p>}
                <button type="submit" className="btn btn-primary btn-block" disabled={busy || !name.trim()}>{busy ? t.saving : t.startPlanning}</button>
              </form>
            )}
          </section>
        ))}
      </div>
      <div className="welcome-bottom">
        <div className="dots" role="group" aria-label="Welcome">
          {slides.map((s, i) => (
            <button key={s.title} type="button" aria-label={s.title} aria-current={idx === i ? 'step' : undefined} onClick={() => go(i)}><span /></button>
          ))}
        </div>
        {/* Nothing is picked for you: Next waits for a choice (Skip still works). */}
        {idx < last && <button type="button" className="btn btn-primary btn-block" onClick={() => go(idx + 1)} disabled={idx === 0 && !modeWasChosen}>{t.next}</button>}
      </div>
    </div>
  );
}
