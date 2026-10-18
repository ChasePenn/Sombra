import { Link, Redirect } from 'wouter';
import { useSession } from '../lib/session';
import { availableModes, modeQuery } from '../lib/copy';
import { Check, ChevronRight, Drop, Icon, Snowflake, Umbrella } from '../components/Icon';
import { DayStory } from '../components/DayStory';
import { featureCopy } from '../lib/features-copy';

const modeTone: Record<string, string> = { work: 'tone-orange', school: 'tone-blue', everyday: 'tone-green' };

/** Colors the last two words of the headline ("Phoenix heat."), the one bit of color in the hero. */
function headline(text: string) {
  const words = text.split(' ');
  if (words.length < 4) return text;
  return <>{words.slice(0, -2).join(' ')} <em>{words.slice(-2).join(' ')}</em></>;
}

/** The sun's path across a day, colored by heat, over the four things sombra helps with. */
function HeroGraphic({ labels, alt }: { labels: string[]; alt: string }) {
  const icons = [Drop, Umbrella, Snowflake, Check];
  return (
    <div className="hero-graphic" role="img" aria-label={alt}>
      <svg viewBox="0 -14 320 210" aria-hidden="true">
        <g className="sun-path">
          <path className="arc-low" d="M32.1 163.2A128 128 0 0 1 40.0 123.5" />
          <path className="arc-caution" d="M43.7 114.6A128 128 0 0 1 66.1 81.0" />
          <path className="arc-elevated" d="M73.0 74.1A128 128 0 0 1 106.6 51.7" />
          <path className="arc-high" d="M115.5 48.0A128 128 0 0 1 155.2 40.1" />
          <path className="arc-veryhigh" d="M164.8 40.1A128 128 0 0 1 204.5 48.0" />
          <path className="arc-extreme" d="M213.4 51.7A128 128 0 0 1 247.0 74.1" />
          <path className="arc-veryhigh" d="M253.9 81.0A128 128 0 0 1 276.3 114.6" />
          <path className="arc-high" d="M280.0 123.5A128 128 0 0 1 287.9 163.2" />
        </g>
        <path className="sun-rays" d="M267.8 37.3L274.8 37.3M262.2 50.7L267.2 55.7M248.8 56.3L248.8 63.3M235.4 50.7L230.4 55.7M229.8 37.3L222.8 37.3M235.4 23.9L230.4 18.9M248.8 18.3L248.8 11.3M262.2 23.9L267.2 18.9" />
        <circle className="sun" cx="248.8" cy="37.3" r="13" />
        <line className="ground" x1="12" y1="168" x2="308" y2="168" />
        <text className="tick" x="32.0" y="190" textAnchor="middle">6 AM</text>
        <text className="tick" x="288.0" y="190" textAnchor="middle">8 PM</text>
      </svg>
      <ul className="hero-jobs" aria-hidden="true">
        {labels.map((label, i) => {
          const Glyph = icons[i];
          return <li key={label}><span className="badge badge-ink"><Glyph size={20} strokeWidth={2.4} /></span>{label}</li>;
        })}
      </ul>
    </div>
  );
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

      <HeroGraphic labels={f.heroJobs} alt={f.heroAlt} />

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
