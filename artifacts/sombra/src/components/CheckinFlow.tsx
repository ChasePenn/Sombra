import { useEffect, useRef } from 'react';
import { Link } from 'wouter';
import { firstAid } from '@workspace/heat-safety/templates';
import type { SessionContext } from '@workspace/heat-safety/session';
import type { CheckinResult } from '../../public/js/checkin-service.js';
import { checkInCopy, fill, type Lang } from '../lib/copy';
import { useSpeech } from '../lib/speech';
import { fmtDuration, waterText } from '../lib/activity';
import { Sheet } from './Sheet';
import { featureCopy } from '../lib/features-copy';
import { Check, Mic, MicOff, Phone, Snowflake } from './Icon';

export const FINE = 'fine';

export function SymptomSheet({ lang, name, selected, onToggle, note, onNote, onSubmit, onClose, busy, ready, closeLabel }: {
  lang: Lang; name: string; selected: string[]; onToggle: (id: string) => void; note: string; onNote: (v: string) => void;
  onSubmit: () => void; onClose: () => void; busy: boolean; ready: boolean; closeLabel: string;
}) {
  const c = checkInCopy(lang);
  const speech = useSpeech(lang, (text) => onNote((note ? `${note} ${text}` : text).slice(0,1000)));
  const opts = [...c.questions, { id: FINE, label: c.fine }];
  return (
    <Sheet title={fill(c.sheetTitle, { name })} onClose={onClose} closeLabel={closeLabel}>
      <p>{c.sheetSub}</p>
      <div className="sym-grid" role="group" aria-label={fill(c.sheetTitle, { name })}>
        {opts.map((q) => {
          const on = selected.includes(q.id);
          return (
            <button key={q.id} type="button" className={`sym${q.id === FINE ? ' sym-fine' : ''}`} aria-pressed={on} onClick={() => onToggle(q.id)}>
              <span className="sym-box" aria-hidden="true">{on && <Check size={18} strokeWidth={3} />}</span>
              <span>{q.label}</span>
            </button>
          );
        })}
      </div>
      <div className="field" style={{ marginTop: 16 }}>
        <label htmlFor="ci-note">{c.noteLabel}</label>
        <div className="note-wrap">
          <textarea id="ci-note" className="input note" maxLength={1000} rows={2} value={note} placeholder={c.notePlaceholder} onChange={(e) => onNote(e.target.value)} />
          <button type="button" className="icon-btn mic" disabled={!speech.supported} aria-pressed={speech.listening}
            aria-label={speech.listening ? c.stopSpeak : c.speak} onClick={speech.listening ? speech.stop : speech.start}>
            {speech.supported ? <Mic size={22} /> : <MicOff size={22} />}
          </button>
        </div>
        <p className="seg-hint" aria-live="polite">
          {!speech.supported ? c.speechUnsupported : speech.listening ? c.listening : speech.failed ? c.speechFailed : ''}
        </p>
      </div>
      <div className="sheet-actions">
        <button type="button" className="btn btn-primary" onClick={onSubmit} disabled={busy || !ready || selected.length === 0}>
          {busy ? c.sending : c.submit}
        </button>
      </div>
    </Sheet>
  );
}

export function NumbersLine({ ctx, lang }: { ctx: SessionContext; lang: Lang }) {
  const c = checkInCopy(lang);
  if (ctx.activityAvailable === false) return <p className="numbers">{c.activityUnknown}</p>;
  return <p className="numbers">{fill(c.numbers, { hours: fmtDuration(ctx.hoursWorked, lang), water: waterText(ctx, lang), breaks: ctx.breaksTaken })}</p>;
}

