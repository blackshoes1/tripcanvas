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
// 배포가 멈춘 것도 여기서 본다(2026-09-20). `production` 태그가 가리키는 커밋과 실제로 도는 `revision`이
// 오래 다르면 파이프라인이 선 것이다 — NAS 스케줄러가 조용히 죽어도 밖에서 알아챈다. 저장은 멀쩡하므로
// **503이 아니라 DEGRADED**다. 새벽에 깨우지 않는다.
//
// 감시 대상은 환경변수로 옮긴다(전환 스위치): TC_WATCH_BASE(API) · TC_WATCH_REALTIME_BASE(실시간, 다른 호스트일 때) · TC_WATCH_WS_PATH
// · TC_WATCH_REPO(배포 감시 대상, 빈 값이면 끈다) · TC_WATCH_DEPLOY_MAX_AGE_MIN(이 시간 넘게 어긋나면 정체).
// ⚠️ 비밀은 아무것도 출력하지 않는다(§47). 공개 주소와 살았나/죽었나뿐이다.

const DEFAULT_BASE = 'https://bokbok9.tail8b977f.ts.net';
const DEFAULT_REPO = 'blackshoes1/tripcanvas';
const DEFAULT_DEPLOY_MAX_AGE_MIN = 30;
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
  // 배포가 선 것은 저장을 막지 않는다 — 옛 코드가 돌 뿐이라 degraded다(§B1과 같은 생각: 조용한 실패를 없앤다)
  if (checks.deploy && checks.deploy.stale === true) reasons.push('deploy');

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
    // 이미지에 박힌 커밋 SHA — 공개 저장소의 커밋이라 비밀이 아니다. 배포 정체 판정에 쓴다.
    if (body && typeof body.revision === 'string' && /^[0-9a-f]{7,40}$/.test(body.revision)) out.revision = body.revision;
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
 * `production` 태그가 가리키는 커밋 ↔ 실제로 도는 revision.
 *
 * ⚠️ 이 함수는 상태를 기억하지 못한다(요청마다 새로 뜬다). 그래서 "언제부터 달랐는가"를 **커밋 시각**으로 본다 —
 *    릴리스는 머지 직후에 돌아 태그가 가리키는 커밋의 시각과 승격 시각이 몇 분 안이다. 커밋이 충분히 오래됐는데
 *    아직도 다른 것이 돌고 있으면 파이프라인이 선 것이다. 막 머지한 직후에는 정체라고 하지 않는다.
 * ⚠️ 판정하지 못하면 **정체라고 말하지 않는다**(GitHub에 못 닿았거나 한도에 걸렸을 때 거짓 경보를 내지 않는다).
 * @param {{repo:string, running:string|undefined, maxAgeMin:number, fetchImpl:any}} opts
 */
async function checkDeploy(opts) {
  const { repo, running, maxAgeMin, fetchImpl } = opts;
  if (!repo || !running) return null;
  const api = 'https://api.github.com/repos/' + repo + '/git';
  const head = { accept: 'application/vnd.github+json', 'user-agent': 'tripcanvas-health-watch' };
  const gh = async (path) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const res = await fetchImpl(api + path, { signal: controller.signal, headers: head });
      if (!res || res.status !== 200) return null;
      return await res.json();
    } catch (_) { return null; } finally { clearTimeout(timer); }
  };

  const ref = await gh('/ref/tags/production');
  const expected = ref && ref.object && typeof ref.object.sha === 'string' ? ref.object.sha : null;
  if (!expected) return { name: 'deploy', ok: false, unknown: true, running: running.slice(0, 7) };

  const match = expected === running || expected.startsWith(running) || running.startsWith(expected);
  if (match) return { name: 'deploy', ok: true, stale: false, expected: expected.slice(0, 7), running: running.slice(0, 7) };

  // 다르다 — 얼마나 오래 다른지는 그 커밋이 언제 것인지로 본다
  const commit = await gh('/commits/' + expected);
  const when = commit && commit.committer && typeof commit.committer.date === 'string' ? Date.parse(commit.committer.date) : NaN;
  if (!Number.isFinite(when)) {
    return { name: 'deploy', ok: false, unknown: true, expected: expected.slice(0, 7), running: running.slice(0, 7) };
  }
  const ageMin = Math.round((Date.now() - when) / 60000);
  return {
    name: 'deploy', ok: false, stale: ageMin > maxAgeMin, ageMin,
    expected: expected.slice(0, 7), running: running.slice(0, 7)
  };
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
  // 빈 문자열을 명시하면 배포 감시를 끈다(저장소가 비공개로 바뀌거나 한도에 걸릴 때)
  const repo = env.TC_WATCH_REPO === undefined ? DEFAULT_REPO : String(env.TC_WATCH_REPO);
  const deployMaxAgeMin = Number(env.TC_WATCH_DEPLOY_MAX_AGE_MIN) > 0
    ? Number(env.TC_WATCH_DEPLOY_MAX_AGE_MIN) : DEFAULT_DEPLOY_MAX_AGE_MIN;
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
    // 도는 revision을 알아야 대조할 수 있어 health 뒤에 온다. 못 알아내면 묻지도 않는다.
    checks.deploy = await checkDeploy({
      repo, running: checks.health.revision, maxAgeMin: deployMaxAgeMin, fetchImpl: doFetch
    });
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
        database: checks.database,
        deploy: checks.deploy
      },
      tookMs: Date.now() - startedAt,
      checkedAt: new Date().toISOString()
    }, null, 2));
  };
}

module.exports = createHandler();
module.exports.createHandler = createHandler;
module.exports._private = { verdict, summarize, probeWebSocket, checkDeploy, DEFAULT_BASE, DEFAULT_REPO, DEFAULT_DEPLOY_MAX_AGE_MIN };
