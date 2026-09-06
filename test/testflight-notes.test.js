const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const { makeToken, trimNotes, planLocalizations, waitForBuild, _MAX_WHATS_NEW } = require('../scripts/testflight-notes.js');

// 여기서 지키는 것: **빌드가 올라갔는데 설명이 비어 있지 않게** 한다.
// 그리고 이 단계가 실패해도 업로드를 되돌리지 않는다(빌드는 이미 산다).

test('JWT: Apple이 요구하는 모양 — ES256 · kid · 20분 미만 · appstoreconnect-v1', () => {
  const { privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const pem = privateKey.export({ type: 'pkcs8', format: 'pem' });
  const now = Date.UTC(2026, 8, 6, 0, 0, 0);
  const token = makeToken({ issuerId: 'issuer-1', keyId: 'KEY123', privateKey: pem, now });

  const [head, body, sig] = token.split('.');
  const header = JSON.parse(Buffer.from(head, 'base64url'));
  const payload = JSON.parse(Buffer.from(body, 'base64url'));

  assert.equal(header.alg, 'ES256');
  assert.equal(header.kid, 'KEY123');
  assert.equal(payload.iss, 'issuer-1');
  assert.equal(payload.aud, 'appstoreconnect-v1');
  assert.ok(payload.exp - payload.iat < 20 * 60, 'Apple 상한은 20분이다');
  // JOSE 서명은 r||s 64바이트다. DER로 나가면 Apple이 401로 거절한다.
  assert.equal(Buffer.from(sig, 'base64url').length, 64);
});

test('테스트할 내용: 4000자를 넘으면 자르고, 잘렸다고 말한다', () => {
  assert.equal(trimNotes('  바뀐 것  '), '바뀐 것');
  assert.equal(trimNotes(null), '');
  assert.equal(trimNotes(undefined), '');

  const long = trimNotes('가'.repeat(_MAX_WHATS_NEW + 500));
  assert.ok(long.length <= _MAX_WHATS_NEW, 'App Store Connect 상한을 넘기면 422로 거절당한다');
  assert.match(long, /줄임/, '조용히 삼키지 않는다');
});

test('로케일: 있으면 전부 고치고, 하나도 없으면 만든다', () => {
  assert.deepEqual(
    planLocalizations([{ id: 'l1', attributes: { locale: 'ko' } }, { id: 'l2', attributes: { locale: 'en-US' } }]),
    [{ op: 'PATCH', id: 'l1', locale: 'ko' }, { op: 'PATCH', id: 'l2', locale: 'en-US' }]);

  assert.deepEqual(planLocalizations([]), [{ op: 'POST', id: null, locale: 'ko' }]);
  assert.deepEqual(planLocalizations(null), [{ op: 'POST', id: null, locale: 'ko' }]);
});

test('대기: 처리 중이면 다시 묻고, 나타나면 그 빌드를 쓴다', async () => {
  let calls = 0;
  const call = async () => ({ data: ++calls < 3 ? [] : [{ id: 'b9' }] });
  const build = await waitForBuild(call, {
    appId: 'a1', buildNumber: '9', sleep: async () => {}, now: () => 0, timeoutMs: 60_000
  });
  assert.equal(build.id, 'b9');
  assert.equal(calls, 3);
});

test('대기: 시간이 다 되면 null — 실패가 아니라 "아직"이다', async () => {
  let clock = 0;
  const build = await waitForBuild(async () => ({ data: [] }), {
    appId: 'a1', buildNumber: '9', sleep: async () => { clock += 30_000; }, now: () => clock, timeoutMs: 60_000
  });
  assert.equal(build, null, '여기서 던지면 업로드가 성공했는데 워크플로가 빨개진다');
});
