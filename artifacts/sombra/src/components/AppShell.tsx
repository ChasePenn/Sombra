import { Icon } from './Icon';
import { useState, type ReactNode } from 'react';
import { Link, useLocation } from 'wouter';
import * as store from '../../public/js/store.js';
import { audienceModeId, currentMode, modeUi, navigateToMode, type AudienceModeId, type Lang } from '../lib/copy';
import { useSession } from '../lib/session';
import { Sheet } from './Sheet';
import { ModePicker } from './ModePicker';
import { InstallTip } from './InstallTip';
import { featureCopy } from '../lib/features-copy';

function Glyph({ name, size = 24 }: { name: string; size?: number }) {
  return <Icon name={name} size={size} strokeWidth={name === 'check' ? 3 : 2.2} />;
}

export function TopBar({ title }: { title?: string }) {
  const { t, lang, profile, setProfile, setPreviewLang } = useSession();
  const ui = modeUi(lang);
  const [error, setError] = useState(false);
  const [modeOpen, setModeOpen] = useState(false);
  const [modeBusy, setModeBusy] = useState(false);
  const selectLanguage = async (language: Lang) => {
    setError(false);
    try {
      if (profile) setProfile(await store.saveProfile({ ...profile, language }));
      else setPreviewLang(language);
    } catch { setError(true); }
  };
  const selectMode = async (id: AudienceModeId) => {
    setModeBusy(true);
    setError(false);
    try {
      if (profile) setProfile(await store.saveProfile({ ...profile, mode: id }));
      else store.setModePreference(id);
      navigateToMode(id);
    } catch {
      setError(true);
      setModeBusy(false);
    }
  };
  return (
    <>
    <header className="topbar">
      <Link href="/app" className="brand wordmark" aria-label="Sombra">
        <img src={`${import.meta.env.BASE_URL}brand/sombra-icon.svg`} alt="" />
        <span>sombra</span>
      </Link>
      {title && <span className="vh">{title}</span>}
      <div className="topbar-actions">
        <div className="lang-switch" role="group" aria-label={t.language}>
          <button lang="en" aria-label={ui.englishLanguage} aria-pressed={lang === 'en'} onClick={() => selectLanguage('en')}>EN</button>
          <span aria-hidden="true">|</span>
          <button lang="es" aria-label={ui.spanishLanguage} aria-pressed={lang === 'es'} onClick={() => selectLanguage('es')}>ES</button>
        </div>
        <button type="button" className="mode-chip" aria-label={currentMode(lang).name} aria-haspopup="dialog" onClick={() => setModeOpen(true)}>{currentMode(lang).shortName}</button>
        <Link href="/settings" className="icon-btn" aria-label={t.settings}><Glyph name="gear" /></Link>
      </div>
    </header>
    {error && <p className="error" role="alert">{t.somethingWrong}</p>}
    {modeOpen && <Sheet title={currentMode(lang).welcomeQuestion ?? t.settings} onClose={() => !modeBusy && setModeOpen(false)} closeLabel={t.close}>
      <ModePicker lang={lang} selected={profile?.mode ?? audienceModeId} onSelect={selectMode} />
    </Sheet>}
    </>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const { t, lang } = useSession();
  const [loc] = useLocation();
  const tabs = [
    { href: '/app', label: t.today, icon: 'sun-horizon', active: loc === '/app' },
    { href: '/app/tools', label: featureCopy[lang].toolsTitle, icon: 'tools', active: ['/app/tools', '/app/best-time', '/app/cool-spots', '/app/check-on', '/app/profile', '/app/crew'].some((p) => loc.startsWith(p)) },
  ];
  return (
    <div className="app-layout">
    <aside className="app-context">
      <span className="brand wordmark">
        <img src={`${import.meta.env.BASE_URL}brand/sombra-icon.svg`} alt="" />
        <span>sombra</span>
      </span>
      <h2>{t.tagline}</h2>
      <p>{t.landingSub}</p>
      <Link href="/about">{t.aboutSombra}</Link>
    </aside>
    <div className="shell">
      <TopBar />
      <InstallTip />
      <main>{children}</main>
      <nav className="tabs" aria-label="Sombra">
        <div className="tabs-inner">
          <Link href={tabs[0].href} className="tab" aria-current={tabs[0].active ? 'page' : undefined}>
            <Glyph name={tabs[0].icon} />
            {tabs[0].label}
          </Link>
          <Link href="/app/check-in" className="checkin-tab" aria-label={t.checkIn} aria-current={loc.startsWith('/app/check-in') ? 'page' : undefined}>
            <Glyph name="check" size={32} />
          </Link>
          <Link href={tabs[1].href} className="tab" aria-current={tabs[1].active ? 'page' : undefined}>
            <Glyph name={tabs[1].icon} />
            {tabs[1].label}
          </Link>
        </div>
      </nav>
    </div>
    </div>
  );
}
