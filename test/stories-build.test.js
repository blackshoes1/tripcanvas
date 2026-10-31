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

test('요청은 문장 하나씩 — 문단을 지키고, 쉼표 뒤에만 짧은 쉼 표시를 넣는다', () => {
  const plan = B.sentencePlan('운하 앞, 광장 가운데로 나오세요. 두 탑을 보세요!\n\n카스티야, 레온, 아라곤, 나바라를 나타냅니다.\n줄만 바뀐 문장도 같은 문단입니다?');
  assert.deepEqual(plan, [
    ['운하 앞, [pause short] 광장 가운데로 나오세요.', '두 탑을 보세요!'],
    ['카스티야, [pause short] 레온, [pause short] 아라곤, [pause short] 나바라를 나타냅니다.', '줄만 바뀐 문장도 같은 문단입니다?']
  ]);
  // 숫자의 점·쉼표(천 단위)는 문장 경계도 쉼도 아니다
  assert.deepEqual(B.sentencePlan('높이는 97.5미터, 계단은 1,200개입니다.'), [['높이는 97.5미터, [pause short] 계단은 1,200개입니다.']]);
  assert.throws(() => B.sentencePlan('가'.repeat(1600) + '.'), /너무 깁니다/);
  // 저장소의 원고는 전부 요청 한도 안이다
  for (const p of B.loadPlaces()) for (const t of p.tracks) assert.ok(B.sentencePlan(B.spokenText(t.text)).flat().length > 1, `${p.id}/${t.id}`);
});

// 합성한 소리를 흉내 낸다 — 말소리는 -12dB 안팎, '쉰' 자리의 숨소리 바닥은 -40dB, 진짜 무음은 0
const RATE = B.SAMPLE_RATE;
const voice = (sec) => Int16Array.from({ length: Math.round(RATE * sec) }, (_, i) => Math.round(8000 * Math.sin(i / 3)));
const floor = (sec) => Int16Array.from({ length: Math.round(RATE * sec) }, (_, i) => (i % 2 ? 330 : -330));
const quiet = (sec) => new Int16Array(Math.round(RATE * sec));
const cat = (...xs) => { const out = new Int16Array(xs.reduce((a, x) => a + x.length, 0)); let o = 0; for (const x of xs) { out.set(x, o); o += x.length; } return out; };
const secs = (pcm) => pcm.length / RATE;

test('WAV(LINEAR16)에서 소리 표본을 꺼낸다', () => {
  const pcm = Int16Array.from([1, -2, 300, -32768]);
  const data = Buffer.from(pcm.buffer);
  const head = Buffer.alloc(44);
  head.write('RIFF', 0, 'latin1'); head.writeUInt32LE(36 + data.length, 4); head.write('WAVE', 8, 'latin1');
  head.write('fmt ', 12, 'latin1'); head.writeUInt32LE(16, 16); head.writeUInt16LE(1, 20); head.writeUInt16LE(1, 22);
  head.writeUInt32LE(RATE, 24); head.writeUInt32LE(RATE * 2, 28); head.writeUInt16LE(2, 32); head.writeUInt16LE(16, 34);
  head.write('data', 36, 'latin1'); head.writeUInt32LE(data.length, 40);
  assert.deepEqual([...B.wavSamples(Buffer.concat([head, data]))], [1, -2, 300, -32768]);
  assert.throws(() => B.wavSamples(head.subarray(0, 36)), /data/);
});

test('문장 앞뒤 쉼은 걷되 첫소리·끝소리 꼬리는 남긴다 — 숨소리 바닥(-40dB)은 걷지 않는다', () => {
  const trimmed = B.trimSilence(cat(quiet(0.5), voice(2), quiet(0.8)), RATE);
  assert.ok(Math.abs(secs(trimmed) - (2 + 0.04 + 0.15)) < 0.011, String(secs(trimmed)));
  assert.equal(B.trimSilence(quiet(1), RATE).length, 0);
  assert.equal(secs(B.trimSilence(cat(floor(0.3), voice(1)), RATE)), 1.3);
});

test('문장 사이·문단 사이 쉼은 엔진이 아니라 정한 길이의 무음이다', () => {
  const s = voice(1);
  const pcm = B.joinTrack([[s, s], [s]], RATE);
  const { lead, sentence, paragraph, tail } = B.PAUSE;
  assert.ok(sentence >= 0.5 && paragraph >= 1.0 && paragraph > sentence);
  assert.equal(secs(pcm), +(lead + 1 + sentence + 1 + paragraph + 1 + tail).toFixed(6));
  assert.deepEqual(B.innerPauses(pcm, RATE), [sentence, paragraph]);
  // 문장 끝에 숨소리 꼬리(-40dB)가 남아 있어도 들리는 쉼은 같은 길이다 — 꼬리만큼 무음을 덜 넣는다
  const tailed = cat(floor(0.12), voice(1), floor(0.3));
  const near = (xs, ys) => xs.length === ys.length && xs.every((x, i) => Math.abs(x - ys[i]) < 0.011);
  const joined = B.innerPauses(B.joinTrack([[tailed, tailed], [tailed]], RATE), RATE);
  assert.ok(near(joined, [sentence, paragraph]), JSON.stringify(joined));
});

