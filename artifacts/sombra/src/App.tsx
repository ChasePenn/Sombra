import { ClerkProvider } from '@clerk/react';
import { publishableKeyFromHost } from '@clerk/react/internal';
import { Link, Redirect, Route, Switch, useLocation, Router as WouterRouter } from 'wouter';
import { SessionProvider, basePath, useSession } from './lib/session';
import Landing from './pages/Landing';
import Plan from './pages/Plan';
import CheckIn from './pages/CheckIn';
import Crew from './pages/Crew';
import Settings from './pages/Settings';
import About from './pages/About';
import { Privacy, Terms } from './pages/Legal';
import { legalUi } from './lib/legal-copy';
import BestTime from './pages/BestTime';
import CoolSpots from './pages/CoolSpots';
import CareCheck from './pages/CareCheck';
import HeatProfile from './pages/HeatProfile';
import { SignInPage, SignUpPage } from './pages/Auth';
import { useEffect } from 'react';
import { aboutCopy, audienceModeId, currentMode, modeQuery } from './lib/copy';
import { featureCopy } from './lib/features-copy';
import { noteScreenChange } from './lib/nav';
import { ImportOffer } from './components/ImportOffer';
import { ReminderHost } from './components/ReminderHost';
import { CareReminderHost } from './components/CareReminderHost';
import { PushHost } from './components/PushHost';

const clerkPubKey = publishableKeyFromHost(window.location.hostname, import.meta.env.VITE_CLERK_PUBLISHABLE_KEY);
const clerkProxyUrl = import.meta.env.VITE_CLERK_PROXY_URL;

function stripBase(path: string) {
  return basePath && path.startsWith(basePath) ? path.slice(basePath.length) || '/' : path;
}

const ink = '#2A1206';
const appearance = {
  variables: {
    colorPrimary: 'var(--mesquite)',
    colorForeground: ink,
    colorMutedForeground: 'var(--ink-soft)',
    colorDanger: 'var(--r-veryhigh)',
    colorBackground: '#FFFFFF',
    colorInput: '#FFFFFF',
    colorInputForeground: ink,
    colorNeutral: ink,
    fontFamily: "'Atkinson Hyperlegible', system-ui, sans-serif",
    fontFamilyButtons: "'Rubik', system-ui, sans-serif",
    borderRadius: '4px',
    fontSize: '16px',
  },
  elements: {
    rootBox: { width: '100%' },
    cardBox: { width: '100%', maxWidth: '100%', background: 'var(--card)', border: '1px solid var(--line)', borderRadius: '6px', boxShadow: 'none' },
    card: { boxShadow: 'none', border: 0, background: 'transparent' },
    footer: { background: 'transparent', boxShadow: 'none' },
    header: { display: 'none' },
    headerTitle: { color: ink, fontFamily: "'Rubik', sans-serif" },
    headerSubtitle: { color: '#7A5B4B' },
    socialButtonsBlockButton: { minHeight: '48px', border: '1.5px solid #7A5B4B' },
    socialButtonsBlockButtonText: { color: ink, fontWeight: 700 },
    formFieldLabel: { color: ink, fontWeight: 700 },
    formFieldInput: { minHeight: '48px', border: '1.5px solid #7A5B4B' },
    formButtonPrimary: { minHeight: '50px', background: 'var(--mesquite)', fontSize: '16px', textTransform: 'none', boxShadow: 'none' },
    footerActionText: { color: '#7A5B4B' },
    footerActionLink: { color: 'var(--mesquite)', fontWeight: 700 },
    dividerText: { color: '#7A5B4B' },
    dividerLine: { background: 'var(--line)' },
    identityPreviewEditButton: { color: 'var(--mesquite)' },
    formFieldSuccessText: { color: 'var(--mesquite)' },
    alertText: { color: 'var(--r-veryhigh)' },
    otpCodeFieldInput: { border: '1.5px solid #7A5B4B' },
  },
};

