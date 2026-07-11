// Trip Canvas Service Worker
const VER = 'tc-v44';
const SHELL_CACHE = VER + '-shell';

const SHELL = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './lib.js',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
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

// 항상 네트워크로 통과시킬 호스트 (지도/검색/AI/동기화 — 캐시 금지·불필요)
const PASSTHROUGH = [
  'googleapis.com', 'maps.gstatic.com', 'fonts.gstatic.com',
  'dapi.kakao.com', 't1.daumcdn.net', 'kakaomobility.com',
  'nominatim', 'api.anthropic.com', 'supabase.co'
];

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  if (PASSTHROUGH.some(h => url.hostname.includes(h))) return;

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
