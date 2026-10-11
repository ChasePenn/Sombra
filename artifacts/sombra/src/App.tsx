import { ClerkProvider } from '@clerk/react';
import { publishableKeyFromHost } from '@clerk/react/internal';
import { Link, Route, Switch, useLocation, Router as WouterRouter } from 'wouter';
import { SessionProvider, basePath, useSession } from './lib/session';
import Landing from './pages/Landing';
import Plan from './pages/Plan';
import CheckIn from './pages/CheckIn';
import Crew from './pages/Crew';
import Settings from './pages/Settings';
import About from './pages/About';
import Tools from './pages/Tools';
import BestTime from './pages/BestTime';
import CoolSpots from './pages/CoolSpots';
import CareCheck from './pages/CareCheck';
import HeatProfile from './pages/HeatProfile';
import { SignInPage, SignUpPage } from './pages/Auth';
import { useEffect } from 'react';
import { audienceModeId, modeQuery } from './lib/copy';
import { ImportOffer } from './components/ImportOffer';
import { ReminderHost } from './components/ReminderHost';
import { CareReminderHost } from './components/CareReminderHost';

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
    borderRadius: '12px',
    fontSize: '16px',
  },
  elements: {
    rootBox: { width: '100%' },
    cardBox: { width: '100%', maxWidth: '100%', background: 'var(--card)', border: '1px solid var(--line)', borderRadius: '16px', boxShadow: 'none' },
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
    <main className="landing">
      <span className="brand wordmark">
        <img src={`${import.meta.env.BASE_URL}brand/sombra-icon.svg`} alt="" />
        <span>sombra</span>
      </span>
      <div className="landing-hero">
        <h1>{t.notFoundTitle}</h1>
        <p className="landing-sub">{t.notFoundBody}</p>
        <div className="landing-actions"><Link href="/app" className="btn btn-primary">{t.openSombra}</Link></div>
      </div>
    </main>
  );
}

function Routes() {
  const [location] = useLocation();
  const { profile, profileLoaded } = useSession();
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
      <Route path="/app/tools" component={Tools} />
      <Route path="/app/best-time" component={BestTime} />
      <Route path="/app/cool-spots" component={CoolSpots} />
      <Route path="/app/check-on" component={CareCheck} />
      <Route path="/app/profile" component={HeatProfile} />
      <Route path="/settings" component={Settings} />
      <Route path="/about" component={About} />
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
