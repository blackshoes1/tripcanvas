'use strict';
// 외부 경로 감시 — **tailnet 밖에서** NAS API가 살아 있는지 본다.
//
// 왜 Vercel인가: 우리 인프라 중 tailnet 밖에 있는 것이 여기뿐이다. NAS에서 자기를 확인하면
// 언제나 초록이고, 개발 기기에서 확인해도 MagicDNS가 100.x로 풀어 Funnel을 지나지 않는다
// (2026-09-05에 외부 경로가 죽어 있었는데 그래서 아무도 몰랐다 — `docs/nas-deployment.md`).
//
// 이 함수는 알림을 보내지 않는다. **상태 코드로 말한다**:
//   200 = 정상 (또는 실시간만 degraded)
//   503 = 저장 경로가 죽었다 — 사용자가 여행을 저장할 수 없다
// 무료 uptime 모니터(UptimeRobot 등)를 이 URL에 걸어 두면 503에서 알림이 온다.
//
// ⚠️ 비밀은 아무것도 출력하지 않는다(§47). 공개 주소와 살았나/죽었나뿐이다.

const DEFAULT_BASE = 'https://bokbok9.tail8b977f.ts.net';
const TIMEOUT_MS = 10000;

/**
 * 검사 결과 → 판정. **저장과 실시간의 무게가 다르다**:
 * 저장이 죽으면 사용자가 아무것도 못 하지만(503), 실시간은 폴백(당겨서 새로고침)이 있어
 * 기능이 죽지 않는다(200 + degraded). 실시간 하나로 새벽에 깨우지 않는다.
 */
function verdict(checks) {
  const failed = [];
  if (!checks.health || !checks.health.ok) failed.push('health');
  if (!checks.database) failed.push('database');
  if (!checks.auth || !checks.auth.ok) failed.push('auth');
  const degraded = !(checks.realtime && checks.realtime.ok);
  return {
    status: failed.length ? 'DOWN' : (degraded ? 'DEGRADED' : 'UP'),
    httpStatus: failed.length ? 503 : 200,
    failed,
    // 실시간은 폴백이 있어 장애가 아니다 — 알림을 울리지 않는다
    degraded: failed.length ? false : degraded
  };
}

/** 응답에 비밀이 섞이지 않게, 우리가 아는 필드만 옮긴다 */
function summarize(name, res, body) {
  const out = { name, ok: false, status: res == null ? 0 : res.status };
  if (res == null) { out.error = 'unreachable'; return out; }
  if (name === 'health') {
    out.ok = res.status === 200 && !!(body && body.ok);
    if (body && typeof body.database === 'string') out.database = body.database;
  } else if (name === 'auth') {
    // 401이 정상이다 — 라우팅과 인증 계층이 살아 있다는 뜻
    out.ok = res.status === 401;
  }
  return out;
}

/**
 * WebSocket 업그레이드가 실제로 되는가.
 * ⚠️ **HTTP/1.1로 물어야 한다** — HTTP/2에서는 업그레이드가 성립하지 않아 엉뚱한 404로 보인다.
 * @param {string} base @param {typeof import('https')} https
 */
function probeWebSocket(base, https) {
  return new Promise((resolve) => {
    let url;
    try { url = new URL('/ws', base); } catch (_) { resolve({ name: 'realtime', ok: false, status: 0, error: 'bad_url' }); return; }
    const req = https.request({
      hostname: url.hostname, port: url.port || 443, path: url.pathname, method: 'GET',
      timeout: TIMEOUT_MS,
      headers: {
        Connection: 'Upgrade', Upgrade: 'websocket',
        'Sec-WebSocket-Version': '13', 'Sec-WebSocket-Key': 'dGhlIHNhbXBsZSBub25jZQ=='
      }
    });
    const done = (value) => { try { req.destroy(); } catch (_) { /* 이미 닫힘 */ } resolve(value); };
    // 101은 response가 아니라 upgrade 이벤트로 온다
    req.on('upgrade', () => done({ name: 'realtime', ok: true, status: 101 }));
    req.on('response', (res) => done({ name: 'realtime', ok: false, status: res.statusCode || 0 }));
    req.on('timeout', () => done({ name: 'realtime', ok: false, status: 0, error: 'timeout' }));
    req.on('error', () => done({ name: 'realtime', ok: false, status: 0, error: 'unreachable' }));
    req.end();
  });
}

/**
 * 주입 가능한 핸들러 — 테스트는 fetch와 https를 가짜로 바꾼다.
 * @param {{env?:Record<string,string|undefined>, fetchImpl?:any, https?:any}} [deps]
 */
function createHandler(deps = {}) {
  const env = deps.env || process.env;
  const base = String(env.TC_WATCH_BASE || DEFAULT_BASE).replace(/\/+$/, '');
  const doFetch = deps.fetchImpl || fetch;
  const https = deps.https || require('https');

  /** @param {string} path */
  async function get(path) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const res = await doFetch(base + path, { signal: controller.signal, headers: { accept: 'application/json' } });
      let body = null;
      try { body = await res.json(); } catch (_) { /* 본문이 JSON이 아니어도 상태 코드는 쓴다 */ }
      return { res, body };
    } catch (_) {
      return { res: null, body: null };
    } finally {
      clearTimeout(timer);
    }
  }

  return async function handler(req, res) {
    const startedAt = Date.now();
    const [health, auth, realtime] = await Promise.all([
      get('/api/health'),
      get('/api/v1/trips'),
      probeWebSocket(base, https)
    ]);

    const checks = {
      health: summarize('health', health.res, health.body),
      auth: summarize('auth', auth.res, auth.body),
      realtime,
      database: !!(health.body && health.body.database === 'ok')
    };
    const v = verdict(checks);

    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    // 모니터가 캐시된 초록을 보고 안심하는 일이 없게
    res.setHeader('Cache-Control', 'no-store');
    res.statusCode = v.httpStatus;
    res.end(JSON.stringify({
      status: v.status,
      target: base,
      failed: v.failed,
      degraded: v.degraded,
      checks: {
        health: checks.health,
        auth: checks.auth,
        realtime: checks.realtime,
        database: checks.database
      },
      tookMs: Date.now() - startedAt,
      checkedAt: new Date().toISOString()
    }, null, 2));
  };
}

module.exports = createHandler();
module.exports.createHandler = createHandler;
module.exports._private = { verdict, summarize, probeWebSocket, DEFAULT_BASE };
