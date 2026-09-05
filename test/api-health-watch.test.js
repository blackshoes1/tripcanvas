const test = require('node:test');
const assert = require('node:assert/strict');
const { createHandler, _private } = require('../api/health-watch.js');

// 여기서 지키는 것은 하나다: **저장이 죽었을 때만 알림이 울린다.**
// 실시간은 폴백(당겨서 새로고침)이 있어 degraded일 뿐이고, 그걸로 새벽에 깨우지 않는다.

function response() {
  return {
    headers: {}, statusCode: 0, body: '',
    setHeader(k, v) { this.headers[k] = v; },
    end(value) { this.body = value; }
  };
}

/** @param {{health?:any, auth?:any, ws?:any}} plan */
function handlerWith(plan) {
  const fetchImpl = async (url) => {
    if (url.endsWith('/api/health')) {
      if (!plan.health) throw new Error('unreachable');
      return { status: plan.health.status, json: async () => plan.health.body };
    }
    if (!plan.auth) throw new Error('unreachable');
    return { status: plan.auth.status, json: async () => ({}) };
  };
  // https.request를 가짜로 — upgrade/response/error 중 하나를 즉시 발생시킨다
  const https = {
    request() {
      const listeners = {};
      queueMicrotask(() => {
        const kind = plan.ws || 'error';
        if (kind === 'upgrade') listeners.upgrade && listeners.upgrade();
        else if (typeof kind === 'number') listeners.response && listeners.response({ statusCode: kind });
        else listeners.error && listeners.error(new Error('x'));
      });
      return {
        on(event, fn) { listeners[event] = fn; return this; },
        end() {}, destroy() {}
      };
    }
  };
  return createHandler({ env: { TC_WATCH_BASE: 'https://nas.test' }, fetchImpl, https });
}

async function invoke(handler) {
  const res = response();
  await handler({ method: 'GET', headers: {} }, res);
  return { status: res.statusCode, headers: res.headers, json: JSON.parse(res.body) };
}

const OK = { health: { status: 200, body: { ok: true, database: 'ok' } }, auth: { status: 401 }, ws: 'upgrade' };

test('감시: 전부 정상이면 200 UP', async () => {
  const out = await invoke(handlerWith(OK));
  assert.equal(out.status, 200);
  assert.equal(out.json.status, 'UP');
  assert.deepEqual(out.json.failed, []);
  assert.equal(out.json.degraded, false);
  assert.equal(out.json.checks.realtime.status, 101);
  // 모니터가 캐시된 초록을 보고 안심하면 안 된다
  assert.equal(out.headers['Cache-Control'], 'no-store');
});

test('감시: 실시간만 죽으면 DEGRADED — 200이다(폴백이 있어 장애가 아니다)', async () => {
  const out = await invoke(handlerWith({ ...OK, ws: 502 }));
  assert.equal(out.status, 200, '실시간 하나로 알림을 울리지 않는다');
  assert.equal(out.json.status, 'DEGRADED');
  assert.equal(out.json.degraded, true);
  assert.deepEqual(out.json.failed, []);
  assert.equal(out.json.checks.realtime.ok, false);
});

test('감시: API가 안 닿으면 503 DOWN — 저장이 안 되는 상태다', async () => {
  const out = await invoke(handlerWith({ health: null, auth: null, ws: 'error' }));
  assert.equal(out.status, 503);
  assert.equal(out.json.status, 'DOWN');
  assert.ok(out.json.failed.includes('health'));
  assert.equal(out.json.checks.health.error, 'unreachable');
});

test('감시: DB가 죽으면 API가 200이어도 DOWN', async () => {
  const out = await invoke(handlerWith({ ...OK, health: { status: 200, body: { ok: false, database: 'down' } } }));
  assert.equal(out.status, 503);
  assert.ok(out.json.failed.includes('database'));
});

/** 401이 정상이다 — 200이 오면 인증이 통째로 열린 것이라 그게 더 큰 일이다 */
test('감시: 보호된 라우트가 401이 아니면 DOWN', async () => {
  const out = await invoke(handlerWith({ ...OK, auth: { status: 200 } }));
  assert.equal(out.status, 503);
  assert.ok(out.json.failed.includes('auth'));
  const ok401 = await invoke(handlerWith(OK));
  assert.equal(ok401.json.checks.auth.ok, true);
});

test('감시: 응답에 비밀이 섞이지 않는다', async () => {
  const out = await invoke(handlerWith(OK));
  const text = JSON.stringify(out.json);
  for (const secret of ['authorization', 'Bearer', 'password', 'SECRET', 'token']) {
    assert.equal(text.toLowerCase().includes(secret.toLowerCase()), false, `${secret}가 새면 안 된다`);
  }
  assert.equal(out.json.target, 'https://nas.test', '공개 주소만 밝힌다');
});

test('판정: 저장 실패는 503, 실시간 실패는 200', () => {
  const up = { health: { ok: true }, auth: { ok: true }, realtime: { ok: true }, database: true };
  assert.equal(_private.verdict(up).httpStatus, 200);
  assert.equal(_private.verdict({ ...up, realtime: { ok: false } }).httpStatus, 200);
  assert.equal(_private.verdict({ ...up, database: false }).httpStatus, 503);
  assert.equal(_private.verdict({ ...up, health: { ok: false } }).httpStatus, 503);
  // 저장이 죽었으면 실시간 degraded는 말하지 않는다 — 큰 것부터 말한다
  assert.equal(_private.verdict({ ...up, health: { ok: false }, realtime: { ok: false } }).degraded, false);
});
