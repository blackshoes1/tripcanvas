const test = require('node:test');
const assert = require('node:assert/strict');
const { createHandler, _private } = require('../api/health-watch.js');

// 여기서 지키는 것은 하나다: **저장이 죽었을 때만 알림이 울린다.**
// 실시간·백업·점검 모드는 폴백이 있어 degraded일 뿐이고, 그걸로 새벽에 깨우지 않는다.

function response() {
  return {
    headers: {}, statusCode: 0, body: '',
    setHeader(k, v) { this.headers[k] = v; },
    end(value) { this.body = value; }
  };
}

/** @param {{health?:any, auth?:any, ws?:any, env?:any}} plan */
function handlerWith(plan) {
  const fetchImpl = async (url) => {
    if (url.endsWith('/api/health')) {
      if (!plan.health) throw new Error('unreachable');
      return { status: plan.health.status, json: async () => plan.health.body };
    }
    // 배포 정체 감시가 묻는 GitHub — plan.github이 없으면 못 닿은 것으로 둔다
    if (url.startsWith('https://api.github.com/')) {
      github.push(url);
      if (!plan.github) throw new Error('unreachable');
      if (url.includes('/ref/tags/production')) {
        return { status: 200, json: async () => ({ object: { sha: plan.github.sha } }) };
      }
      return { status: 200, json: async () => ({ committer: { date: plan.github.committedAt } }) };
    }
    if (!plan.auth) throw new Error('unreachable');
    return { status: plan.auth.status, json: async () => ({}) };
  };
  const github = [];
  const requested = [];
  // https.request를 가짜로 — upgrade/response/error 중 하나를 즉시 발생시킨다
  const https = {
    request(options) {
      requested.push(options);
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
  const handler = createHandler({ env: { TC_WATCH_BASE: 'https://nas.test', ...(plan.env || {}) }, fetchImpl, https });
  handler.requested = requested;
  handler.github = github;
  return handler;
}

async function invoke(handler) {
  const res = response();
  await handler({ method: 'GET', headers: {} }, res);
  return { status: res.statusCode, headers: res.headers, json: JSON.parse(res.body) };
}

const HEALTHY_BODY = {
  ok: true, status: 'HEALTHY', database: 'ok', readOnly: false,
  components: { api: { status: 'ok' }, database: { status: 'ok' }, realtime: { status: 'ok' }, backup: { status: 'ok', detail: '마지막 성공 2026-09-17T00:00:00.000Z (3시간 전)' } }
};
const OK = { health: { status: 200, body: HEALTHY_BODY }, auth: { status: 401 }, ws: 'upgrade' };

test('감시: 전부 정상이면 200 HEALTHY', async () => {
  const out = await invoke(handlerWith(OK));
  assert.equal(out.status, 200);
  assert.equal(out.json.status, 'HEALTHY');
  assert.deepEqual(out.json.failed, []);
  assert.equal(out.json.degraded, false);
  assert.deepEqual(out.json.degradedReasons, []);
  assert.equal(out.json.checks.realtime.status, 101);
  assert.deepEqual(out.json.checks.health.components, { api: 'ok', database: 'ok', realtime: 'ok', backup: 'ok' });
  // 모니터가 캐시된 초록을 보고 안심하면 안 된다
  assert.equal(out.headers['Cache-Control'], 'no-store');
});

test('감시: 옛 모양의 /api/health(구성요소 없음)도 그대로 판정한다 — 전환기 동안 두 버전이 섞인다', async () => {
  const out = await invoke(handlerWith({ ...OK, health: { status: 200, body: { ok: true, database: 'ok' } } }));
  assert.equal(out.status, 200);
  assert.equal(out.json.status, 'HEALTHY');
});

test('감시: 실시간만 죽으면 DEGRADED — 200이다(폴백이 있어 장애가 아니다)', async () => {
  const out = await invoke(handlerWith({ ...OK, ws: 502 }));
  assert.equal(out.status, 200, '실시간 하나로 알림을 울리지 않는다');
  assert.equal(out.json.status, 'DEGRADED');
  assert.equal(out.json.degraded, true);
  assert.deepEqual(out.json.degradedReasons, ['realtime']);
  assert.deepEqual(out.json.failed, []);
  assert.equal(out.json.checks.realtime.ok, false);
});

test('감시: 업그레이드는 되는데 API가 LISTEN이 죽었다고 하면 그것도 DEGRADED — 붙는 것과 듣는 것은 다르다', async () => {
  const body = { ...HEALTHY_BODY, status: 'DEGRADED', components: { ...HEALTHY_BODY.components, realtime: { status: 'error' } } };
  const out = await invoke(handlerWith({ ...OK, health: { status: 200, body } }));
  assert.equal(out.status, 200);
  assert.deepEqual(out.json.degradedReasons, ['realtime']);
});

test('감시: 백업이 낡았거나 없으면 DEGRADED — 저장은 되니 503이 아니지만 사람이 봐야 한다', async () => {
  for (const status of ['degraded', 'error']) {
    const body = { ...HEALTHY_BODY, status: 'DEGRADED', components: { ...HEALTHY_BODY.components, backup: { status } } };
    const out = await invoke(handlerWith({ ...OK, health: { status: 200, body } }));
    assert.equal(out.status, 200);
    assert.equal(out.json.status, 'DEGRADED');
    assert.deepEqual(out.json.degradedReasons, ['backup']);
  }
});

test('감시: 점검(읽기 전용) 모드는 DEGRADED로 보인다 — 전환 중임을 밖에서도 안다', async () => {
  const body = { ...HEALTHY_BODY, status: 'DEGRADED', readOnly: true };
  const out = await invoke(handlerWith({ ...OK, health: { status: 200, body } }));
  assert.equal(out.status, 200);
  assert.deepEqual(out.json.degradedReasons, ['readOnly']);
  assert.equal(out.json.checks.health.readOnly, true);
});

test('감시: API가 안 닿으면 503 UNAVAILABLE — 저장이 안 되는 상태다', async () => {
  const out = await invoke(handlerWith({ health: null, auth: null, ws: 'error' }));
  assert.equal(out.status, 503);
  assert.equal(out.json.status, 'UNAVAILABLE');
  assert.ok(out.json.failed.includes('health'));
  assert.equal(out.json.checks.health.error, 'unreachable');
});

test('감시: DB가 죽으면 API가 200이어도 UNAVAILABLE', async () => {
  const out = await invoke(handlerWith({ ...OK, health: { status: 200, body: { ok: false, status: 'UNAVAILABLE', database: 'error' } } }));
  assert.equal(out.status, 503);
  assert.ok(out.json.failed.includes('database'));
});

/** 401이 정상이다 — 200이 오면 인증이 통째로 열린 것이라 그게 더 큰 일이다 */
test('감시: 보호된 라우트가 401이 아니면 UNAVAILABLE', async () => {
  const out = await invoke(handlerWith({ ...OK, auth: { status: 200 } }));
  assert.equal(out.status, 503);
  assert.ok(out.json.failed.includes('auth'));
  const ok401 = await invoke(handlerWith(OK));
  assert.equal(ok401.json.checks.auth.ok, true);
});

test('감시: 실시간이 다른 호스트면 그쪽을 찌른다(관리형 런타임) — 기본은 API와 같은 호스트의 /ws', async () => {
  const separate = handlerWith({ ...OK, env: { TC_WATCH_REALTIME_BASE: 'https://rt.test', TC_WATCH_WS_PATH: '/socket' } });
  const out = await invoke(separate);
  assert.equal(separate.requested[0].hostname, 'rt.test');
  assert.equal(separate.requested[0].path, '/socket');
  assert.equal(out.json.realtimeTarget, 'https://rt.test/socket');
  const same = handlerWith(OK);
  await invoke(same);
  assert.equal(same.requested[0].hostname, 'nas.test');
  assert.equal(same.requested[0].path, '/ws');
});

test('감시: 응답에 비밀이 섞이지 않는다 — 상세 문장도 옮기지 않는다', async () => {
  const out = await invoke(handlerWith(OK));
  const text = JSON.stringify(out.json);
  for (const secret of ['authorization', 'Bearer', 'password', 'SECRET', 'token']) {
    assert.equal(text.toLowerCase().includes(secret.toLowerCase()), false, `${secret}가 새면 안 된다`);
  }
  assert.equal(text.includes('마지막 성공'), false, '구성요소 상세 문장은 옮기지 않는다');
  assert.equal(out.json.target, 'https://nas.test', '공개 주소만 밝힌다');
});

test('판정: 저장 실패는 503, 실시간·백업·점검은 200', () => {
  const up = { health: { ok: true, components: { realtime: 'ok', backup: 'ok' } }, auth: { ok: true }, realtime: { ok: true }, database: true };
  assert.equal(_private.verdict(up).httpStatus, 200);
  assert.equal(_private.verdict({ ...up, realtime: { ok: false } }).httpStatus, 200);
  assert.equal(_private.verdict({ ...up, health: { ...up.health, components: { realtime: 'ok', backup: 'error' } } }).status, 'DEGRADED');
  assert.equal(_private.verdict({ ...up, database: false }).httpStatus, 503);
  assert.equal(_private.verdict({ ...up, health: { ok: false } }).httpStatus, 503);
  // 저장이 죽었으면 실시간 degraded는 말하지 않는다 — 큰 것부터 말한다
  assert.equal(_private.verdict({ ...up, health: { ok: false }, realtime: { ok: false } }).degraded, false);
});

// ── 배포 정체 감시(2026-09-20) ──
// NAS 스케줄러가 조용히 죽으면 옛 코드가 계속 돈다. 안에서 보면 전부 초록이라 아무도 모른다 —
// 그래서 밖에서 `production` 태그와 도는 revision을 대조한다. 저장은 멀쩡하므로 503이 아니라 DEGRADED다.
const RUNNING = 'eeea35427de2855d2a863e14e31d786aa5f16467';
const NEWER = 'abc1234def5678901234567890abcdef12345678';
const withRevision = (revision) => ({ ...HEALTHY_BODY, revision });
const ago = (min) => new Date(Date.now() - min * 60000).toISOString();

test('감시: 태그와 도는 revision이 같으면 배포는 정상이다', async () => {
  const out = await invoke(handlerWith({
    ...OK, health: { status: 200, body: withRevision(RUNNING) },
    github: { sha: RUNNING, committedAt: ago(120) }
  }));
  assert.equal(out.status, 200);
  assert.equal(out.json.status, 'HEALTHY');
  assert.equal(out.json.checks.deploy.ok, true);
  assert.equal(out.json.checks.deploy.stale, false);
});

test('감시: 오래 어긋나 있으면 DEGRADED — 배포가 선 것이다. 저장은 멀쩡하니 503은 아니다', async () => {
  const out = await invoke(handlerWith({
    ...OK, health: { status: 200, body: withRevision(RUNNING) },
    github: { sha: NEWER, committedAt: ago(90) }
  }));
  assert.equal(out.status, 200, '배포 정체로 새벽에 깨우지 않는다');
  assert.equal(out.json.status, 'DEGRADED');
  assert.deepEqual(out.json.degradedReasons, ['deploy']);
  assert.equal(out.json.checks.deploy.stale, true);
  assert.equal(out.json.checks.deploy.expected, NEWER.slice(0, 7));
  assert.equal(out.json.checks.deploy.running, RUNNING.slice(0, 7));
  assert.ok(out.json.checks.deploy.ageMin >= 89, '얼마나 오래됐는지 함께 말한다');
});

test('감시: 방금 머지한 직후는 정체가 아니다 — NAS가 받아 갈 시간을 준다', async () => {
  const out = await invoke(handlerWith({
    ...OK, health: { status: 200, body: withRevision(RUNNING) },
    github: { sha: NEWER, committedAt: ago(3) }
  }));
  assert.equal(out.json.status, 'HEALTHY');
  assert.equal(out.json.checks.deploy.stale, false);
  assert.deepEqual(out.json.degradedReasons, []);
});

test('감시: GitHub에 못 닿으면 정체라고 말하지 않는다 — 거짓 경보를 내지 않는다', async () => {
  const out = await invoke(handlerWith({
    ...OK, health: { status: 200, body: withRevision(RUNNING) }
  }));
  assert.equal(out.json.status, 'HEALTHY');
  assert.equal(out.json.checks.deploy.unknown, true);
  assert.deepEqual(out.json.degradedReasons, []);
});

test('감시: TC_WATCH_REPO를 비우면 배포를 아예 묻지 않는다', async () => {
  const handler = handlerWith({
    ...OK, health: { status: 200, body: withRevision(RUNNING) },
    github: { sha: NEWER, committedAt: ago(999) },
    env: { TC_WATCH_REPO: '' }
  });
  const out = await invoke(handler);
  assert.equal(out.json.status, 'HEALTHY');
  assert.equal(out.json.checks.deploy, null);
  assert.deepEqual(handler.github, [], 'GitHub에 한 번도 묻지 않는다');
});

test('감시: /api/health가 revision을 안 주면 묻지 않는다 — 옛 이미지와도 섞여 돈다', async () => {
  const handler = handlerWith({ ...OK, github: { sha: NEWER, committedAt: ago(999) } });
  const out = await invoke(handler);
  assert.equal(out.json.status, 'HEALTHY');
  assert.equal(out.json.checks.deploy, null);
  assert.deepEqual(handler.github, []);
});

test('감시: 저장이 죽었으면 배포 정체는 말하지 않는다 — 큰 것부터 말한다', async () => {
  const out = await invoke(handlerWith({
    ...OK, health: { status: 200, body: { ...withRevision(RUNNING), database: 'error' } },
    github: { sha: NEWER, committedAt: ago(999) }
  }));
  assert.equal(out.status, 503);
  assert.equal(out.json.status, 'UNAVAILABLE');
  assert.equal(out.json.degraded, false);
  assert.deepEqual(out.json.degradedReasons, []);
});
