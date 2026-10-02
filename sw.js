// Trip Canvas Service Worker
const VER = 'tc-v247';
const SHELL_CACHE = VER + '-shell';

// index.html이 `?v=VER`로 부르는 파일 — **그 주소 그대로** 담는다. 오프라인 폴백(caches.match)은 쿼리까지
// 비교하므로 `./lib.js`로 담아 두면 첫 방문 직후 오프라인에서 `lib.js?v=…`를 못 찾아 빈 화면이 된다
// (첫 방문의 스크립트 요청은 아직 SW를 거치지 않아 network-first가 채워 주지도 않는다).
// index.html에 스크립트·스타일을 더하면 여기에도 더한다 — test/sw.test.js가 대조한다.
const VERSIONED = [
  'style.css', 'lib.js', 'sync.js', 'routing.js', 'price.js', 'adaptive.js',
  'intake.js', 'collab.js', 'api.js', 'auth.js', 'app.js'
];

const SHELL = [
  './',
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  ...VERSIONED.map(f => './' + f + '?v=' + VER)
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
  'googleapis.com', 'googleusercontent.com', 'maps.gstatic.com', 'fonts.gstatic.com',
  'dapi.kakao.com', 't1.daumcdn.net', 'kakaomobility.com',
  'nominatim', 'api.anthropic.com', 'supabase.co'
];

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  // GET 외 요청·서버 함수(/api/)·NAS 프록시(/nas/api/)는 SW가 손대지 않는다.
  if (e.request.method !== 'GET' || url.pathname.startsWith('/api/') || url.pathname.startsWith('/nas/api/')) return;

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
    if (res && res.status === 200 && (url.hostname === 'cdnjs.cloudflare.com' || url.hostname === 'cdn.jsdelivr.net')) {
      const cache = await caches.open(SHELL_CACHE);
      cache.put(e.request, res.clone());
    }
    return res;
  })());
});