test('문장 안에서 길게 쉬거나 늘어진 소리는 들이지 않는다 — 대성당 1번의 7초 쉼, 13번의 늘어진 낭독', () => {
  const markup = '고야의 성녀 후스타와 루피나, [pause short] 그 이야기를 지금부터 들려 드립니다.';   // 29자
  assert.equal(B.sentenceProblem(markup, cat(voice(2.4), floor(0.4), voice(2.4)), RATE), null);   // 쉼표 자리 0.4초
  // 숨소리 바닥(-40dB)이 깔린 7초도 쉼이다 — -45dB로 보면 놓친다
  assert.match(B.sentenceProblem(markup, cat(voice(2.4), floor(7.2), voice(2.4)), RATE), /7\.2초를 쉽니다/);
  assert.match(B.sentenceProblem(markup, voice(9), RATE), /말 빠르기 3\.22/);
  assert.match(B.sentenceProblem(markup, voice(2.5), RATE), /말 빠르기 11\.60/);
  assert.match(B.sentenceProblem(markup, quiet(0), RATE), /소리가 없습니다/);
  assert.equal(B.sentenceProblem('네, [pause short] 보세요.', voice(0.5), RATE), null);   // 짧은 문장은 빠르기를 재지 않는다
});

test('MP3 길이는 프레임을 세어 잰다', () => {
  // MPEG-2 Layer III · 24kHz · 32kbps 프레임(576샘플 = 0.024초) 100개
  const header = Buffer.from([0xff, 0xf3, 0x44, 0xc4]);
  const len = Math.floor((576 / 8) * 32 * 1000 / 24000);
  const frame = Buffer.concat([header, Buffer.alloc(len - 4)]);
  const sec = B.mp3Seconds(Buffer.concat(Array(100).fill(frame)));
  assert.ok(Math.abs(sec - 2.4) < 0.001, String(sec));
});

