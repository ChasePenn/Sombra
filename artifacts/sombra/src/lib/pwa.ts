/** Installable-app helpers: service worker, reminders, and the iPhone install tip. */

export function registerServiceWorker() {
  // Only in production builds; in development a cached shell would hide code changes.
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch(() => {
      // The app still works without offline support.
    });
  });
}

/**
 * Show a reminder through the service worker when possible. iPhones (installed app)
 * and Android only allow notifications this way; plain `new Notification` is the fallback.
 */
export async function showReminder(body: string, tag: string) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return false;
  try {
    const registration = 'serviceWorker' in navigator ? await navigator.serviceWorker.getRegistration() : undefined;
    if (registration) {
      await registration.showNotification('sombra', { body, tag, icon: `${import.meta.env.BASE_URL}brand/sombra-icon-192.png` });
    } else {
      new Notification('sombra', { body, tag });
    }
    return true;
  } catch {
    return false;
  }
}

/** True on an iPhone/iPad browser tab (not the installed home-screen app). */
export function shouldShowIosInstallTip() {
  const ua = navigator.userAgent;
  const ios = /iphone|ipad|ipod/i.test(ua) || (ua.includes('Macintosh') && navigator.maxTouchPoints > 1);
  const standalone = window.matchMedia('(display-mode: standalone)').matches
    || (navigator as Navigator & { standalone?: boolean }).standalone === true;
  return ios && !standalone;
}
