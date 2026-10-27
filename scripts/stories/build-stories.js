#!/usr/bin/env node
// With J 이야기 — 원고 → 음성(MP3) → stories/catalog.json (docs/with-j-stories.md)
//
//   node scripts/stories/build-stories.js --check      원고만 검사한다(키 필요 없음 — CI·게이트용)
//   node scripts/stories/build-stories.js --draft      검수 전 원고까지 stories-draft/에 만든다(들어 보고 검수할 때)
//   node scripts/stories/build-stories.js              검수한 원고(reviewedAt)만 stories/에 만들고 카탈로그를 쓴다
//
// ⚠️ TTS 키(GOOGLE_TTS_API_KEY)는 저장소·CI에 넣지 않는다. 키가 있는 기기에서 사람이 돌린다.
// 같은 원고·같은 목소리면 다시 합성하지 않는다(build-state.json의 지문) — 무료 한도(월 100만 자)를 아낀다.
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

// ⚠️ 경로는 저장소 루트 기준이다(sync-agents.js와 같은 관례 — `__dirname`은 eslint 전역 목록에 없다). 루트에서 돌린다
const ROOT = process.cwd();
const SOURCE = path.join(ROOT, 'scripts', 'stories', 'source');
const STATE_FILE = path.join(ROOT, 'scripts', 'stories', 'build-state.json');
// 사용자가 고른 목소리(2026-10): Chirp 3 HD Despina · 보통 속도 · 문단 사이 쉼
const VOICE = { languageCode: 'ko-KR', name: 'ko-KR-Chirp3-HD-Despina' };
const AUDIO = { audioEncoding: 'MP3', speakingRate: 1.0 };
const PARAGRAPH_PAUSE = '[pause long]';
const MAX_REQUEST_BYTES = 4500;   // API 한도(5000바이트)보다 여유 있게 — 한글은 글자당 3바이트다

const DIGITS = ['', '일', '이', '삼', '사', '오', '육', '칠', '팔', '구'];
/** 한자어 수 읽기(1~9999) — '1929' → '천구백이십구'. 연도·세기를 숫자 그대로 넘기면 엔진이 읽기를 흔든다 */
function sinoKorean(n) {
  if (!Number.isInteger(n) || n < 1 || n > 9999) return String(n);
  const units = [['천', 1000], ['백', 100], ['십', 10]];
  let out = '', rest = n;
  for (const [u, v] of units) {
    const d = Math.floor(rest / v);
    if (d) out += (d === 1 ? '' : DIGITS[d]) + u;
    rest %= v;
  }
  return out + DIGITS[rest];
}

/** 낭독용 표기 — 화면 원고는 그대로 두고 합성에 넣을 글만 바꾼다(pronunciation-notes.txt) */
// 현지어 표지는 한글 음역으로 읽는다 — 원고가 'Sacristía Mayor라는 이름을 확인하세요'처럼 현장 표지와 맞춰 보라고
// 하는 자리라 '대성물실'로 번역하면 표지에 없는 이름을 찾게 된다. 음역은 본문이 이미 쓰는 표기를 따른다(라 히랄다·
// 살라 카피툴라르·사크리스티아 데 로스 칼리세스). 한국어 목소리가 로마자를 읽으면 영어도 스페인어도 아닌 소리가 난다.
// 긴 이름부터 바꾼다
const SPOKEN_NAMES = [
  ['Sacristía de los Cálices', '사크리스티아 데 로스 칼리세스'],
  ['Capilla Virgen de la Antigua', '카피야 비르헨 데 라 안티구아'],
  ['Capilla San Antonio', '카피야 산안토니오'],
  ['Capilla San Andrés', '카피야 산안드레스'],
  ['San Andrés', '산안드레스'],
  ['Patio de los Naranjos', '파티오 데 로스 나랑호스'],
  ['Tumba de Colón', '툼바 데 콜론'],
  ['Sacristía Mayor', '사크리스티아 마요르'],
  ['Retablo Mayor', '레타블로 마요르'],
  ['Sala Capitular', '살라 카피툴라르'],
  ['La Giralda', '라 히랄다'],
  ['Coro', '코로']
];