function NotFound() {
  const { t } = useSession();
  return (
    <main className="landing not-found">
      <header className="landing-top">
        <Link href="/" className="brand wordmark" aria-label="sombra">
          <img src={`${import.meta.env.BASE_URL}brand/sombra-icon.svg`} alt="" />
          <span>sombra</span>
        </Link>
      </header>
      <div className="landing-hero">
        <p className="not-found-code" aria-hidden="true">404</p>
        <h1>{t.notFoundTitle}</h1>
        <p className="landing-sub">{t.notFoundBody}</p>
      </div>
      <div className="landing-actions">
        <Link href="/app" className="btn btn-primary btn-block">{t.openSombra}</Link>
        <Link href="/about" className="btn btn-secondary btn-block">{t.about}</Link>
      </div>
    </main>
  );
}

/** Gives every screen its own browser tab title. */
function usePageTitle(location: string) {
  const { t, lang } = useSession();
  useEffect(() => {
    const f = featureCopy[lang];
    const titles: Record<string, string> = {
      '/app': t.today,
      '/app/check-in': t.checkIn,
      '/app/crew': currentMode(lang).group,
      '/app/best-time': f.bestTitle,
      '/app/cool-spots': f.coolTitle,
      '/app/check-on': f.careTitle,
      '/app/profile': f.profileTitle,
      '/settings': t.settings,
      '/about': aboutCopy[lang].title,
      '/privacy': legalUi[lang].privacy,
      '/terms': legalUi[lang].terms,
    };
    const path = location.replace(/\/+$/, '') || '/';
    let name = titles[path];
    if (path.startsWith('/sign-in')) name = t.signIn;
    if (path.startsWith('/sign-up')) name = t.createAccount;
    if (path === '/') document.title = `sombra · ${t.tagline}`;
    else document.title = `${name ?? t.notFoundTitle} · sombra`;
  }, [location, lang, t]);
}

function Routes() {
  const [location] = useLocation();
  const { profile, profileLoaded } = useSession();
  usePageTitle(location);
  useEffect(() => { noteScreenChange(); }, [location]);
  useEffect(() => {
    const url = new URL(window.location.href);
    if (profileLoaded && profile?.mode && profile.mode !== audienceModeId) {
      url.searchParams.set('mode', profile.mode);
      window.location.replace(url.toString());
      return;
    }
    if (audienceModeId !== 'work' && url.searchParams.get('mode') !== audienceModeId) {
      url.searchParams.set('mode', audienceModeId);
      window.history.replaceState(window.history.state, '', url);
    }
  }, [location, profile?.mode, profileLoaded]);
  return (
    <Switch>
      <Route path="/" component={Landing} />
      <Route path="/app" component={Plan} />
      <Route path="/app/check-in" component={CheckIn} />
      <Route path="/app/crew" component={Crew} />
      <Route path="/app/tools"><Redirect to="/app" replace /></Route>
      <Route path="/app/best-time" component={BestTime} />
      <Route path="/app/cool-spots" component={CoolSpots} />
      <Route path="/app/check-on" component={CareCheck} />
      <Route path="/app/profile" component={HeatProfile} />
      <Route path="/settings" component={Settings} />
      <Route path="/about" component={About} />
      <Route path="/privacy" component={Privacy} />
      <Route path="/terms" component={Terms} />
      <Route path="/sign-in/*?" component={SignInPage} />
      <Route path="/sign-up/*?" component={SignUpPage} />
      <Route component={NotFound} />
    </Switch>
  );
}

function ClerkWithRoutes() {
  const [, setLocation] = useLocation();
  return (
    <ClerkProvider
      publishableKey={clerkPubKey}
      proxyUrl={clerkProxyUrl}
      appearance={appearance}
      signInUrl={`${basePath}/sign-in${modeQuery}`}
      signUpUrl={`${basePath}/sign-up${modeQuery}`}
      signInFallbackRedirectUrl={`${basePath}/app${modeQuery}`}
      signUpFallbackRedirectUrl={`${basePath}/app${modeQuery}`}
      afterSignOutUrl={`${basePath}/app${modeQuery}`}
      routerPush={(to) => setLocation(stripBase(to))}
      routerReplace={(to) => setLocation(stripBase(to), { replace: true })}
    >
      <SessionProvider>
        <Routes />
        <ImportOffer />
        <ReminderHost />
        <CareReminderHost />
        <PushHost />
      </SessionProvider>
    </ClerkProvider>
  );
}

function App() {
  return (
    <WouterRouter base={basePath}>
      <ClerkWithRoutes />
    </WouterRouter>
  );
}

export default App;
