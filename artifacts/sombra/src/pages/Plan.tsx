import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'wouter';
import { X } from 'lucide-react';
import * as store from '../../public/js/store.js';
import { useSession } from '../lib/session';
import { AppShell } from '../components/AppShell';
import Welcome from './Welcome';
import { modeQuery } from '../lib/copy';
import { ContextCards } from '../components/ContextCards';

const PREFILL_KEYS = ['lat', 'lon', 'place', 'date', 'start', 'end', 'intensity'];

/** Carries a "Plan this" request from Best time into the planner once, then cleans the URL. */
function usePlannerQuery() {
  const [query] = useState(() => {
    const current = new URLSearchParams(window.location.search);
    const next = new URLSearchParams(modeQuery.replace(/^\?/, ''));
    PREFILL_KEYS.forEach((key) => { const value = current.get(key); if (value) next.set(key, value); });
    if (PREFILL_KEYS.some((key) => current.has(key))) {
      PREFILL_KEYS.forEach((key) => current.delete(key));
      const rest = current.toString();
      window.history.replaceState(window.history.state, '', `${window.location.pathname}${rest ? `?${rest}` : ''}`);
    }
    const text = next.toString();
    return text ? `?${text}` : '';
  });
  return query;
}

function PlannerFrame({ onSummary }: { onSummary: (maxCategory: number) => void }) {
  const { accountId, profile, lang, t } = useSession();
  const plannerQuery = usePlannerQuery();
  const summaryRef = useRef(onSummary);
  summaryRef.current = onSummary;
  const ref = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(900);
  const [loaded, setLoaded] = useState(false);
  const [prompt, setPrompt] = useState(false);
  const [, setLocation] = useLocation();
  const navRef = useRef(setLocation);
  navRef.current = setLocation;
  const guestRef = useRef(!accountId);
  guestRef.current = !accountId;

  const post = useCallback(() => {
    ref.current?.contentWindow?.postMessage({ type: 'sombra:session', userId: accountId, profile, language: lang }, window.location.origin);
  }, [accountId, profile, lang]);

  useEffect(() => { if (loaded) post(); }, [loaded, post]);

  useEffect(() => {
    const on = (e: MessageEvent) => {
      if (e.origin !== window.location.origin || e.source !== ref.current?.contentWindow) return;
      const d = e.data as { type?: string; height?: number; workerName?: unknown } | null;
      if (d?.type === 'sombra:check-in' && typeof d.workerName === 'string' && d.workerName.trim() && d.workerName.length <= 120) {
        navRef.current(`/app/check-in?worker=${encodeURIComponent(d.workerName.trim())}`);
        return;
      }
      if (d?.type === 'sombra:summary' && typeof (d as { maxCategory?: unknown }).maxCategory === 'number') summaryRef.current((d as { maxCategory: number }).maxCategory);
      if (d?.type === 'sombra:planner-height' && typeof d.height === 'number' && d.height > 0) setHeight(Math.ceil(d.height));
      if (d?.type === 'sombra:planned' && guestRef.current && !store.isSignInPromptDismissed()) setPrompt(true);
    };
    window.addEventListener('message', on);
    return () => window.removeEventListener('message', on);
  }, []);

  return (
    <>
      <h1 className="vh">{t.plannerTitle}</h1>
      {prompt && !accountId && (
        <div className="prompt" role="status">
          <p>{t.signInPrompt} <Link href="/sign-in">{t.signIn}</Link></p>
          <button type="button" className="icon-btn" aria-label={t.dismiss} onClick={() => { store.dismissSignInPrompt(); setPrompt(false); }}><X size={20} /></button>
        </div>
      )}
      <div className="planner-wrap">
        {!loaded && (
          <div className="skel" aria-hidden="true">
            <span style={{ height: 34, width: '60%' }} /><span style={{ height: 56 }} /><span style={{ height: 56 }} /><span style={{ height: 120 }} /><span style={{ height: 52 }} />
          </div>
        )}
        <iframe
          ref={ref}
          title={t.plannerTitle}
          className="planner-frame"
          src={`${import.meta.env.BASE_URL}planner.html${plannerQuery}`}
          style={{ height, visibility: loaded ? 'visible' : 'hidden', position: loaded ? 'static' : 'absolute', top: 0 }}
          onLoad={() => { setLoaded(true); post(); }}
        />
      </div>
    </>
  );
}

export default function Plan() {
  const { profile, profileLoaded, profileError, t, reloadProfile } = useSession();
  const [dismissed, setDismissed] = useState(store.isWelcomeDismissed);
  const [skipError, setSkipError] = useState(false);
  const [maxCategory, setMaxCategory] = useState<number | null>(null);
  if (!profileLoaded) return <AppShell><div className="skel" aria-busy="true"><span style={{ height: 34, width: '55%' }} /><span style={{ height: 56 }} /><span style={{ height: 160 }} /></div></AppShell>;
  if (profileError) return <AppShell><div className="page"><div className="error" role="alert">{t.somethingWrong}<button className="btn btn-quiet" onClick={reloadProfile}>{t.retry}</button></div></div></AppShell>;
  if (!profile && !dismissed) return <Welcome onDismiss={() => {
    try { store.dismissWelcome(); } catch { setSkipError(true); }
    setDismissed(true);
  }} />;
  return <AppShell>{skipError && <p className="error" role="alert">{t.somethingWrong}</p>}<ContextCards maxCategory={maxCategory} /><PlannerFrame onSummary={setMaxCategory} /></AppShell>;
}
