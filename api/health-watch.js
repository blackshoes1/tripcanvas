'use strict';
// 외부 경로 감시 — **우리 인프라 밖에서** API가 살아 있는지 본다.
//
// 왜 Vercel인가: 정적 웹을 내보내는 Vercel은 API·DB와 다른 장애 도메인이다. NAS(오늘)든 관리형 런타임(내일)이든
// 안에서 자기를 확인하면 언제나 초록이고, 개발 기기에서 확인해도 tailnet·VPN이 끼어 외부 경로를 지나지 않는다
// (2026-09-05에 외부 경로가 죽어 있었는데 그래서 아무도 몰랐다 — `docs/nas-deployment.md`).
//
// 이 함수는 알림을 보내지 않는다. **상태 코드로 말한다**:
//   200 HEALTHY     전부 정상
//   200 DEGRADED    실시간·백업·점검 모드처럼 폴백이 있는 것만 어긋났다 — 알림을 울리지 않는다
//   503 UNAVAILABLE 저장 경로가 죽었다 — 사용자가 여행을 저장할 수 없다
// 무료 uptime 모니터(UptimeRobot 등)를 이 URL에 걸어 두면 503에서 알림이 온다.
//
// 감시 대상은 환경변수로 옮긴다(전환 스위치): TC_WATCH_BASE(API) · TC_WATCH_REALTIME_BASE(실시간, 다른 호스트일 때) · TC_WATCH_WS_PATH.
// ⚠️ 비밀은 아무것도 출력하지 않는다(§47). 공개 주소와 살았나/죽었나뿐이다.

const DEFAULT_BASE = 'https://bokbok9.tail8b977f.ts.net';
const TIMEOUT_MS = 10000;
const COMPONENT_STATUS = new Set(['ok', 'degraded', 'error', 'unconfigured']);
const OVERALL_STATUS = new Set(['HEALTHY', 'DEGRADED', 'UNAVAILABLE']);

/**
 * 검사 결과 → 판정. **저장과 실시간의 무게가 다르다**:
 * 저장이 죽으면 사용자가 아무것도 못 하지만(503), 실시간·백업·점검 모드는 폴백이 있어
 * 기능이 죽지 않는다(200 + degraded). 그것들로 새벽에 깨우지 않는다.
 */
function verdict(checks) {
  const failed = [];
  if (!checks.health || !checks.health.ok) failed.push('health');
  if (!checks.database) failed.push('database');
  if (!checks.auth || !checks.auth.ok) failed.push('auth');

  const reasons = [];
  // 업그레이드가 되는 것과 LISTEN이 살아 있는 것은 다른 질문이다 — 둘 중 하나라도 어긋나면 실시간은 degraded
  const components = (checks.health && checks.health.components) || {};
  if (!(checks.realtime && checks.realtime.ok) || components.realtime === 'error') reasons.push('realtime');
  if (components.backup === 'error' || components.backup === 'degraded') reasons.push('backup');
  if (checks.health && checks.health.readOnly === true) reasons.push('readOnly');

  const degraded = reasons.length > 0;
  return {
    status: failed.length ? 'UNAVAILABLE' : (degraded ? 'DEGRADED' : 'HEALTHY'),
    httpStatus: failed.length ? 503 : 200,
    failed,
    // 저장이 죽었으면 degraded는 말하지 않는다 — 큰 것부터 말한다
    degraded: failed.length ? false : degraded,
    degradedReasons: failed.length ? [] : reasons
  };
}

/** 응답에 비밀이 섞이지 않게, 우리가 아는 필드만 옮긴다 */
function summarize(name, res, body) {
  const out = { name, ok: false, status: res == null ? 0 : res.status };
  if (res == null) { out.error = 'unreachable'; return out; }
  if (name === 'health') {
    out.ok = res.status === 200 && !!(body && body.ok);
    if (body && typeof body.database === 'string') out.database = body.database;
    if (body && OVERALL_STATUS.has(body.status)) out.overall = body.status;
    if (body && typeof body.readOnly === 'boolean') out.readOnly = body.readOnly;
    if (body && body.components && typeof body.components === 'object') {
      // 상태 단어만 옮긴다 — 상세 문장은 옮기지 않는다(무엇이 실릴지 이쪽이 정하지 않는다)
      const components = {};
      for (const key of ['api', 'database', 'realtime', 'backup']) {
        const c = body.components[key];
        if (c && COMPONENT_STATUS.has(c.status)) components[key] = c.status;
      }
      out.components = components;
    }
  } else if (name === 'auth') {
    // 401이 정상이다 — 라우팅과 인증 계층이 살아 있다는 뜻
    out.ok = res.status === 401;
  }
  return out;
}

/**
 * WebSocket 업그레이드가 실제로 되는가.
 * ⚠️ **HTTP/1.1로 물어야 한다** — HTTP/2에서는 업그레이드가 성립하지 않아 엉뚱한 404로 보인다.
 * @param {string} base @param {string} path @param {typeof import('https')} https
 */
function probeWebSocket(base, path, https) {
  return new Promise((resolve) => {
    let url;
    try { url = new URL(path, base); } catch (_) { resolve({ name: 'realtime', ok: false, status: 0, error: 'bad_url' }); return; }
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
  // 관리형 런타임에서는 API와 실시간이 다른 호스트일 수 있다. 없으면 API와 같은 호스트의 /ws
  const realtimeBase = String(env.TC_WATCH_REALTIME_BASE || base).replace(/\/+$/, '');
  const wsPath = String(env.TC_WATCH_WS_PATH || '/ws');
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
      probeWebSocket(realtimeBase, wsPath, https)
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
      realtimeTarget: realtimeBase + wsPath,
      failed: v.failed,
      degraded: v.degraded,
      degradedReasons: v.degradedReasons,
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
