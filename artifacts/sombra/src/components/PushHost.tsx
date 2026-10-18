import { useEffect } from 'react';
import { useSession } from '../lib/session';
import { getPushState, syncPush } from '../lib/push';

// Mounted once.
export function PushHost() {
  const { lang } = useSession();
  useEffect(() => {
    let timer: number | undefined;
    const schedule = () => {
      if (!getPushState()) return;
      window.clearTimeout(timer);
      timer = window.setTimeout(() => { void syncPush(lang); }, 1200);
    };
    schedule();
    window.addEventListener('sombra:local', schedule);
    window.addEventListener('focus', schedule);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('sombra:local', schedule);
      window.removeEventListener('focus', schedule);
    };
  }, [lang]);
  return null;
}
