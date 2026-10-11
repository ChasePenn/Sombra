import { ChevronLeft } from 'lucide-react';
import { useLocation } from 'wouter';
import { useSession } from '../lib/session';
import { aboutCopy, modeUi } from '../lib/copy';

const text = aboutCopy;

export default function About() {
  const { lang, t } = useSession();
  const [, nav] = useLocation();
  const c = text[lang];
  const ui = modeUi(lang);
  return (
    <div className="shell" style={{ paddingBottom: 'calc(32px + var(--safe-b))' }}>
      <header className="topbar" style={{ paddingLeft: 4 }}>
        <button type="button" className="icon-btn" aria-label={t.back} onClick={() => (window.history.length > 1 ? window.history.back() : nav('/'))}><ChevronLeft size={26} /></button>
        <span className="brand wordmark"><img src={`${import.meta.env.BASE_URL}brand/sombra-icon.svg`} alt="" /><span>sombra</span></span>
        <span style={{ width: 48 }} />
      </header>
      <main className="page prose">
        <h1 style={{ fontSize: '1.65rem' }}>{c.title}</h1>
        <p style={{ marginTop: 10 }}>{c.what}</p>
        <h2>{c.sources}</h2>
        <ul>
          <li><a href="https://open-meteo.com/" target="_blank" rel="noreferrer">Open-Meteo</a></li>
          <li>Liljegren WBGT model</li>
          <li>U.S. Army TB MED 507</li>
          <li>OSHA and CDC heat guidance</li>
          <li>Transformers.js / CLIP</li>
          <li>Google Gemini</li>
        </ul>
        <h2>{c.privacy}</h2>
        <p>{c.p1}</p>
        <p style={{ marginTop: 10 }}>{c.p2}</p>
        <p className="disclaimer">{ui.footerDisclaimer} <strong>{ui.footerEmergency}</strong></p>
      </main>
    </div>
  );
}
