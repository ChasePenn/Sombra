import { useEffect } from 'react';
import { Link, useLocation } from 'wouter';
import { useSession } from '../lib/session';
import { goBack } from '../lib/nav';
import { legalContactUrl, legalCopy, legalUi } from '../lib/legal-copy';
import { ChevronLeft } from '../components/Icon';

function LegalPage({ which }: { which: 'privacy' | 'terms' }) {
  const { lang, t } = useSession();
  const [, nav] = useLocation();
  const doc = legalCopy[which][lang];
  const ui = legalUi[lang];
  useEffect(() => { window.scrollTo(0, 0); }, [which]);
  return (
    <div className="shell" style={{ paddingBottom: 'calc(32px + var(--safe-b))' }}>
      <header className="topbar" style={{ paddingLeft: 4 }}>
        <button type="button" className="icon-btn" aria-label={t.back} onClick={() => goBack(nav, '/')}><ChevronLeft size={26} /></button>
        <Link href="/" className="brand wordmark" aria-label="sombra"><img src={`${import.meta.env.BASE_URL}brand/sombra-icon.svg`} alt="" /><span>sombra</span></Link>
        <span style={{ width: 48 }} />
      </header>
      <main className="page prose legal">
        <h1>{doc.title}</h1>
        <p className="legal-date">{doc.updated}</p>
        <p>{doc.intro}</p>
        {doc.sections.map((s) => (
          <section key={s.id} id={s.id} aria-labelledby={`${which}-${s.id}`}>
            <h2 id={`${which}-${s.id}`}>{s.h}</h2>
            {s.p.map((text) => <p key={text}>{text}</p>)}
          </section>
        ))}
        <p className="legal-contact"><a href={legalContactUrl} target="_blank" rel="noreferrer">{ui.contact}</a></p>
        <nav className="legal-links" aria-label={ui.privacy}>
          {which === 'privacy' ? <Link href="/terms">{ui.terms}</Link> : <Link href="/privacy">{ui.privacy}</Link>}
          <Link href="/about">{t.about}</Link>
        </nav>
      </main>
    </div>
  );
}

export function Privacy() { return <LegalPage which="privacy" />; }
export function Terms() { return <LegalPage which="terms" />; }
