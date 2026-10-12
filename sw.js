// Network-first: always serve fresh pages and schedules, falling back to the last cached copy when offline.
const CACHE = 'noc-schedule';
const SHELL = ['./', 'index.html', 'app.js', 'schedule-core.js', 'style.css', 'manifest.webmanifest', 'assets/icon.svg', 'assets/icon-192.png'];

self.addEventListener('install', event => {
    event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));

self.addEventListener('fetch', event => {
    const { request } = event;
    if (request.method !== 'GET' || new URL(request.url).origin !== location.origin) return;
    event.respondWith(fetch(request).then(response => {
        if (response.ok) {
            const copy = response.clone();
            event.waitUntil(caches.open(CACHE).then(cache => cache.put(request, copy)));
        }
        return response;
    }).catch(async () => {
        const cached = await caches.match(request, { ignoreSearch: true });
        if (!cached) return Response.error();
        // The page reads this header to tell stored data from freshly downloaded data.
        const headers = new Headers(cached.headers);
        headers.set('x-offline-cache', '1');
        return new Response(cached.body, { status: cached.status, statusText: cached.statusText, headers });
    }));
});
