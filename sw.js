// Trip Canvas Service Worker
const VER = 'tc-v6';
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
  'https://cdnjs.cloudflare.com/ajax/libs/lz-string/1.4.4/lz-string.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/Sortable/1.15.2/Sortable.min.js',
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js'
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

// 1x1 투명 PNG — 캐시·네트워크 모두 실패한 타일 자리에 반환 (지도 공백/깨짐 방지)
const BLANK_PNG = Uint8Array.from(atob(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='
), c => c.charCodeAt(0));
function blankTile() {
  return new Response(BLANK_PNG, { headers: { 'Content-Type': 'image/png' } });
}

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  // 검색(Nominatim) / AI(Anthropic)는 항상 네트워크
  if (url.hostname.includes('nominatim') || url.hostname.includes('api.anthropic.com')) return;

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
      }).catch(() => cached || blankTile());
      return cached || fetching;
    })());
    return;
  }

  // 같은 오리진(앱 파일): network-first — 편집이 새로고침 즉시 반영, 오프라인엔 캐시 폴백
  if (url.origin === location.origin) {
    e.respondWith((async () => {
      try {
        const res = await fetch(e.request);
        if (res && res.status === 200) {
          const cache = await caches.open(SHELL_CACHE);
          cache.put(e.request, res.clone());
        }
        return res;
      } catch (err) {
        const cached = await caches.match(e.request);
        if (cached) return cached;
        if (e.request.mode === 'navigate') {
          const shell = await caches.match('./index.html');
          if (shell) return shell;
        }
        throw err;
      }
    })());
    return;
  }

  // CDN 라이브러리: cache-first
  e.respondWith((async () => {
    const cached = await caches.match(e.request);
    if (cached) return cached;
    const res = await fetch(e.request);
    if (res && res.status === 200 && url.hostname === 'cdnjs.cloudflare.com') {
      const cache = await caches.open(SHELL_CACHE);
      cache.put(e.request, res.clone());
    }
    return res;
  })());
});
