// With J 이야기 제작 스크립트 — 낭독 표기·요청 나누기·MP3 길이·원고 검사 (scripts/stories/build-stories.js)
const test = require('node:test');
const assert = require('node:assert/strict');
const B = require('../scripts/stories/build-stories.js');

test('연도·세기는 한자어로 풀어 넘긴다 — 고유어 수(44개)는 건드리지 않는다', () => {
  assert.equal(B.sinoKorean(1929), '천구백이십구');
  assert.equal(B.sinoKorean(1482), '천사백팔십이');
  assert.equal(B.sinoKorean(2010), '이천십');
  assert.equal(B.sinoKorean(11), '십일');
  assert.equal(B.spokenText('1929년 박람회 · 14세기 궁전 · 44개의 부조'), '천구백이십구 년 박람회 · 십사 세기 궁전 · 44개의 부조');
});

test('요청은 문단을 지키며 나누고, 문단 사이에 쉼을 넣는다', () => {
  const para = '가'.repeat(700);   // 2100바이트
  const parts = B.chunks([para, para, para]);
  assert.equal(parts.length, 2);
  assert.ok(parts.every((p) => Buffer.byteLength(p, 'utf8') <= 4500));
  assert.match(parts[0], /\[pause long\]/);
  assert.throws(() => B.chunks(['가'.repeat(1600)]), /너무 깁니다/);
});

test('MP3 길이는 프레임을 세어 잰다', () => {
  // MPEG-2 Layer III · 24kHz · 32kbps 프레임(576샘플 = 0.024초) 100개
  const header = Buffer.from([0xff, 0xf3, 0x44, 0xc4]);
  const len = Math.floor((576 / 8) * 32 * 1000 / 24000);
  const frame = Buffer.concat([header, Buffer.alloc(len - 4)]);
  const sec = B.mp3Seconds(Buffer.concat(Array(100).fill(frame)));
  assert.ok(Math.abs(sec - 2.4) < 0.001, String(sec));
});

test('원고 검사는 소리 내 읽힐 출처 ID·괄호와 빈 출처를 잡는다', () => {
  const base = { file: 'x.json', id: 'seville-x', kind: 'PLACE', lat: 1, lng: 1, radiusM: 100, sources: { P01: { title: 't', url: 'https://a.example/' } } };
  const text = '이 문장은 충분히 긴 원고입니다. '.repeat(8);
  assert.deepEqual(B.check([{ ...base, tracks: [{ id: 'core', role: 'CORE', title: 't', text, sources: ['P01'] }] }]), []);
  const bad = B.check([{ ...base, tracks: [{ id: 'core', role: 'CORE', title: 't', text: text + ' (P01)', sources: [] }] }]);
  assert.ok(bad.some((e) => /출처 ID·괄호/.test(e)));
  assert.ok(bad.some((e) => /출처가 하나도/.test(e)));
});

test('검수 표시는 확인하지 못한 사실마다 처리(뺐음·단정 안 함)가 적혀 있어야 한다', () => {
  const text = '이 문장은 충분히 긴 원고입니다. '.repeat(8);
  const place = (fc) => ({ file: 'x.json', id: 'seville-x', kind: 'PLACE', lat: 1, lng: 1, radiusM: 100, reviewedAt: '2026-10-23',
    sources: { P01: { title: 't', url: 'https://a.example/' } }, factCheck: [fc],
    tracks: [{ id: 'core', role: 'CORE', title: 't', text, sources: ['P01'] }] });
  assert.ok(B.check([place({ claim: '다리 개수', status: 'UNCERTAIN' })]).some((e) => /처리\(resolution/.test(e)));
  assert.deepEqual(B.check([place({ claim: '다리 개수', status: 'UNCERTAIN', resolution: 'OMITTED' })]), []);
  assert.deepEqual(B.check([place({ claim: '회랑 시기', status: 'UNCERTAIN', resolution: 'HEDGED' })]), []);
  assert.ok(B.check([place({ claim: '회랑 시기', status: 'UNCERTAIN', resolution: 'CONFIRMED' })]).length);
});

test('저장소의 원고는 검사를 통과한다', () => {
  assert.deepEqual(B.check(B.loadPlaces()), []);
});
