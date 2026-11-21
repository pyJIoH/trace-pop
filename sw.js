/* Trace Pop — service worker. It keeps a copy of the app on the device, so that after the first
   launch everything works with no network (airplane mode), and so that a new version is never
   held back by the browser's own cache.

   - The app's own files: the network first (always fresh when online), the saved copy when offline.
   - The voice clips: all of them are saved when the worker is installed, into a cache of their own
     that outlives app versions, and are then served from it at once.

   Raise VERSION with every change to the app's files: that is how an open app learns there is a
   new version (it then reloads itself, but only while the home screen is showing). */
const VERSION = 'tracepop-v5';
const AUDIO = 'tracepop-audio';

const SHELL = [
  './',
  'index.html',
  'css/styles.css',
  'js/util.js',
  'js/glyphs.js',
  'js/tracer.js',
  'js/speech.js',
  'js/sounds.js',
  'js/trace-view.js',
  'js/app.js',
  'manifest.webmanifest',
  'icons/icon.svg',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-512.png',
  'icons/apple-touch-icon.png',
];

// The list of phrases comes from the app's own file, so there is no second list to keep in step.
self.window = self;
importScripts('js/speech.js');
const CLIPS = Object.keys(self.TP.speech.SAY).map((key) => self.TP.speech.url(key));

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const shell = await caches.open(VERSION);
    await shell.addAll(SHELL.map((url) => new Request(url, { cache: 'reload' })));
    // Every clip is asked for again with each new version ("has it changed?" is a cheap question),
    // so a phrase that was recorded anew replaces the old one. One clip failing does not stop the rest.
    const audio = await caches.open(AUDIO);
    await Promise.all(CLIPS.map(async (url) => {
      try {
        const res = await fetch(url, { cache: 'no-cache' });
        if (res.ok) await audio.put(url, res);
      } catch (e) { /* offline: the clip saved earlier, if any, stays */ }
    }));
    // A first install takes over at once. An update waits until the page says the home screen is
    // showing (see the 'activate' message), so nothing changes in the middle of a drawing.
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('tracepop-') && k !== VERSION && k !== AUDIO).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', (event) => {
  if (event.data === 'activate') self.skipWaiting();
  if (event.data === 'version' && event.ports[0]) event.ports[0].postMessage(VERSION);
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // Voice clips: from their own cache at once; one that is not there yet is fetched and kept.
  if (/\/audio\//.test(url.pathname)) {
    event.respondWith(
      caches.open(AUDIO).then(async (cache) => {
        const hit = await cache.match(req, { ignoreSearch: true });
        if (hit) return hit;
        const res = await fetch(req);
        if (res.ok) cache.put(req, res.clone());
        return res;
      }).catch(() => Response.error())
    );
    return;
  }

  // App files ask the server every time (a cheap "not modified" when nothing changed), so a new
  // version is never held back by the browser's own 10-minute cache. Offline: the saved copy.
  const fresh = !/\/icons\//.test(url.pathname);
  event.respondWith(
    fetch(req, fresh ? { cache: 'no-cache' } : undefined)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(VERSION).then((c) => c.put(req, copy));
        }
        return res;
      })
      .catch(() =>
        caches.match(req, { ignoreSearch: true }).then((hit) => hit || (req.mode === 'navigate' ? caches.match('index.html') : Response.error()))
      )
  );
});
