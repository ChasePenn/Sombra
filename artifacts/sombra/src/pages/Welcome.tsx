import { Icon as ModeIcon } from '../components/Icon';
import { useRef, useState, type FormEvent } from 'react';
import { Camera, ClipboardCheck, Thermometer } from 'lucide-react';
import * as store from '../../public/js/store.js';
import { useSession } from '../lib/session';
import { IntensityPicker, LanguagePicker } from '../components/Controls';
import { audienceModeId, availableModes, currentMode, navigateToMode, type Intensity } from '../lib/copy';

export default function Welcome({ onDismiss }: { onDismiss: () => void }) {
  const { t, previewLang, setPreviewLang, setProfile } = useSession();
  const [idx, setIdx] = useState(0);
  const [name, setName] = useState('');
  const [intensity, setIntensity] = useState<Intensity>('moderate');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(false);
  const track = useRef<HTMLDivElement>(null);
  const slides = [
    { Icon: ClipboardCheck, title: currentMode(previewLang).welcomeQuestion ?? '', body: '' },
    { Icon: Thermometer, title: t.w1, body: t.w1s },
    { Icon: Camera, title: t.w2, body: t.w2s },
    { Icon: ClipboardCheck, title: t.w3, body: t.w3s },
  ];
  const last = slides.length - 1;
  const go = (i: number) => {
    const el = track.current;
    if (!el) return;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    el.scrollTo({ left: i * el.clientWidth, behavior: reduce ? 'auto' : 'smooth' });
    setIdx(i);
  };
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
        <span className="brand wordmark">
          <img src={`${import.meta.env.BASE_URL}brand/sombra-icon.svg`} alt="" />
          <span>sombra</span>
        </span>
        {idx < last ? (
          <button type="button" className="btn btn-quiet" onClick={() => go(last)}>{t.skip}</button>
        ) : (
          <button type="button" className="btn btn-quiet" onClick={onDismiss}>{t.notNow}</button>
        )}
      </div>
      <div className="slides" ref={track} onScroll={onScroll}>
        {slides.map(({ Icon, title, body }, i) => (
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
                      aria-pressed={audienceModeId === mode.id}
                      onClick={() => navigateToMode(mode.id)}
                    >
                      <span className="mode-choice-icon"><ModeIcon name={mode.icon} size={26} /></span>
                      <span className="mode-choice-copy"><strong>{mode.name}</strong><small>{mode.description}</small></span>
                      <span className="mode-choice-mark" aria-hidden="true">{audienceModeId === mode.id ? '✓' : ''}</span>
                    </button>
                  ))}
                </div>
              </div>
            ) : i < last ? (
              <>
                <div className="slide-icon" aria-hidden="true"><Icon size={48} strokeWidth={1.75} /></div>
                <h1>{title}</h1>
                <p>{body}</p>
              </>
            ) : (
              <form onSubmit={submit} className="form-slide-inner">
                <div className="slide-icon" aria-hidden="true" style={{ width: 64, height: 64, borderRadius: 18 }}><Icon size={32} strokeWidth={1.75} /></div>
                <h1 style={{ marginTop: 20 }}>{title}</h1>
                <p style={{ marginBottom: 22 }}>{body}</p>
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
        {idx < last && <button type="button" className="btn btn-primary btn-block" onClick={() => go(idx + 1)}>{t.next}</button>}
      </div>
    </div>
  );
}
