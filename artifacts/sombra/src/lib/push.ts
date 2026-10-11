/*
  Reminders that arrive while sombra is closed (Web Push).

  The server only learns a push address, reminder times and random keys. Names stay on this
  phone: they're copied into a small on-device database that the service worker reads when it
  shows a notification, so "Time to check on Grandma Rosa" is assembled on the phone itself.
*/
import { getCareContacts, getLastPlace, getWindowReminders } from './local';
import { shouldShowIosInstallTip } from './pwa';

const STATE_KEY = 'sombra.push';
type PushState = { id: string; token: string };
export type EnableResult = 'on' | 'denied' | 'unavailable' | 'unsupported' | 'install' | 'error';

export function pushSupported() {
  return typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

/** iPhones only allow push for sombra once it's opened from the Home Screen. */
export function needsHomeScreen() {
  return shouldShowIosInstallTip();
}

export function getPushState(): PushState | null {
  try {
    const raw = window.localStorage.getItem(STATE_KEY);
    const value = raw ? (JSON.parse(raw) as PushState) : null;
    return value?.id && value?.token ? value : null;
  } catch {
    return null;
  }
}

function setPushState(state: PushState | null) {
  try {
    if (state) window.localStorage.setItem(STATE_KEY, JSON.stringify(state));
    else window.localStorage.removeItem(STATE_KEY);
  } catch { /* push still works this session; it just won't be remembered */ }
  window.dispatchEvent(new CustomEvent('sombra:push'));
}

export const pushIsOn = () => Boolean(getPushState()) && pushSupported() && Notification.permission === 'granted';

/** Keys made on the phone, safe to send: letters, digits, dashes and underscores only. */
const safeKey = (value: string) => value.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 64);

function base64UrlToBytes(value: string) {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (value.length % 4)) % 4);
  const raw = atob(padded);
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

async function serverKey(): Promise<string | null> {
  try {
    const res = await fetch('/api/push/key', { headers: { Accept: 'application/json' } });
    if (!res.ok) return null;
    return ((await res.json()) as { publicKey?: string }).publicKey ?? null;
  } catch {
    return null;
  }
}

/** Whether this server has push turned on at all (keys configured). */
export async function pushAvailable() {
  return Boolean(await serverKey());
}

async function registration() {
  const existing = await navigator.serviceWorker.getRegistration();
  if (existing) return navigator.serviceWorker.ready;
  // Normally registered at startup in production; register now if it isn't yet.
  await navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`);
  return navigator.serviceWorker.ready;
}

/** Must be called from a tap (browsers only show the permission prompt after one). */
export async function enablePush(lang: string): Promise<EnableResult> {
  if (needsHomeScreen()) return 'install';
  if (!pushSupported()) return 'unsupported';
  const key = await serverKey();
  if (!key) return 'unavailable';
  const permission = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission();
  if (permission !== 'granted') return 'denied';
  try {
    const reg = await registration();
    const subscription = (await reg.pushManager.getSubscription())
      ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: base64UrlToBytes(key) }));
    const res = await fetch('/api/push/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ subscription: subscription.toJSON(), language: lang }),
    });
    if (!res.ok) return res.status === 503 ? 'unavailable' : 'error';
    setPushState((await res.json()) as PushState);
    await syncPush(lang);
    return 'on';
  } catch {
    return 'error';
  }
}

export async function disablePush() {
  const state = getPushState();
  setPushState(null);
  try {
    if (state) {
      await fetch('/api/push/subscribe', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(state) });
    }
    const sub = await (await navigator.serviceWorker.getRegistration())?.pushManager.getSubscription();
    await sub?.unsubscribe();
  } catch { /* the server forgets unused phones on its own */ }
}

/** Asks the server to send a real push right now. */
export async function sendTestPush(): Promise<'sent' | 'gone' | 'error'> {
  const state = getPushState();
  if (!state) return 'gone';
  try {
    const res = await fetch('/api/push/test', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(state) });
    if (res.status === 404) { setPushState(null); return 'gone'; }
    return res.ok ? 'sent' : 'error';
  } catch {
    return 'error';
  }
}

/** What the server needs: times and random keys, never names. */
export function buildSchedule(lang: string) {
  const place = getLastPlace();
  const care = getCareContacts().map((c) => ({ kind: 'care' as const, key: safeKey(c.id), time: c.time, doneAt: c.lastChecked ?? undefined }));
  const windows = getWindowReminders().map((w) => ({ kind: 'window' as const, key: safeKey(w.id), at: `${w.date}T${w.start}:00-07:00` }));
  return {
    language: lang === 'es' ? 'es' : 'en',
    lat: place ? Math.round(place.lat * 100) / 100 : null,
    lon: place ? Math.round(place.lon * 100) / 100 : null,
    reminders: [...care, ...windows],
  };
}

/** The names and activities the service worker shows, kept in an on-device database. */
async function saveLabels(lang: string) {
  const labels = {
    lang: lang === 'es' ? 'es' : 'en',
    contacts: Object.fromEntries(getCareContacts().map((c) => [safeKey(c.id), c.name])),
    windows: Object.fromEntries(getWindowReminders().map((w) => [safeKey(w.id), { activity: w.activity, hours: w.hours }])),
  };
  await new Promise<void>((resolve) => {
    try {
      const open = indexedDB.open('sombra-sw', 1);
      open.onupgradeneeded = () => open.result.createObjectStore('kv');
      open.onsuccess = () => {
        const tx = open.result.transaction('kv', 'readwrite');
        tx.objectStore('kv').put(labels, 'labels');
        tx.oncomplete = () => { open.result.close(); resolve(); };
        tx.onerror = () => { open.result.close(); resolve(); };
      };
      open.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
}

/** Sends the current schedule. Called whenever contacts, Best time reminders or the language change. */
export async function syncPush(lang: string) {
  const state = getPushState();
  if (!state) return 'off';
  await saveLabels(lang);
  try {
    const res = await fetch('/api/push/schedule', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...state, ...buildSchedule(lang) }),
    });
    if (res.status === 404 || res.status === 403) { setPushState(null); return 'gone'; }
    return res.ok ? 'ok' : 'error';
  } catch {
    return 'error';
  }
}
