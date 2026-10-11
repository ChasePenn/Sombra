// sombra service worker: keeps the app shell available offline and shows reminders,
// including push reminders that arrive while the app is closed.
// API calls (/api/...) are never cached, so heat data and check-ins are always live.
const CACHE = 'sombra-v2';
const SHELL = ['/', '/app', '/planner.html', '/manifest.webmanifest', '/brand/sombra-icon.svg', '/favicon-32.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)).catch(() => undefined));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;

  // Pages: try the network first so updates show up, fall back to the cached shell offline.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(request, copy));
          return response;
        })
        .catch(() => caches.match(request).then((hit) => hit || caches.match('/app') || caches.match('/'))),
    );
    return;
  }

  // Built files have content hashes in their names, so a cached copy never goes stale.
  event.respondWith(
    caches.match(request).then((hit) => hit || fetch(request).then((response) => {
      if (response.ok) {
        const copy = response.clone();
        caches.open(CACHE).then((cache) => cache.put(request, copy));
      }
      return response;
    })),
  );
});

// --- Push reminders (arrive while sombra is closed) ---------------------------------------
// The server sends only a type and a random key. Names live on this phone, in the small
// database the app keeps for the service worker, and are filled in here.

const TEXT = {
  en: {
    careFirst: (n) => (n ? `Time to check on ${n}` : 'Time to check on someone'),
    careFirstBody: 'A quick call or visit helps on hot days.',
    careOverdue: (n) => (n ? `${n} still hasn't been checked` : 'Someone still needs a check'),
    careOverdueBody: "It's been 2 hours. Call or visit now.",
    careAfternoon: (n) => (n ? `Check on ${n} again` : 'Time for a second check'),
    careAfternoonBody: "There's a heat warning today. A second check this afternoon helps.",
    window: (a) => (a ? `Good time for ${a}` : 'Your safer window starts now'),
    windowBody: (h) => (h ? `This is the safest ${h}-hour window sombra found.` : 'This is the safest window sombra found.'),
    heatBody: 'From the National Weather Service. Plan for shade and water, and check on people at risk.',
    test: 'Notifications are working',
    testBody: 'sombra can remind you even when it is closed.',
  },
  es: {
    careFirst: (n) => (n ? `Hora de revisar a ${n}` : 'Hora de revisar a alguien'),
    careFirstBody: 'Una llamada o visita rápida ayuda en los días de calor.',
    careOverdue: (n) => (n ? `Aún no se ha revisado a ${n}` : 'Alguien aún necesita una revisión'),
    careOverdueBody: 'Ya pasaron 2 horas. Llama o visita ahora.',
    careAfternoon: (n) => (n ? `Revisa otra vez a ${n}` : 'Hora de una segunda revisión'),
    careAfternoonBody: 'Hoy hay alerta de calor. Una segunda revisión por la tarde ayuda.',
    window: (a) => (a ? `Buen momento para: ${a}` : 'Tu horario más seguro empieza ahora'),
    windowBody: (h) => (h ? `Es el horario de ${h} horas más seguro que encontró sombra.` : 'Es el horario más seguro que encontró sombra.'),
    heatBody: 'Del Servicio Meteorológico Nacional. Planea sombra y agua, y revisa a quienes están en riesgo.',
    test: 'Las notificaciones funcionan',
    testBody: 'sombra puede recordarte aunque esté cerrado.',
  },
};

function readLabels() {
  return new Promise((resolve) => {
    try {
      const open = indexedDB.open('sombra-sw', 1);
      open.onupgradeneeded = () => open.result.createObjectStore('kv');
      open.onsuccess = () => {
        const request = open.result.transaction('kv').objectStore('kv').get('labels');
        request.onsuccess = () => { open.result.close(); resolve(request.result || null); };
        request.onerror = () => { open.result.close(); resolve(null); };
      };
      open.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

/** Turns a push message into the notification people see. Exposed for tests. */
function renderPush(data, labels) {
  const lang = (labels && labels.lang) || data.lang || 'en';
  const t = TEXT[lang] || TEXT.en;
  if (data.type === 'care') {
    const name = labels && labels.contacts ? labels.contacts[data.key] : undefined;
    const stage = data.stage === 'overdue' ? ['careOverdue', 'careOverdueBody'] : data.stage === 'afternoon' ? ['careAfternoon', 'careAfternoonBody'] : ['careFirst', 'careFirstBody'];
    return { title: t[stage[0]](name), body: t[stage[1]], url: '/app/check-on', tag: `care-${data.key}` };
  }
  if (data.type === 'window') {
    const w = labels && labels.windows ? labels.windows[data.key] : undefined;
    return { title: t.window(w && w.activity), body: t.windowBody(w && w.hours), url: '/app/best-time', tag: `window-${data.key}` };
  }
  if (data.type === 'heat') {
    return { title: data.event || 'Heat warning', body: t.heatBody, url: '/app/cool-spots', tag: 'heat' };
  }
  return { title: t.test, body: t.testBody, url: '/settings', tag: 'test' };
}
self.renderPush = renderPush;

self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = {}; }
  event.waitUntil(readLabels().then((labels) => {
    const n = renderPush(data, labels);
    return self.registration.showNotification(n.title, {
      body: n.body,
      tag: n.tag,
      renotify: true,
      icon: '/brand/sombra-icon-192.png',
      badge: '/favicon-32.png',
      data: { url: n.url },
    });
  }));
});

// Tapping a notification opens (or focuses) the screen it's about.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/app/check-in';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      const open = clients.find((client) => 'focus' in client);
      if (open) return open.navigate(url).then((client) => client && client.focus());
      return self.clients.openWindow(url);
    }),
  );
});
