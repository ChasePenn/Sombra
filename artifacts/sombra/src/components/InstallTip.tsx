import { useState } from 'react';
import { Share, X } from 'lucide-react';
import { useSession } from '../lib/session';
import { shouldShowIosInstallTip } from '../lib/pwa';

const KEY = 'sombra.install-tip-dismissed';

function dismissedBefore() {
  try { return window.localStorage.getItem(KEY) === 'true'; } catch { return false; }
}

/** One-time tip: iPhones only allow reminders after sombra is added to the home screen. */
export function InstallTip() {
  const { t } = useSession();
  const [open, setOpen] = useState(() => shouldShowIosInstallTip() && !dismissedBefore());
  if (!open) return null;
  const close = () => {
    try { window.localStorage.setItem(KEY, 'true'); } catch { /* the tip just shows again next time */ }
    setOpen(false);
  };
  return (
    <aside className="install-tip" role="note">
      <span className="install-tip-icon" aria-hidden="true"><Share size={20} /></span>
      <div>
        <strong>{t.installTitle}</strong>
        <p>{t.installBody}</p>
      </div>
      <button type="button" className="icon-btn" aria-label={t.dismiss} onClick={close}><X size={20} /></button>
    </aside>
  );
}
