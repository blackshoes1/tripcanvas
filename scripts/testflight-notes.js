'use strict';
// 업로드한 빌드의 **"테스트할 내용"**(What to Test)을 채운다.
//
// 왜 따로 있나: `xcodebuild -exportArchive`는 바이너리만 올린다. 테스터에게 보일 변경 사항은
// App Store Connect API로 따로 넣어야 한다. 이게 비어 있으면 폰의 TestFlight에서
// **뭐가 바뀐 빌드인지 알 수 없다** — 2026-09-06까지 올린 빌드가 전부 그랬다.
//
// ⚠️ 업로드 직후에는 빌드가 아직 '처리 중'이라 API에 안 보인다. 그래서 잠깐 기다린다.
// ⚠️ 실패해도 업로드를 되돌리지 않는다 — 빌드는 이미 올라갔고, 설명이 없을 뿐이다.
//    호출부(워크플로)가 이 단계의 실패로 전체를 빨갛게 만들지 않는 이유다.
//
// 비밀은 인자로 받지 않는다(셸 히스토리에 남는다). 환경변수와 파일 경로로만 받는다:
//   APPSTORE_ISSUER_ID · APPSTORE_KEY_ID · APPSTORE_PRIVATE_KEY_PATH · TC_BUILD_NUMBER · TC_WHATS_NEW

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const BUNDLE_ID = 'com.fromj.trip';
const API = 'https://api.appstoreconnect.apple.com/v1';
/** App Store Connect의 상한. 넘기면 422로 거절당한다 */
const MAX_WHATS_NEW = 4000;
/** 처리 대기 — 보통 5~15분이라 넉넉히 잡되 무한정 기다리지 않는다 */
const POLL_INTERVAL_MS = 20_000;
const POLL_TIMEOUT_MS = 20 * 60_000;

/**
 * `~`를 집 디렉터리로 편다. 셸을 거치지 않고 오는 경로가 있어서다 —
 * YAML의 `env:`는 셸이 아니라 `~`가 그대로 온다(run #10이 그렇게 죽었다).
 */
function resolvePath(value) {
  const text = String(value ?? '');
  if (text === '~') return os.homedir();
  if (text.startsWith('~/')) return path.join(os.homedir(), text.slice(2));
  return text;
}

/** ES256 JWT. Node 22의 `ieee-p1363`이 JOSE 형식 서명을 그대로 준다(DER 변환 불필요). */
function makeToken({ issuerId, keyId, privateKey, now = Date.now() }) {
  const b64 = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');
  const header = b64({ alg: 'ES256', kid: keyId, typ: 'JWT' });
  const issued = Math.floor(now / 1000);
  const payload = b64({
    iss: issuerId,
    iat: issued,
    exp: issued + 15 * 60,          // Apple 상한은 20분 — 넉넉히 아래로 둔다
    aud: 'appstoreconnect-v1'
  });
  const signature = crypto
    .sign('sha256', Buffer.from(`${header}.${payload}`), { key: privateKey, dsaEncoding: 'ieee-p1363' })
    .toString('base64url');
  return `${header}.${payload}.${signature}`;
}

/** 4000자를 넘으면 자른다 — 잘렸다는 사실을 남긴다(조용히 삼키지 않는다). */
function trimNotes(text) {
  const value = String(text == null ? '' : text).trim();
  if (value.length <= MAX_WHATS_NEW) return value;
  const suffix = '\n…(줄임)';
  return value.slice(0, MAX_WHATS_NEW - suffix.length) + suffix;
}

/**
 * 어떤 로케일에 무엇을 할지. 이미 있으면 고치고(PATCH), 하나도 없으면 만든다(POST).
 * 여러 로케일이 있으면 **전부** 같은 내용으로 맞춘다 — 언어마다 다른 설명을 만들 재료가 없다.
 * @param {{id:string, attributes?:{locale?:string}}[]} existing
 */
function planLocalizations(existing, fallbackLocale = 'ko') {
  const rows = Array.isArray(existing) ? existing.filter((r) => r && r.id) : [];
  if (rows.length) return rows.map((r) => ({ op: 'PATCH', id: r.id, locale: r.attributes?.locale ?? '' }));
  return [{ op: 'POST', id: null, locale: fallbackLocale }];
}

