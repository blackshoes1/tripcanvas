// Trip Canvas Service Worker
const VER = 'tc-v1';
const SHELL_CACHE = VER + '-shell';
const TILE_CACHE = VER + '-tiles';
const TILE_LIMIT = 1200; // 타일 최대 캐시 수 (여행 지역 커버)

const SHELL = [
  './',
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css',
  'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/lz-string/1.4.4/lz-string.min.js'
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(SHELL_CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys.filter(k => !k.startsWith(VER)).map(k => caches.delete(k))
    )).then(() => self.clients.claim())
  );
});

async function trimCache(name, limit) {
  const c = await caches.open(name);
  const keys = await c.keys();
  if (keys.length > limit) {
    await Promise.all(keys.slice(0, keys.length - limit).map(k => c.delete(k)));
  }
}

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  // 검색(Nominatim)은 항상 네트워크
  if (url.hostname.includes('nominatim')) return;

  // 지도 타일: stale-while-revalidate (본 지역은 오프라인에서도 표시)
  if (url.hostname.includes('cartocdn.com') || url.hostname.includes('tile.openstreetmap')) {
    e.respondWith((async () => {
      const cache = await caches.open(TILE_CACHE);
      const cached = await cache.match(e.request);
      const fetching = fetch(e.request).then(res => {
        if (res && res.status === 200) {
          cache.put(e.request, res.clone());
          trimCache(TILE_CACHE, TILE_LIMIT);
        }
        return res;
      }).catch(() => cached);
      return cached || fetching;
    })());
    return;
  }

  // 앱 셸 + CDN: cache-first
  e.respondWith((async () => {
    const cached = await caches.match(e.request);
    if (cached) return cached;
    try {
      const res = await fetch(e.request);
      if (res && res.status === 200 && (url.origin === location.origin || url.hostname === 'cdnjs.cloudflare.com')) {
        const cache = await caches.open(SHELL_CACHE);
        cache.put(e.request, res.clone());
      }
      return res;
    } catch (err) {
      // 오프라인 내비게이션 폴백
      if (e.request.mode === 'navigate') {
        const shell = await caches.match('./index.html');
        if (shell) return shell;
      }
      throw err;
    }
  })());
});