// 바꾼 이름 뒤의 조사를 그 이름의 받침에 맞춘다 — 'Tumba de Colón을'은 그대로 '툼바 데 콜론을', 'Coro를'은 '코로를',
// 'Sacristía de los Cálices라는'은 '…칼리세스라는'. 받침이 다른 이름으로 바꾸면 원문의 조사가 틀린다(검토에서 '기념묘을'이 나왔다)
const JOSA = [['을', '를'], ['이', '가'], ['은', '는'], ['과', '와'], ['이라는', '라는'], ['이라고', '라고'], ['이며', '며']];
const JOSA_RE = '(이라는|라는|이라고|라고|이며|으로|로|을|를|이|가|은|는|과|와)?';
function withJosa(ko, josa) {
  const code = ko.charCodeAt(ko.length - 1) - 0xac00;
  if (code < 0 || code > 11171) return ko + josa;
  const jong = code % 28;
  if (josa === '으로' || josa === '로') return ko + (jong === 0 || jong === 8 ? '로' : '으로');   // ㄹ 받침은 '로'
  const pair = JOSA.find(([a, b]) => josa === a || josa === b);
  return ko + (pair ? (jong ? pair[0] : pair[1]) : josa);
}

// 트랙 번호 — '04번을 듣습니다'는 '네 번(네 차례) 듣습니다'로 들린다. 원고 다른 곳처럼 '네 번째 트랙'으로 읽는다
const ORDINALS = ['', '첫', '두', '세', '네', '다섯', '여섯', '일곱', '여덟', '아홉', '열', '열한', '열두', '열세', '열네'];

function spokenText(text) {
  let s = text;
  for (const [local, ko] of SPOKEN_NAMES) {
    s = s.replace(new RegExp(local.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + JOSA_RE, 'g'),
      (_, josa) => (josa ? withJosa(ko, josa) : ko));
  }
  return s
    .replace(/(\d{1,4})년/g, (_, y) => sinoKorean(+y) + ' 년')
    .replace(/(\d{1,2})세기/g, (_, c) => sinoKorean(+c) + ' 세기')
    // 원고의 트랙 번호는 두 자리로 적혀 있다('04번') — 한 자리 '3번을'은 횟수일 수 있어 건드리지 않는다
    .replace(/(^|[^\d])(0[1-9]|1[0-4])번(을|의|이)/g, (_, pre, n, josa) => `${pre}${ORDINALS[+n]} 번째 트랙${josa}`)
    // '09 참사회실'처럼 이름 앞에 붙은 번호는 '9번 참사회실' — 0을 '공'으로 읽지 않게
    .replace(/(\s)0?(\d|1[0-4]) (?=[가-힣])/g, (m, sp, n) => `${sp}${+n}번 `);
  // ⚠️ '44개'·'3명' 같은 고유어 수는 바꾸지 않는다 — '사십사 개'는 틀린 읽기다. 엔진에 맡기고 들어서 확인한다
}

/** 문단을 지키며 요청 크기 안으로 나눈다 @returns {string[]} */
function chunks(paragraphs) {
  const out = [];
  let cur = [];
  const size = (list) => Buffer.byteLength(list.join(`\n${PARAGRAPH_PAUSE}\n`), 'utf8');
  for (const p of paragraphs) {
    if (Buffer.byteLength(p, 'utf8') > MAX_REQUEST_BYTES) throw new Error(`문단 하나가 너무 깁니다(${Buffer.byteLength(p, 'utf8')}바이트): ${p.slice(0, 40)}…`);
    if (cur.length && size([...cur, p]) > MAX_REQUEST_BYTES) { out.push(cur); cur = []; }
    cur.push(p);
  }
  if (cur.length) out.push(cur);
  return out.map((list) => list.join(`\n${PARAGRAPH_PAUSE}\n`));
}

/** MP3 프레임을 세어 길이(초)를 잰다 — MPEG-1/2/2.5 Layer III */
function mp3Seconds(buf) {
  const RATES = { 3: [44100, 48000, 32000], 2: [22050, 24000, 16000], 0: [11025, 12000, 8000] };
  const BR1 = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320];
  const BR2 = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160];
  let i = 0, sec = 0;
  if (buf.slice(0, 3).toString('latin1') === 'ID3') i = 10 + ((buf[6] & 127) << 21 | (buf[7] & 127) << 14 | (buf[8] & 127) << 7 | (buf[9] & 127));
  while (i + 4 <= buf.length) {
    if (buf[i] !== 0xff || (buf[i + 1] & 0xe0) !== 0xe0) { i++; continue; }
    const ver = (buf[i + 1] >> 3) & 3, layer = (buf[i + 1] >> 1) & 3, bri = buf[i + 2] >> 4, sri = (buf[i + 2] >> 2) & 3, pad = (buf[i + 2] >> 1) & 1;
    if (ver === 1 || layer !== 1 || bri === 0 || bri === 15 || sri === 3) { i++; continue; }
    const rate = RATES[ver][sri], kbps = (ver === 3 ? BR1 : BR2)[bri];
    const samples = ver === 3 ? 1152 : 576;
    const len = Math.floor((samples / 8) * kbps * 1000 / rate) + pad;
    if (len < 4) { i++; continue; }
    sec += samples / rate;
    i += len;
  }
  return sec;
}