/** @param {{fetchImpl?:typeof fetch, token:string}} deps */
function client({ fetchImpl = fetch, token }) {
  return async function call(method, path, body) {
    const res = await fetchImpl(`${API}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        ...(body ? { 'content-type': 'application/json' } : {})
      },
      ...(body ? { body: JSON.stringify(body) } : {})
    });
    if (res.status === 204) return null;
    const text = await res.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch (_) { /* 본문이 JSON이 아닐 수 있다 */ }
    if (!res.ok) {
      // ⚠️ 오류 본문을 그대로 던지지 않는다 — 토큰이 섞여 로그에 남을 수 있다.
      const detail = json?.errors?.[0]?.detail || json?.errors?.[0]?.title || '';
      throw new Error(`${method} ${path} → ${res.status}${detail ? ` (${detail})` : ''}`);
    }
    return json;
  };
}

/** 빌드가 처리될 때까지 기다린다. 시간이 다 되면 null — 실패가 아니라 '아직'이다. */
async function waitForBuild(call, { appId, buildNumber, sleep, timeoutMs = POLL_TIMEOUT_MS, now = () => Date.now() }) {
  const deadline = now() + timeoutMs;
  for (;;) {
    const query = `/builds?filter[app]=${appId}&filter[version]=${encodeURIComponent(buildNumber)}&limit=1`;
    const found = (await call('GET', query))?.data?.[0];
    if (found) return found;
    if (now() >= deadline) return null;
    await sleep(POLL_INTERVAL_MS);
  }
}

async function main() {
  const env = process.env;
  const missing = ['APPSTORE_ISSUER_ID', 'APPSTORE_KEY_ID', 'APPSTORE_PRIVATE_KEY_PATH', 'TC_BUILD_NUMBER']
    .filter((k) => !env[k]);
  if (missing.length) throw new Error(`환경변수가 없습니다: ${missing.join(', ')}`);

  const notes = trimNotes(env.TC_WHATS_NEW);
  if (!notes) {
    console.log('테스트할 내용이 비어 있어 건너뜁니다.');
    return;
  }

  const token = makeToken({
    issuerId: env.APPSTORE_ISSUER_ID,
    keyId: env.APPSTORE_KEY_ID,
    privateKey: fs.readFileSync(resolvePath(env.APPSTORE_PRIVATE_KEY_PATH), 'utf8')
  });
  const call = client({ token });

  const app = (await call('GET', `/apps?filter[bundleId]=${encodeURIComponent(BUNDLE_ID)}&limit=1`))?.data?.[0];
  if (!app) throw new Error(`App Store Connect에 ${BUNDLE_ID} 앱이 없습니다`);

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const build = await waitForBuild(call, { appId: app.id, buildNumber: env.TC_BUILD_NUMBER, sleep });
  if (!build) {
    console.log(`빌드 ${env.TC_BUILD_NUMBER}이(가) 아직 처리 중입니다 — 테스트할 내용은 나중에 직접 넣어야 합니다.`);
    return;
  }

  const existing = (await call('GET', `/builds/${build.id}/betaBuildLocalizations`))?.data ?? [];
  for (const step of planLocalizations(existing)) {
    if (step.op === 'PATCH') {
      await call('PATCH', `/betaBuildLocalizations/${step.id}`, {
        data: { type: 'betaBuildLocalizations', id: step.id, attributes: { whatsNew: notes } }
      });
    } else {
      await call('POST', '/betaBuildLocalizations', {
        data: {
          type: 'betaBuildLocalizations',
          attributes: { locale: step.locale, whatsNew: notes },
          relationships: { build: { data: { type: 'builds', id: build.id } } }
        }
      });
    }
    console.log(`테스트할 내용을 넣었습니다 (${step.locale || '기본'}).`);
  }
}

module.exports = { makeToken, trimNotes, planLocalizations, waitForBuild, resolvePath, _MAX_WHATS_NEW: MAX_WHATS_NEW };

if (require.main === module) {
  main().catch((error) => {
    // 업로드는 이미 성공했다. 여기서 죽어도 빌드는 산다 — 워크플로가 이 단계를 실패로 세지 않는다.
    console.error(`테스트할 내용을 넣지 못했습니다: ${error.message}`);
    process.exitCode = 1;
  });
}