test('말 빠르기는 쉼 표시·공백을 뺀 글자를 센다', () => {
  assert.equal(B.speechRate('가나, [pause short] 다라 마바.', 2).toFixed(2), '4.00');   // '가나,다라마바.' 8자
  const [lo, hi] = B.RATE_BAND;
  assert.ok(lo > 4 && lo < 5 && hi > 7, `${lo}–${hi}`);   // Despina 1.0배의 문장은 4.7~7.5자/초로 나왔다
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

test('이미 만든 음성(audio)은 그 경로를 쓰고, 저장소의 그 지역 폴더에 있어야 한다 — 합성하지 않으니 없으면 만들 길이 없다', () => {
  assert.equal(B.trackSrc({ region: 'seville', id: 'seville-alcazar' }, { id: 'more' }), 'seville/alcazar-more.mp3');
  assert.equal(B.trackSrc({ region: 'mallorca', id: 'mallorca-soller-train-palma' }, { id: 'core', audio: 'mallorca/soller-train-core.mp3' }), 'mallorca/soller-train-core.mp3');
  const text = '이 문장은 충분히 긴 원고입니다. '.repeat(8);
  const place = (audio, extra = {}) => ({ file: 'x.json', region: 'mallorca', id: 'mallorca-x', kind: 'PLACE', lat: 1, lng: 1, radiusM: 100,
    voice: { engine: 'Gemini', name: 'Sulafat' }, sources: { P01: { title: 't', url: 'https://a.example/' } },
    tracks: [{ id: 'core', role: 'CORE', title: 't', text, sources: ['P01'], audio, audioText: B.textHash(text) }], ...extra });
  assert.deepEqual(B.check([place('mallorca/bellver-core.mp3')]), []);
  assert.ok(B.check([place('mallorca/none-core.mp3')]).some((e) => /stories\/mallorca\/none-core\.mp3가 없습니다/.test(e)));
  assert.ok(B.check([place('seville/alcazar-core.mp3')]).some((e) => /mallorca\/ 안의/.test(e)));
  assert.ok(B.check([place('mallorca/-x.mp3')]).some((e) => /mallorca\/ 안의/.test(e)));   // stories.js SRC_RE가 버리는 이름
  // 목소리를 안 적으면 카탈로그가 Chirp 3 HD로 적는다
  assert.ok(B.check([place('mallorca/bellver-core.mp3', { voice: undefined })]).some((e) => /목소리\(voice/.test(e)));
  // 마요르카는 지역 폴더를 읽고, 원자료 폴더(source/cathedral)는 원고로 읽지 않는다
  const ids = B.loadPlaces().map((p) => p.id);
  assert.ok(ids.includes('mallorca-palma-cathedral') && ids.includes('seville-cathedral'));
  assert.ok(!B.loadPlaces().some((p) => p.region === 'cathedral'));
});

test('원고를 고치면 이미 만든 음성은 검사를 통과하지 못한다 — 고친 사실이 앱에 닿지 않은 채 배포되지 않게', () => {
  const text = '이 문장은 충분히 긴 원고입니다. '.repeat(8);
  const place = (t) => ({ file: 'x.json', region: 'mallorca', id: 'mallorca-x', kind: 'PLACE', lat: 1, lng: 1, radiusM: 100,
    voice: { engine: 'Gemini', name: 'Sulafat' }, sources: { P01: { title: 't', url: 'https://a.example/' } },
    tracks: [{ id: 'core', role: 'CORE', title: 't', text: t, sources: ['P01'], audio: 'mallorca/bellver-core.mp3', audioText: B.textHash(text) }] });
  assert.deepEqual(B.check([place(text)]), []);
  const errors = B.check([place(text.replace('충분히', '아주'))]);
  assert.ok(errors.some((e) => /음성\(audio\)을 만든 원고와 다릅니다/.test(e)));
  // 저장소의 이미 만든 음성은 모두 지금 원고로 만든 것이다
  for (const p of B.loadPlaces()) for (const t of p.tracks) if (t.audio) assert.equal(t.audioText, B.textHash(t.text), `${p.id}/${t.id}`);
});

test('같은 이야기를 다른 자리에 붙이면 원고·음성·출처·검수를 원본 하나에서 물려받는다', () => {
  const text = '이 문장은 충분히 긴 원고입니다. '.repeat(8);
  const original = { file: 'a.json', region: 'mallorca', id: 'mallorca-a', kind: 'PLACE', lat: 1, lng: 1, radiusM: 100, reviewedAt: '2026-10-31',
    voice: { engine: 'Gemini', name: 'Sulafat' }, sources: { P01: { title: 't', url: 'https://a.example/' } }, factCheck: [],
    tracks: [{ id: 'core', role: 'CORE', title: 't', text, sources: ['P01'], audio: 'mallorca/bellver-core.mp3', audioText: B.textHash(text) }] };
  const copy = { file: 'b.json', region: 'mallorca', id: 'mallorca-b', kind: 'PLACE', lat: 2, lng: 2, radiusM: 100, sameStoryAs: 'mallorca-a' };
  const [, b] = B.resolveSameStory([{ ...original }, { ...copy }]);
  assert.equal(b.tracks, original.tracks);
  assert.equal(b.reviewedAt, '2026-10-31');
  assert.deepEqual(B.check([original, b]), []);
  // 원본의 검수를 지우면 복사본도 검수 표시가 없어 카탈로그에서 함께 빠진다
  const { reviewedAt: _gone, ...unreviewed } = original;
  assert.equal(B.resolveSameStory([unreviewed, { ...copy, reviewedAt: '2026-10-31' }])[1].reviewedAt, undefined);
  // 원본이 없거나 원본도 다른 이야기를 가리키면 검사가 말한다
  assert.ok(B.check(B.resolveSameStory([{ ...copy, sameStoryAs: 'mallorca-none' }])).some((e) => /가리키는 원본이 없거나/.test(e)));
  assert.ok(B.check(B.resolveSameStory([{ ...original, sameStoryAs: 'mallorca-b' }, { ...copy }])).some((e) => /원본도 다른 이야기/.test(e)));
  // 배포되는 팔마 종점은 소예르역의 것을 그대로 쓴다
  const places = B.loadPlaces();
  const palma = places.find((p) => p.id === 'mallorca-soller-train-palma');
  const soller = places.find((p) => p.id === 'mallorca-soller-train');
  assert.equal(palma.tracks, soller.tracks);
  assert.equal(palma.sources, soller.sources);
});

test('출처 ID는 장소끼리 다른 것을 가리키지 않는다 — 카탈로그에서는 ID 하나로 모인다', () => {
  const text = '이 문장은 충분히 긴 원고입니다. '.repeat(8);
  const place = (id, title) => ({ file: `${id}.json`, id: `seville-${id}`, kind: 'PLACE', lat: 1, lng: 1, radiusM: 100,
    sources: { P01: { title, url: 'https://a.example/' } }, tracks: [{ id: 'core', role: 'CORE', title: 't', text, sources: ['P01'] }] });
  assert.deepEqual(B.check([place('a', '같은 제목'), place('b', '같은 제목')]), []);
  assert.ok(B.check([place('a', '제목 하나'), place('b', '제목 둘')]).some((e) => /출처 P01가 a\.json의 P01와 다릅니다/.test(e)));
});