const sha256 = (data) => crypto.createHash('sha256').update(data).digest('hex');

/** 원고 묶음 — source/seville/*.json. 대성당은 관람 지점 원고(narration/NN_narration.txt)를 읽어 들인다 */
function loadPlaces() {
  const dir = path.join(SOURCE, 'seville');
  const places = [];
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.json')).sort()) {
    const p = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
    for (const t of p.tracks) {
      if (t.textFile) t.text = fs.readFileSync(path.join(SOURCE, t.textFile), 'utf8');
      // '다음 이동:'은 편집용 라벨이라 읽지 않는다(pronunciation-notes.txt) — 마지막 트랙의 '마지막 트랙입니다' 앞에 '다음 장소로 갑니다'가 붙었다
      t.text = String(t.text || '').replace(/^다음 이동:\s*/m, '').trim();
    }
    places.push({ file: f, ...p });
  }
  return places;
}

/** 원고 검사 — 키 없이 돈다. 틀린 것을 모아 한 번에 말한다 */
function check(places) {
  const errors = [];
  const ids = new Set();
  for (const p of places) {
    const where = p.file;
    if (!/^[a-z0-9-]+$/.test(p.id || '')) errors.push(`${where}: id가 올바르지 않습니다`);
    if (ids.has(p.id)) errors.push(`${where}: 같은 id(${p.id})가 또 있습니다`);
    ids.add(p.id);
    if (!['PLACE', 'CITY'].includes(p.kind)) errors.push(`${where}: kind는 PLACE·CITY입니다`);
    if (!Number.isFinite(p.lat) || !Number.isFinite(p.lng) || !Number.isFinite(p.radiusM)) errors.push(`${where}: 위치·반경이 필요합니다`);
    const tids = new Set();
    for (const t of p.tracks || []) {
      const tw = `${where} › ${t.id}`;
      if (!/^[a-z0-9-]+$/.test(t.id || '') || tids.has(t.id)) errors.push(`${tw}: 트랙 id가 없거나 겹칩니다`);
      tids.add(t.id);
      if (!['CORE', 'MORE', 'STOP'].includes(t.role)) errors.push(`${tw}: role은 CORE·MORE·STOP입니다`);
      if (!t.title) errors.push(`${tw}: 제목이 없습니다`);
      if (!t.text || t.text.length < 100) errors.push(`${tw}: 원고가 비었거나 너무 짧습니다`);
      if (/S\d{2}|[A-Z]\d{2}\b|\*\*|#|\(|\)/.test(t.text || '')) errors.push(`${tw}: 원고에 출처 ID·괄호·마크다운이 섞여 있습니다 — 소리 내 읽힙니다`);
      for (const s of t.sources || []) if (!p.sources || !p.sources[s]) errors.push(`${tw}: 출처 ${s}가 sources에 없습니다`);
      if (!(t.sources || []).length) errors.push(`${tw}: 출처가 하나도 없습니다`);
      if (t.role === 'STOP' && !(t.stop && Number.isInteger(t.stop.n))) errors.push(`${tw}: 관람 지점 번호가 없습니다`);
      try { chunks(spokenText(t.text).split(/\n\s*\n/).map((x) => x.trim()).filter(Boolean)); } catch (e) { errors.push(`${tw}: ${e.message}`); }
    }
    for (const [k, v] of Object.entries(p.sources || {})) if (!/^https:\/\//.test(v.url || '')) errors.push(`${where}: 출처 ${k}의 주소가 https가 아닙니다`);
    // 확인하지 못한 사실은 검수 전에 처리를 적는다 — 본문에서 뺐거나(OMITTED) 단정하지 않게 고쳤거나(HEDGED).
    // CONFIRMED로 바꾸지 않는다: 확인하지 못한 것을 확인했다고 적는 셈이다
    for (const fc of p.factCheck || []) {
      if (p.reviewedAt && fc.status !== 'CONFIRMED' && !['OMITTED', 'HEDGED'].includes(fc.resolution))
        errors.push(`${where}: 확인되지 않은 사실(${fc.claim})의 처리(resolution: OMITTED·HEDGED)를 적지 않은 채 검수 표시가 있습니다`);
    }
  }
  return errors;
}

async function synthesize(markup, key) {
  const res = await fetch(`https://texttospeech.googleapis.com/v1/text:synthesize?key=${encodeURIComponent(key)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ input: { markup }, voice: VOICE, audioConfig: AUDIO })
  });
  if (!res.ok) throw new Error(`TTS ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return Buffer.from((await res.json()).audioContent, 'base64');
}

async function main() {
  const args = new Set(process.argv.slice(2));
  const places = loadPlaces();
  const errors = check(places);
  if (errors.length) { console.error(errors.map((e) => '✗ ' + e).join('\n')); process.exit(1); }
  const chars = places.reduce((a, p) => a + p.tracks.reduce((b, t) => b + spokenText(t.text).length, 0), 0);
  console.log(`원고 ${places.length}곳 · ${places.reduce((a, p) => a + p.tracks.length, 0)}편 · 약 ${chars.toLocaleString()}자 — 검사 통과`);
  if (args.has('--check')) return;

  const draft = args.has('--draft');
  const key = process.env.GOOGLE_TTS_API_KEY;
  if (!key) { console.error('GOOGLE_TTS_API_KEY가 없습니다. 키가 있는 기기에서 돌려 주세요.'); process.exit(2); }
  const outDir = path.join(ROOT, draft ? 'stories-draft' : 'stories');
  const state = fs.existsSync(STATE_FILE) ? JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')) : {};
  const catalog = { version: 1, updated: new Date().toISOString().slice(0, 10),
    voice: { engine: 'Google Cloud TTS Chirp 3 HD', name: VOICE.name, disclosure: 'AI 음성으로 읽었어요' }, places: [], sources: {} };
  let spent = 0;
  for (const p of places) {
    const tracks = [];
    for (const t of p.tracks) {
      const reviewedAt = t.reviewedAt || p.reviewedAt || null;
      if (!draft && !reviewedAt) continue;
      const src = `seville/${p.id.replace(/^seville-/, '')}-${t.id}.mp3`;
      const file = path.join(outDir, src);
      const spoken = spokenText(t.text);
      const fingerprint = sha256(JSON.stringify([spoken, VOICE, AUDIO, PARAGRAPH_PAUSE]));
      if (!(state[src] === fingerprint && fs.existsSync(file))) {
        const parts = [];
        for (const c of chunks(spoken.split(/\n\s*\n/).map((x) => x.trim()).filter(Boolean))) { parts.push(await synthesize(c, key)); spent += c.length; }
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, Buffer.concat(parts));
        if (!draft) state[src] = fingerprint;
        console.log(`  ♪ ${src}`);
      }
      const buf = fs.readFileSync(file);
      tracks.push({ id: t.id, role: t.role, title: t.title, src, seconds: Math.round(mp3Seconds(buf)), bytes: buf.length,
        sha256: sha256(buf), sources: t.sources, ...(t.stop ? { stop: t.stop } : {}), reviewedAt: reviewedAt || 'DRAFT' });
    }
    if (!tracks.length) continue;
    const { lat, lng, radiusM, kind, id, name, localName = '', city = '', aliases = [], placeIds = [] } = p;
    catalog.places.push({ id, kind, name, localName, city, lat, lng, radiusM, aliases, placeIds, tracks });
    for (const s of new Set(tracks.flatMap((t) => t.sources))) catalog.sources[s] = { title: p.sources[s].title, url: p.sources[s].url };
  }
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'catalog.json'), JSON.stringify(catalog, null, 2) + '\n');
  if (!draft) fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2) + '\n');
  console.log(`${draft ? '검수용 ' : ''}카탈로그: ${catalog.places.length}곳 · 이번에 합성한 글자 ${spent.toLocaleString()}자 → ${path.relative(ROOT, outDir)}/`);
}

module.exports = { sinoKorean, spokenText, withJosa, chunks, mp3Seconds, check, loadPlaces };
if (require.main === module) main().catch((e) => { console.error(e.message); process.exit(1); });
