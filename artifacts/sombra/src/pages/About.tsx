import { useEffect } from 'react';
import { Link, useLocation } from 'wouter';
import { useSession } from '../lib/session';
import { goBack } from '../lib/nav';
import { aboutCopy, modeUi } from '../lib/copy';
import { ChevronLeft } from '../components/Icon';
import { legalUi } from '../lib/legal-copy';

export default function About() {
  const { lang, t } = useSession();
  const [, nav] = useLocation();
  const c = aboutCopy[lang];
  const ui = modeUi(lang);
  // Footer links like /about#privacy jump to their section once the page has rendered.
  useEffect(() => {
    const id = window.location.hash.slice(1);
    if (id) document.getElementById(id)?.scrollIntoView();
  }, []);
  const sources: Array<[string, string, string]> = [
    ['Open-Meteo', 'https://open-meteo.com/', c.srcWeather],
    ['National Weather Service', 'https://www.weather.gov/documentation/services-web-api', c.srcAlerts],
    ['OpenStreetMap', 'https://www.openstreetmap.org/copyright', c.srcPlaces],
    ['Heat Relief Network (MAG)', 'https://azmag.gov/Programs/Heat-Relief-Network', c.srcRelief],
    ['OSHA', 'https://www.osha.gov/heat-exposure', c.srcWbgt],
    ['TB MED 507', 'https://hprc-online.org/resources/tb-med-507-heat-stress-control-and-heat-casualty-management-pdf', c.srcRest],
    ['CDC', 'https://www.cdc.gov/heat-health/', c.srcFirstAid],
    ['Transformers.js', 'https://huggingface.co/docs/transformers.js', c.srcPhoto],
    ['Google Gemini', 'https://ai.google.dev/', c.srcCheckin],
  ];
  return (
    <div className="shell" style={{ paddingBottom: 'calc(32px + var(--safe-b))' }}>
      <header className="topbar" style={{ paddingLeft: 4 }}>
        <button type="button" className="icon-btn" aria-label={t.back} onClick={() => goBack(nav, '/')}><ChevronLeft size={26} /></button>
        <Link href="/" className="brand wordmark" aria-label="sombra"><img src={`${import.meta.env.BASE_URL}brand/sombra-icon.svg`} alt="" /><span>sombra</span></Link>
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

        <h2 id="privacy">{c.privacy}</h2>
        <ul>
          <li>{c.priv1}</li>
          <li>{c.priv2}</li>
          <li>{c.priv3}</li>
        </ul>
        <p style={{ marginTop: 10 }}>{c.p2}</p>
        <p style={{ marginTop: 10 }}><Link href="/privacy">{legalUi[lang].privacy}</Link> · <Link href="/terms">{legalUi[lang].terms}</Link></p>

        <h2 id="sources">{c.sources}</h2>
        <ul className="source-list">
          {sources.map(([name, href, use]) => (
            <li key={name}><a href={href} target="_blank" rel="noreferrer">{name}</a>: {use}</li>
          ))}
        </ul>

        <p className="disclaimer">{ui.footerDisclaimer} <strong>{ui.footerEmergency}</strong></p>
        <p className="copyright">© {new Date().getFullYear()} sombra</p>
      </main>
    </div>
  );
}
