import { useEffect, useState } from 'react';
import { useSession } from '../lib/session';
import { featureCopy } from '../lib/features-copy';
import { disablePush, enablePush, needsHomeScreen, pushAvailable, pushIsOn, pushSupported, sendTestPush, type EnableResult } from '../lib/push';
import { Switch } from './Controls';
import { Bell, BellOff } from './Icon';

/** Turn closed-app reminders on or off. "settings" is a settings row; "inline" sits on Check on someone. */
export function PushControl({ variant }: { variant: 'settings' | 'inline' }) {
  const { lang } = useSession();
  const f = featureCopy[lang];
  const [on, setOn] = useState(pushIsOn);
  const [available, setAvailable] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; error?: boolean } | null>(null);

  useEffect(() => {
    let live = true;
    void pushAvailable().then((ok) => { if (live) setAvailable(ok); });
    const sync = () => setOn(pushIsOn());
    window.addEventListener('sombra:push', sync);
    return () => { live = false; window.removeEventListener('sombra:push', sync); };
  }, []);

  const problem: Record<Exclude<EnableResult, 'on'>, string> = {
    denied: f.pushDenied, unavailable: f.pushUnavailable, unsupported: f.pushUnsupported, install: f.pushInstall, error: f.pushError,
  };

  const turnOn = async () => {
    setBusy(true);
    setMsg(null);
    const result = await enablePush(lang);
    setBusy(false);
    setOn(result === 'on');
    setMsg(result === 'on' ? { text: f.pushOnMsg } : { text: problem[result], error: result !== 'install' });
  };
  const turnOff = async () => {
    setBusy(true);
    await disablePush();
    setBusy(false);
    setOn(false);
    setMsg({ text: f.pushOffMsg });
  };
  const test = async () => {
    setMsg(null);
    const result = await sendTestPush();
    setOn(pushIsOn());
    setMsg(result === 'sent' ? { text: f.pushTestSent } : { text: result === 'gone' ? f.pushOffMsg : f.pushError, error: true });
  };

  const feedback = msg && <p className={msg.error ? 'error' : 'notice'} role={msg.error ? 'alert' : 'status'} style={{ marginTop: 8 }}>{msg.text}</p>;

  if (variant === 'inline') {
    if (on) return <p className="privacy-note"><Bell size={16} aria-hidden="true" />{f.careReminderOn}</p>;
    return (
      <>
        <p className="privacy-note"><BellOff size={16} aria-hidden="true" />{f.careReminderLimit}</p>
        {available && (pushSupported() || needsHomeScreen()) && (
          <button type="button" className="btn btn-secondary btn-block push-turn-on" onClick={turnOn} disabled={busy}>
            <Bell size={18} aria-hidden="true" />{f.careTurnOn}
          </button>
        )}
        {feedback}
      </>
    );
  }

  // Settings row. Hidden entirely if this server has no push keys yet.
  if (available === false) return null;
  return (
    <>
      <div className="row">
        <span className="row-main">{f.pushTitle}<small>{needsHomeScreen() && !on ? f.pushInstall : f.pushHint}</small></span>
        <Switch label={f.pushTitle} checked={on} onChange={(next) => { if (!busy) void (next ? turnOn() : turnOff()); }} />
      </div>
      {on && <button type="button" className="row" onClick={test} style={{ color: 'var(--mesquite)', fontWeight: 700 }}>{f.pushTest}</button>}
      <div className="row"><small className="muted">{f.pushPrivacy}</small></div>
      {feedback}
    </>
  );
}