export function ResultSheet({ lang, result, ctx, name, saveError, onClose, closeLabel }: {
  lang: Lang; result: CheckinResult; ctx: SessionContext; name: string; saveError?: string; onClose: () => void; closeLabel: string;
}) {
  const c = checkInCopy(lang);
  const lvl = result.level === 'CAUTION' ? 'CAUTION' : 'OK';
  const aid = lvl === 'CAUTION' ? firstAid[lang].CAUTION : null;
  return (
    <Sheet title={lvl === 'CAUTION' ? c.resultTitle_CAUTION : c.resultTitle_OK} onClose={onClose} closeLabel={closeLabel}>
      <div className={`result lvl-${lvl.toLowerCase()}`}>
        <span className={`lvl-pill${lvl === 'OK' ? ' lvl-ok-stamp' : ''}`}>{c[`level_${lvl}`]}</span>
        <NumbersLine ctx={ctx} lang={lang} />
        {aid && (
          <section className="aid" aria-labelledby="aid-title">
            <h3 id="aid-title">{aid.title}</h3>
            <ol>{aid.steps.map((s) => <li key={s}>{s}</li>)}</ol>
            <p className="aid-rem">{aid.reminder}</p>
            <p className="aid-src">{c.firstAidSources}</p>
          </section>
        )}
        <section className="personal" aria-label={fill(c.forYou, { name })}>
          <div className="personal-head">
            <h3>{fill(c.forYou, { name })}</h3>
            <span className={`src src-${result.source}`}>{result.source === 'ai' ? c.sourceAi : c.sourceTemplate}</span>
          </div>
          <p>{result.message}</p>
          {result.follow_up_question && <p className="followq"><strong>{c.followUp}:</strong> {result.follow_up_question}</p>}
          {result.actions.length > 0 && (
            <>
              <h4>{c.actions}</h4>
              <ul className="acts">{result.actions.slice(0, 3).map((a) => <li key={a}><Check size={18} aria-hidden="true" />{a}</li>)}</ul>
            </>
          )}
        </section>
        <p className="recheck">{fill(c.recheck, { minutes: result.recheck_in_minutes })}</p>
        {saveError && <p className="error" role="alert">{c.saveError}</p>}
        <div className="sheet-actions">
          {/* When someone feels unwell, getting cool is the main next step. */}
          {lvl === 'CAUTION' && <Link href="/app/cool-spots?now=1" className="btn btn-primary"><Snowflake size={18} aria-hidden="true" />{featureCopy[lang].coolNow}</Link>}
          <button type="button" className={`btn ${lvl === 'CAUTION' ? 'btn-secondary' : 'btn-primary'}`} onClick={onClose}>{c.done}</button>
        </div>
      </div>
    </Sheet>
  );
}

export function DangerScreen({ lang, name, saveError, onClose }: { lang: Lang; name: string; saveError?: string; onClose: () => void }) {
  const c = checkInCopy(lang);
  const aid = firstAid[lang].DANGER;
  const callRef = useRef<HTMLAnchorElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    callRef.current?.focus();
    const trap = (event:KeyboardEvent) => {
      if (event.key !== 'Tab') return;
      const dialog = callRef.current?.closest('.ci-danger');
      const targets = dialog?.querySelectorAll<HTMLElement>('a[href],button:not(:disabled)');
      if (!targets?.length) return;
      const first = targets[0], last = targets[targets.length-1];
      if (event.shiftKey && document.activeElement === first) {event.preventDefault();last.focus();}
      else if (!event.shiftKey && document.activeElement === last) {event.preventDefault();first.focus();}
    };
    document.addEventListener('keydown',trap);
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown',trap); document.body.style.overflow = ''; prev?.focus(); };
  }, []);
  return (
    <div className="ci-danger" role="alertdialog" aria-modal="true" aria-labelledby="danger-title" aria-describedby="danger-steps">
      <div className="danger-inner">
        <p className="danger-kicker">{c.dangerKicker}: {name}</p>
        <h2 id="danger-title">{aid.title}</h2>
        <a ref={callRef} href="tel:911" className="call911"><Phone size={34} aria-hidden="true" />{c.call911}</a>
        <ol id="danger-steps" className="danger-steps">{aid.steps.map((s) => <li key={s}>{s}</li>)}</ol>
        <div className="danger-stay"><strong>{c.dangerStay}</strong><span>{aid.reminder}</span></div>
        {saveError && <p className="danger-save" role="status">{c.saveError}</p>}
        <p className="danger-src">{c.firstAidSources}</p>
        <button type="button" className="btn danger-close" onClick={onClose}>{c.dangerClose}</button>
      </div>
    </div>
  );
}
