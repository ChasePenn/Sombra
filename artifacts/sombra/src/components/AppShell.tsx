import { ChevronDown, Icon } from './Icon';
import { useState, type ReactNode } from 'react';
import { Link, useLocation } from 'wouter';
import * as store from '../../public/js/store.js';
import { audienceModeId, availableModes, currentMode, modeUi, navigateToMode, type AudienceModeId, type Lang } from '../lib/copy';
import { useSession } from '../lib/session';
import { Sheet } from './Sheet';
import { ModePicker } from './ModePicker';
import { InstallTip } from './InstallTip';
import { featureCopy } from '../lib/features-copy';
import { HeatBanner } from './HeatBanner';

function Glyph({ name, size = 24 }: { name: string; size?: number }) {
  return <Icon name={name} size={size} strokeWidth={name === 'check' ? 3 : 2.2} />;
}

// Saves the chosen mode and reloads into it.
export function useSelectMode() {
  const { profile, setProfile } = useSession();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const select = async (id: AudienceModeId) => {
    if (id === (profile?.mode ?? audienceModeId)) return;
    setBusy(true);
    setFailed(false);
    try {
      if (profile) setProfile(await store.saveProfile({ ...profile, mode: id }));
      else store.setModePreference(id);
      navigateToMode(id);
    } catch {
      setFailed(true);
      setBusy(false);
    }
  };
  return { select, busy, failed };
}

export function TopBar({ title }: { title?: string }) {
  const { t, lang, profile, setProfile, setPreviewLang } = useSession();
  const ui = modeUi(lang);
  const f = featureCopy[lang];
  const [error, setError] = useState(false);
  const [modeOpen, setModeOpen] = useState(false);
  const { select: selectMode, busy: modeBusy, failed: modeFailed } = useSelectMode();
  const selectLanguage = async (language: Lang) => {
    setError(false);
    try {
      if (profile) setProfile(await store.saveProfile({ ...profile, language }));
      else setPreviewLang(language);
    } catch { setError(true); }
  };
  const mode = availableModes(lang).find((m) => m.id === (profile?.mode ?? audienceModeId));
  return (
    <>
    <header className="topbar">
      <Link href="/app" className="brand wordmark" aria-label="sombra">
        <img src={`${import.meta.env.BASE_URL}brand/sombra-icon.svg`} alt="" />
        <span>sombra</span>
      </Link>
      {title && <span className="vh">{title}</span>}
      <div className="topbar-actions">
        {/* One tap to switch: the button names the other language in that language. */}
        {lang === 'en' ? (
          <button type="button" className="lang-toggle" lang="es" aria-label={ui.spanishLanguage} onClick={() => selectLanguage('es')}>Español</button>
        ) : (
          <button type="button" className="lang-toggle" lang="en" aria-label={ui.englishLanguage} onClick={() => selectLanguage('en')}>English</button>
        )}
        <button type="button" className="mode-chip" aria-label={`${currentMode(lang).name}. ${f.modeChipHint}`} aria-haspopup="dialog" onClick={() => setModeOpen(true)}>
          {mode && <Icon name={mode.icon} size={16} />}
          <span>{currentMode(lang).shortName}</span>
          <ChevronDown size={15} strokeWidth={2.6} aria-hidden="true" />
        </button>
      </div>
    </header>
    {(error || modeFailed) && <p className="error" role="alert">{t.somethingWrong}</p>}
    {modeOpen && <Sheet title={currentMode(lang).welcomeQuestion ?? t.settings} onClose={() => !modeBusy && setModeOpen(false)} closeLabel={t.close}>
      <ModePicker lang={lang} selected={profile?.mode ?? audienceModeId} onSelect={selectMode} />
    </Sheet>}
    </>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const { t, lang } = useSession();
  const f = featureCopy[lang];
  const [loc] = useLocation();
  const on = (...paths: string[]) => paths.some((p) => loc === p || loc.startsWith(`${p}/`));
  // Four places plus the check-in button, in the order of a day: plan, go out, others, you.
  const tab = (href: string, label: string, icon: string, active: boolean) => (
    <Link href={href} className="tab" aria-current={active ? 'page' : undefined}>
      <Glyph name={icon} />
      {label}
    </Link>
  );
  // Today and Check on someone already show the heat warning in their own words.
  const banner = !on('/app/check-on') && loc !== '/app';
  return (
    <div className="app-layout">
    <aside className="app-context">
      <Link href="/app" className="brand wordmark" aria-label="sombra">
        <img src={`${import.meta.env.BASE_URL}brand/sombra-icon.svg`} alt="" />
        <span>sombra</span>
      </Link>
      <h2>{t.tagline}</h2>
      <p>{t.landingSub}</p>
      <Link href="/about">{t.aboutSombra}</Link>
    </aside>
    <div className="shell">
      <TopBar />
      <InstallTip />
      {banner && <HeatBanner />}
      <main>{children}</main>
      <nav className="tabs" aria-label="sombra">
        <div className="tabs-inner">
          {tab('/app', t.today, 'sun-horizon', loc === '/app' || on('/app/best-time'))}
          {tab('/app/cool-spots', f.tabMap, 'map', on('/app/cool-spots'))}
          <Link href="/app/check-in" className="checkin-tab" aria-label={t.checkIn} aria-current={on('/app/check-in') ? 'page' : undefined}>
            <Glyph name="check" size={32} />
          </Link>
          {tab('/app/check-on', f.tabPeople, 'users-three', on('/app/check-on', '/app/crew'))}
          {tab('/app/profile', f.tabYou, 'you', on('/app/profile', '/settings'))}
        </div>
      </nav>
    </div>
    </div>
  );
}
