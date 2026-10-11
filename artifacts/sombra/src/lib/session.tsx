import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { useAuth } from '@clerk/react';
import * as store from '../../public/js/store.js';
import type { SombraProfile } from '../../public/js/store.js';
import { copy, type Lang } from './copy';

type Session = {
  accountId: string | null;
  authLoaded: boolean;
  profile: SombraProfile | null;
  profileLoaded: boolean;
  profileError: boolean;
  lang: Lang;
  t: (typeof copy)['en'];
  reloadProfile: () => void;
  setProfile: (p: SombraProfile | null) => void;
  previewLang: Lang;
  setPreviewLang: (l: Lang) => void;
};

const Ctx = createContext<Session | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const { isLoaded, isSignedIn, userId } = useAuth();
  const accountId = isLoaded && isSignedIn ? userId ?? null : null;
  const [profile, setProfile] = useState<SombraProfile | null>(null);
  const [profileLoaded, setProfileLoaded] = useState(false);
  const [profileError, setProfileError] = useState(false);
  const [storageAccountId, setStorageAccountId] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  const [previewLang, setPreviewLang] = useState<Lang>(() =>
    typeof navigator !== 'undefined' && navigator.language?.startsWith('es') ? 'es' : 'en',
  );

  useEffect(() => {
    let live = true;
    store.setAccountSession(accountId);
    setStorageAccountId(accountId);
    setProfile(null);
    setProfileLoaded(false);
    setProfileError(false);
    store
      .getProfile()
      .then((p) => {
        if (!live) return;
        setProfile(p);
        setProfileLoaded(true);
      })
      .catch(() => {
        if (!live) return;
        setProfileError(true);
        setProfileLoaded(true);
      });
    return () => {
      live = false;
    };
  }, [accountId, nonce]);

  const reloadProfile = useCallback(() => setNonce((n) => n + 1), []);
  const lang: Lang = profile?.language ?? previewLang;

  useEffect(() => {
    if (
      storageAccountId !== accountId ||
      !profile?.notificationsEnabled ||
      !('Notification' in window) ||
      Notification.permission !== 'granted'
    ) return;
    let timer: number;
    let stopped = false;
    const schedule = () => {
      const hourMs = 60 * 60 * 1000;
      timer = window.setTimeout(() => {
        if (stopped) return;
        try {
          if (Notification.permission === 'granted') {
            new Notification('Sombra', { body: copy[lang].reminderBody, tag: 'sombra-hourly-check-in' });
          }
        } catch {
          // Some mobile browsers require installed-app push notifications.
          // The Settings test reports this limitation to the user.
        }
        schedule();
      }, hourMs - (Date.now() % hourMs));
    };
    schedule();
    return () => { stopped = true; window.clearTimeout(timer); };
  }, [accountId, storageAccountId, profile?.notificationsEnabled, lang]);

  // Unmount account screens during a storage-mode change so their effects
  // cannot fetch through the previous account or retain its visible data.
  if (storageAccountId !== accountId) {
    return <main className="shell" aria-busy="true"><p className="page">sombra</p></main>;
  }

  return (
    <Ctx.Provider
      value={{
        accountId,
        authLoaded: isLoaded,
        profile,
        profileLoaded,
        profileError,
        lang,
        t: copy[lang],
        reloadProfile,
        setProfile,
        previewLang,
        setPreviewLang,
      }}
    >
      {children}
    </Ctx.Provider>
  );
}

export function useSession() {
  const v = useContext(Ctx);
  if (!v) throw new Error('useSession outside provider');
  return v;
}

export const basePath = import.meta.env.BASE_URL.replace(/\/$/, '');
