import { Link, Redirect } from 'wouter';
import { ChevronRight, Droplet } from 'lucide-react';
import { useSession } from '../lib/session';
import { availableModes, modeQuery } from '../lib/copy';
import { Icon } from '../components/Icon';

const modeTone: Record<string, string> = { work: 'tone-orange', school: 'tone-blue', everyday: 'tone-green' };

export default function Landing() {
  const { profile, profileLoaded, t, lang } = useSession();
  if (profileLoaded && profile) return <Redirect to="/app" replace />;
  return (
    <main className="landing">
      <header className="landing-top">
        <span className="brand wordmark"><img src={`${import.meta.env.BASE_URL}brand/sombra-icon.svg`} alt="" /><span>sombra</span></span>
        <Link href="/about" className="landing-about">{t.about}</Link>
      </header>

      <section className="landing-hero">
        <h1>{t.tagline}</h1>
        <p className="landing-sub">{t.landingSub}</p>
      </section>

      {/* A small, static preview of the real app so people see what they get before tapping anything. */}
      <div className="preview" aria-hidden="true">
        <div className="preview-today">
          <span className="preview-time">{t.previewTime}</span>
          <strong>{t.previewLevel}</strong>
          <span className="preview-gauge"><i /><i /><i /><i /><i /><i className="off" /></span>
          <span className="preview-advice">{t.previewAdvice}</span>
        </div>
        <div className="preview-chip preview-chip-check"><span className="preview-ring">AM</span>{t.previewCheck}</div>
        <div className="preview-chip preview-chip-water"><Droplet size={18} fill="currentColor" />{t.previewWater}</div>
      </div>

      <div className="landing-actions">
        <Link href={`/app${modeQuery}`} className="btn btn-primary btn-block">{t.getStarted}</Link>
        <Link href={`/sign-in${modeQuery}`} className="btn btn-secondary btn-block">{t.signIn}</Link>
      </div>

      <section className="landing-who" aria-labelledby="landing-who-title">
        <h2 id="landing-who-title">{t.landingWho}</h2>
        <div className="landing-modes">
          {availableModes(lang).map((mode) => (
            <Link key={mode.id} href={`/app?mode=${mode.id}`} className={`landing-mode ${modeTone[mode.id] ?? 'tone-orange'}`}>
              <span className="mode-choice-icon"><Icon name={mode.icon} size={26} /></span>
              <span className="landing-mode-copy"><strong>{mode.name}</strong><small>{mode.description}</small></span>
              <ChevronRight size={20} aria-hidden="true" className="landing-mode-arrow" />
            </Link>
          ))}
        </div>
      </section>

      <footer className="landing-foot">
        <span>{t.free}</span>
      </footer>
    </main>
  );
}
