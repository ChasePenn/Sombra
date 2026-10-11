import { ChevronLeft } from 'lucide-react';
import { useLocation } from 'wouter';
import { useSession } from '../lib/session';
import { aboutCopy, modeUi } from '../lib/copy';

export default function About() {
  const { lang, t } = useSession();
  const [, nav] = useLocation();
  const c = aboutCopy[lang];
  const ui = modeUi(lang);
  const sources: Array<[string, string, string]> = [
    ['Open-Meteo', 'https://open-meteo.com/', c.srcWeather],
    ['National Weather Service', 'https://www.weather.gov/documentation/services-web-api', c.srcAlerts],
    ['OpenStreetMap', 'https://www.openstreetmap.org/copyright', c.srcPlaces],
    ['OSHA', 'https://www.osha.gov/heat-exposure', c.srcWbgt],
    ['TB MED 507', 'https://armypubs.army.mil/epubs/DR_pubs/DR_a/ARN43608-TB_MED_507-001-WEB-2.pdf', c.srcRest],
    ['CDC', 'https://www.cdc.gov/heat-health/', c.srcFirstAid],
    ['Transformers.js', 'https://huggingface.co/docs/transformers.js', c.srcPhoto],
    ['Google Gemini', 'https://ai.google.dev/', c.srcCheckin],
  ];
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

        <h2>{c.how}</h2>
        <ul>
          <li>{c.how1}</li>
          <li>{c.how2}</li>
          <li>{c.how3}</li>
        </ul>

        <h2>{c.privacy}</h2>
        <ul>
          <li>{c.priv1}</li>
          <li>{c.priv2}</li>
          <li>{c.priv3}</li>
        </ul>
        <p style={{ marginTop: 10 }}>{c.p2}</p>

        <h2>{c.sources}</h2>
        <ul className="source-list">
          {sources.map(([name, href, use]) => (
            <li key={name}><a href={href} target="_blank" rel="noreferrer">{name}</a>: {use}</li>
          ))}
        </ul>

        <p className="disclaimer">{ui.footerDisclaimer} <strong>{ui.footerEmergency}</strong></p>
      </main>
    </div>
  );
}
