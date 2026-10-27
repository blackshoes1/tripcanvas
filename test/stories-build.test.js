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

test('현지어 표지는 한글 음역으로 읽고 조사는 받침에 맞춘다 — 표지와 맞춰 보라는 원고라 번역하지 않는다', () => {
  assert.equal(B.spokenText('Tumba de Colón을 찾습니다.'), '툼바 데 콜론을 찾습니다.');
  assert.equal(B.spokenText('Coro를 찾습니다'), '코로를 찾습니다');
  assert.equal(B.spokenText('Sacristía Mayor라는 이름과'), '사크리스티아 마요르라는 이름과');
  assert.equal(B.spokenText('Sacristía de los Cálices라는 이름'), '사크리스티아 데 로스 칼리세스라는 이름');
  assert.equal(B.spokenText('Capilla Virgen de la Antigua를'), '카피야 비르헨 데 라 안티구아를');
  assert.equal(B.spokenText('Sala Capitular로 이어집니다'), '살라 카피툴라르로 이어집니다');
  assert.equal(B.spokenText('Capilla San Antonio로'), '카피야 산안토니오로');
  assert.equal(B.spokenText('선택 장소인 San Andrés에 있습니다'), '선택 장소인 산안드레스에 있습니다');
  // 받침이 다른 이름으로 바뀌어도 조사가 따라온다
  assert.equal(B.withJosa('예배당', '를'), '예배당을');
  assert.equal(B.withJosa('기념묘', '을'), '기념묘를');
  assert.equal(B.withJosa('대성물실', '라는'), '대성물실이라는');
  assert.equal(B.withJosa('참사회실', '으로'), '참사회실로');
  assert.equal(B.withJosa('정원', '로'), '정원으로');
});

test('트랙 번호는 횟수로 들리지 않게 읽는다 — 날짜·세는 말은 그대로', () => {
  assert.equal(B.spokenText('본당에서 04번을 듣습니다.'), '본당에서 네 번째 트랙을 듣습니다.');
  assert.equal(B.spokenText('제단 장식이 05번의 대상입니다.'), '제단 장식이 다섯 번째 트랙의 대상입니다.');
  assert.equal(B.spokenText('기본 코스는 09 참사회실로 이어집니다.'), '기본 코스는 9번 참사회실로 이어집니다.');
  assert.equal(B.spokenText('기본 코스는 11 산안토니오로'), '기본 코스는 11번 산안토니오로');
  assert.equal(B.spokenText('세 번 듣고 3번을 더 들었다'), '세 번 듣고 3번을 더 들었다');   // 한 자리는 횟수일 수 있다
  assert.equal(B.spokenText('1월 20일 · 알폰소 13세 · 80킬로미터 · 에피소드 2에서'), '1월 20일 · 알폰소 13세 · 80킬로미터 · 에피소드 2에서');
  // 저장소의 원고에는 합성에 넣을 로마자가 남지 않고, '다음 이동:' 라벨도 읽지 않는다
  for (const p of B.loadPlaces()) for (const t of p.tracks) {
    const spoken = B.spokenText(t.text);
    assert.doesNotMatch(spoken, /[A-Za-z]/, `${p.id}/${t.id}`);
    assert.doesNotMatch(spoken, /다음 이동|이제 다음 장소로 갑니다\. 마지막/, `${p.id}/${t.id}`);
  }
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
