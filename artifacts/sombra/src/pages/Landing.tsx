import { Link, Redirect } from 'wouter';
import { useSession } from '../lib/session';
import { availableModes, modeQuery, modeWasChosen } from '../lib/copy';
import { ChevronRight, Icon } from '../components/Icon';
import { DayStory } from '../components/DayStory';
import { featureCopy } from '../lib/features-copy';

const modeTone: Record<string, string> = { work: 'tone-orange', school: 'tone-blue', everyday: 'tone-green' };

export default function Landing() {
  const { profile, profileLoaded, t, lang } = useSession();
  if (profileLoaded && profile) return <Redirect to="/app" replace />;
  return (
    <main className="landing">
      <header className="landing-top">
        <Link href="/" className="brand wordmark" aria-label="sombra"><img src={`${import.meta.env.BASE_URL}brand/sombra-icon.svg`} alt="" /><span>sombra</span></Link>
        <Link href="/about" className="landing-about">{t.about}</Link>
      </header>

      <section className="landing-hero">
        <h1>{t.tagline}</h1>
        {/* Before anyone picks a mode, say what sombra does for everyone. */}
        <p className="landing-sub">{modeWasChosen ? t.landingSub : featureCopy[lang].landingSubAll}</p>
      </section>

      {/* A screenshot of the real planner, so people see the actual app before tapping anything. */}
      <figure className="demo">
        <img src={`${import.meta.env.BASE_URL}demo/plan-${lang}.webp`} width={390} height={560} alt={featureCopy[lang].demoAlt} loading="eager" />
        <figcaption>{featureCopy[lang].demoCaption}</figcaption>
      </figure>

      <div className="landing-actions">
        <Link href={`/app${modeQuery}`} className="btn btn-primary btn-block">{t.getStarted}</Link>
        <Link href={`/sign-in${modeQuery}`} className="btn btn-secondary btn-block">{t.signIn}</Link>
      </div>

      <section className="landing-tools" aria-labelledby="landing-tools-title">
        <h2 id="landing-tools-title">{featureCopy[lang].landingDay}</h2>
        <DayStory />
      </section>

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

      <footer className="landing-foot site-foot">
        <span>{t.free}</span>
        <nav className="foot-links" aria-label={t.about}>
          <Link href="/about">{t.about}</Link>
          <Link href="/privacy">{t.privacyLink}</Link>
          <Link href="/terms">{featureCopy[lang].termsLink}</Link>
          <Link href="/about#sources">{t.sourcesLink}</Link>
        </nav>
        <small>© {new Date().getFullYear()} sombra</small>
      </footer>
    </main>
  );
}
