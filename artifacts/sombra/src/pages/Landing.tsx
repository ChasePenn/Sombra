import { Link, Redirect } from 'wouter';
import { useSession } from '../lib/session';
import { availableModes, modeQuery } from '../lib/copy';
import { ChevronRight, Icon } from '../components/Icon';
import { DayStory } from '../components/DayStory';
import { featureCopy } from '../lib/features-copy';

const modeTone: Record<string, string> = { work: 'tone-orange', school: 'tone-blue', everyday: 'tone-green' };

/** Colors the last two words of the headline ("Phoenix heat."), the one bit of color in the hero. */
function headline(text: string) {
  const words = text.split(' ');
  if (words.length < 4) return text;
  return <>{words.slice(0, -2).join(' ')} <em>{words.slice(-2).join(' ')}</em></>;
}

export default function Landing() {
  const { profile, profileLoaded, t, lang } = useSession();
  const f = featureCopy[lang];
  if (profileLoaded && profile) return <Redirect to="/app" replace />;
  return (
    <main className="landing">
      <header className="landing-top">
        <Link href="/" className="brand wordmark" aria-label="sombra"><img src={`${import.meta.env.BASE_URL}brand/sombra-icon.svg`} alt="" /><span>sombra</span></Link>
        <Link href="/about" className="landing-about">{t.about}</Link>
      </header>

      <section className="landing-hero">
        <h1>{headline(t.tagline)}</h1>
      </section>

      {/* What the app's own heat card looks like on a very hot afternoon. */}
      <div className="hero-card" aria-hidden="true">
        <strong>{f.heroLevel}</strong>
        <span className="hero-stress">{f.heroStress}</span>
        <span className="hero-gauge"><i /><i /><i /><i /><i /><i className="off" /></span>
        <span className="hero-advice">{f.heroAdvice}</span>
      </div>

      <div className="landing-actions">
        <Link href={`/app${modeQuery}`} className="btn btn-primary btn-block">{t.getStarted}</Link>
        <Link href={`/sign-in${modeQuery}`} className="btn btn-secondary btn-block">{t.signIn}</Link>
      </div>

      <section className="landing-tools" aria-label={f.landingDay}>
        <DayStory />
      </section>

      <section className="landing-who" aria-labelledby="landing-who-title">
        <h2 id="landing-who-title">{t.landingWho}</h2>
        <div className="landing-modes">
          {availableModes(lang).map((mode) => (
            <Link key={mode.id} href={`/app?mode=${mode.id}`} className={`landing-mode ${modeTone[mode.id] ?? 'tone-orange'}`}>
              <span className="mode-choice-icon"><Icon name={mode.icon} size={26} /></span>
              <span className="landing-mode-copy"><strong>{mode.name}</strong></span>
              <ChevronRight size={20} aria-hidden="true" className="landing-mode-arrow" />
            </Link>
          ))}
        </div>
      </section>

      <footer className="landing-foot site-foot">
        <span>{t.free}</span>
        <nav className="foot-links" aria-label={t.about}>
          <Link href="/about">{t.about}</Link>
          <Link href="/privacy">{t.privacyLink}</Link>
          <Link href="/terms">{f.termsLink}</Link>
          <Link href="/about#sources">{t.sourcesLink}</Link>
        </nav>
        <small>© {new Date().getFullYear()} sombra</small>
      </footer>
    </main>
  );
}
