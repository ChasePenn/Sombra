import { useEffect, useState } from 'react';
import { Link, useLocation } from 'wouter';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useClerk, useUser } from '@clerk/react';
import * as store from '../../public/js/store.js';
import type { SombraProfile } from '../../public/js/store.js';
import { useSession } from '../lib/session';
import { IntensityPicker, LanguagePicker, Switch } from '../components/Controls';
import { Sheet } from '../components/Sheet';
import { ModePicker } from '../components/ModePicker';
import { audienceModeId, currentMode, navigateToMode } from '../lib/copy';
import type { AudienceModeId } from '../lib/copy';

const blank: SombraProfile = { name: '', language: 'en', mode: audienceModeId, usualIntensity: 'moderate', newToHeat: false, notificationsEnabled: false };

export default function Settings() {
  const { t, lang, profile, setProfile, accountId, previewLang } = useSession();
  const { signOut } = useClerk();
  const { user } = useUser();
  const [, nav] = useLocation();
  const [draft, setDraft] = useState<SombraProfile>(profile ?? { ...blank, language: previewLang });
  const [status, setStatus] = useState('');
  const [notifMsg, setNotifMsg] = useState('');
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [delErr, setDelErr] = useState(false);

  useEffect(() => { if (profile) setDraft(profile); }, [profile]);

  const save = async (next: SombraProfile, quiet = false) => {
    setDraft(next);
    if (!next.name.trim()) { setStatus(t.nameRequired); return; }
    try {
      const saved = await store.saveProfile(next);
      setProfile(saved);
      if (!quiet) setStatus(t.saved);
    } catch {
      setStatus(t.somethingWrong);
    }
  };

  const toggleNotif = async (on: boolean) => {
    setNotifMsg('');
    if (on) {
      if (!('Notification' in window)) { setNotifMsg(t.unsupported); return; }
      const perm = Notification.permission === 'default' ? await Notification.requestPermission() : Notification.permission;
      if (perm !== 'granted') { setNotifMsg(t.blocked); return; }
    }
    save({ ...draft, notificationsEnabled: on }, true);
  };
  const selectMode = async (mode: AudienceModeId) => {
    setStatus('');
    try {
      if (profile) {
        const saved = await store.saveProfile({ ...draft, mode });
        setProfile(saved);
        setDraft(saved);
      } else {
        store.setModePreference(mode);
      }
      navigateToMode(mode);
    } catch {
      setStatus(t.somethingWrong);
    }
  };
  const test = () => {
    if (!('Notification' in window)) return setNotifMsg(t.unsupported);
    if (Notification.permission !== 'granted') return setNotifMsg(t.blocked);
    try { new Notification('Sombra', { body: t.testBody }); }
    catch { setNotifMsg(t.unsupported); }
  };

  const doDelete = async () => {
    setBusy(true); setDelErr(false);
    try {
      await store.deleteAccount();
      setConfirm(false);
      setProfile(null);
      if (accountId) await signOut({ redirectUrl: `${import.meta.env.BASE_URL}` });
      else nav('/', { replace: true });
    } catch {
      setDelErr(true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="shell" style={{ paddingBottom: 'calc(32px + var(--safe-b))' }}>
      <header className="topbar" style={{ paddingLeft: 4 }}>
        <button type="button" className="icon-btn" aria-label={t.back} onClick={() => (window.history.length > 1 ? window.history.back() : nav('/app'))}><ChevronLeft size={26} /></button>
        <h1 style={{ fontSize: '1.15rem' }}>{t.settings}</h1>
        <span style={{ width: 48 }} />
      </header>
      <main className="page" style={{ paddingTop: 4 }}>
        <h2 className="group-label">{t.profile}</h2>
        <div className="group">
          <div className="row row-stack">
            <span className="label">{currentMode(lang).welcomeQuestion ?? t.profile}</span>
            <ModePicker lang={lang} selected={draft.mode ?? audienceModeId} onSelect={selectMode} />
          </div>
          <div className="row row-stack">
            <label htmlFor="s-name">{t.name}</label>
            <input id="s-name" className="input" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} onBlur={() => draft.name.trim() && draft.name !== profile?.name && save({ ...draft, name: draft.name.trim() })} />
          </div>
          <div className="row row-stack">
            <span style={{ display: 'block', fontWeight: 700, marginBottom: 8 }}>{t.usualWork}</span>
            <IntensityPicker lang={lang} label={t.usualWork} value={draft.usualIntensity} onChange={(v) => save({ ...draft, usualIntensity: v })} />
          </div>
          <div className="row">
            <span className="row-main">{t.newToHeat}<small>{t.newToHeatHint}</small></span>
            <Switch label={t.newToHeat} checked={draft.newToHeat} onChange={(v) => save({ ...draft, newToHeat: v })} />
          </div>
        </div>
        <p role="status" aria-live="polite" className="muted" style={{ margin: '6px 4px 0', minHeight: '1.5em', fontSize: '.92rem' }}>{status}</p>

        <h2 className="group-label">{t.language}</h2>
        <div className="group"><div className="row row-stack"><LanguagePicker label={t.language} value={draft.language} onChange={(v) => save({ ...draft, language: v }, true)} /></div></div>

        <h2 className="group-label">{t.notifications}</h2>
        <div className="group">
          <div className="row">
            <span className="row-main">{t.reminders}<small>{t.remindersHint}</small></span>
            <Switch label={t.reminders} checked={draft.notificationsEnabled} onChange={toggleNotif} />
          </div>
          <button type="button" className="row" onClick={test} disabled={!draft.notificationsEnabled} style={{ opacity: draft.notificationsEnabled ? 1 : 0.55, color: 'var(--mesquite)', fontWeight: 700 }}>{t.testReminder}</button>
        </div>
        {notifMsg && <p className="notice" role="status" style={{ marginTop: 8 }}>{notifMsg}</p>}

        <h2 className="group-label">{t.account}</h2>
        <div className="group">
          {accountId ? (
            <>
              <div className="row"><span className="row-main">{t.signedInAs}<small>{user?.primaryEmailAddress?.emailAddress ?? ''}</small></span></div>
              <button type="button" className="row" onClick={() => signOut({ redirectUrl: `${import.meta.env.BASE_URL}app` })}>{t.signOut}</button>
              <button type="button" className="row danger" onClick={() => { setDelErr(false); setConfirm(true); }}>{t.deleteAccount}</button>
            </>
          ) : (
            <>
              <div className="row"><span className="row-main">{t.guestMode}<small>{t.guestHint}</small></span></div>
              <Link href="/sign-in" className="row" style={{ color: 'var(--mesquite)', fontWeight: 700 }}><span className="row-main">{t.signIn}</span><ChevronRight size={20} aria-hidden="true" /></Link>
              <Link href="/sign-up" className="row"><span className="row-main">{t.createAccount}</span><ChevronRight size={20} aria-hidden="true" /></Link>
            </>
          )}
        </div>

        <h2 className="group-label">{t.about}</h2>
        <div className="group">
          <Link href="/about" className="row"><span className="row-main">{t.aboutSombra}<small>{t.sourcesPrivacy}</small></span><ChevronRight size={20} aria-hidden="true" /></Link>
        </div>
      </main>
      {confirm && (
        <Sheet title={t.deleteTitle} onClose={() => !busy && setConfirm(false)} closeLabel={t.close}>
          <p>{t.deleteBody}</p>
          {delErr && <p className="error" role="alert">{t.somethingWrong}</p>}
          <div className="sheet-actions">
            <button type="button" className="btn btn-danger" onClick={doDelete} disabled={busy}>{busy ? t.saving : t.deleteConfirm}</button>
            <button type="button" className="btn btn-quiet" onClick={() => setConfirm(false)} disabled={busy}>{t.cancel}</button>
          </div>
        </Sheet>
      )}
    </div>
  );
}
