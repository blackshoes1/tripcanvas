#!/usr/bin/env node
// With J 이야기 — 원고 → 음성(MP3) → stories/catalog.json (docs/with-j-stories.md)
//
//   node scripts/stories/build-stories.js --check      원고만 검사한다(키 필요 없음 — CI·게이트용)
//   node scripts/stories/build-stories.js --draft      검수 전 원고까지 stories-draft/에 만든다(들어 보고 검수할 때)
//   node scripts/stories/build-stories.js              검수한 원고(reviewedAt)만 stories/에 만들고 카탈로그를 쓴다
//
// ⚠️ TTS 키(GOOGLE_TTS_API_KEY)는 저장소·CI에 넣지 않는다. 키가 있는 기기에서 사람이 돌린다. 합성에는 ffmpeg가 필요하다(MP3로 굳힌다).
// 같은 원고·같은 목소리면 다시 합성하지 않는다(build-state.json의 지문) — 무료 한도(월 100만 자)를 아낀다.
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');

// ⚠️ 경로는 저장소 루트 기준이다(sync-agents.js와 같은 관례 — `__dirname`은 eslint 전역 목록에 없다). 루트에서 돌린다
const ROOT = process.cwd();
const SOURCE = path.join(ROOT, 'scripts', 'stories', 'source');
const STATE_FILE = path.join(ROOT, 'scripts', 'stories', 'build-state.json');
// 사용자가 고른 목소리(2026-10): Chirp 3 HD Despina · 보통 속도
const VOICE = { languageCode: 'ko-KR', name: 'ko-KR-Chirp3-HD-Despina' };
const SAMPLE_RATE = 24000;
const AUDIO = { audioEncoding: 'LINEAR16', sampleRateHertz: SAMPLE_RATE, speakingRate: 1.0 };
// 쉼은 엔진에 맡기지 않는다(2026-10-28 "띄어읽기가 거의 안 된다"). 트랙을 통째로 보내면 Chirp 3 HD가 문단 사이 [pause long]을
// 빼먹기도 하고(스페인 광장 72초에 0.7초 넘는 쉼이 한 번도 없었다) 7초로 늘리기도 했으며(대성당 1번), 쉼표는 그냥 지나갔다
// ('카스티야, 레온, 아라곤, 나바라'가 8초 동안 쉼 없이). 그래서 문장마다 따로 합성하고, 쉼표 뒤에는 [pause short]를 넣고
// (한 문장 안에서는 0.2~0.35초로 지켜졌다), 문장·문단 사이는 무음을 직접 끼운다 — 길이를 초로 정해 두면 들을 때마다 같다
const PAUSE = { lead: 0.2, sentence: 0.6, paragraph: 1.2, tail: 0.6 };
const COMMA_PAUSE = '[pause short]';
const MP3_BITRATE = '48k';
const MAKE_VERSION = 2;   // 소리 처리(다듬기·잇기·굳히기)를 바꾸면 올린다 — 지문에 들어가 모든 트랙을 다시 만든다
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
  ['Patio de los Naranjos', '파티오 데 로스 나란호스'],
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

/** 낭독 글 → 문단마다 문장 요청(markup) — 빈 줄이 문단, 마침표·물음표·느낌표 뒤 공백이 문장 경계다 @returns {string[][]} */
function sentencePlan(spoken) {
  return spoken.split(/\n\s*\n/).map((p) => p.replace(/\s+/g, ' ').trim()).filter(Boolean).map((p) => p.split(/(?<=[.?!])\s+/).map((s) => {
    const markup = s.replace(/,\s+/g, `, ${COMMA_PAUSE} `);
    if (Buffer.byteLength(markup, 'utf8') > MAX_REQUEST_BYTES) throw new Error(`문장 하나가 너무 깁니다(${Buffer.byteLength(markup, 'utf8')}바이트): ${s.slice(0, 40)}…`);
    return markup;
  }));
}

// ── 소리(16비트 PCM) — 쉼을 재고 다듬고 끼운다 ──
const FRAME_SEC = 0.01;
// 10ms 평균 세기로 가른다. 앞뒤를 걷을 때는 낮게(-45dB — 첫소리·끝소리 꼬리를 남긴다), 쉼을 잴 때는 높게(-35dB) 본다:
// 엔진이 '쉰' 자리에도 숨소리 같은 바닥 소리가 -45~-35dB로 깔려 있어 낮게 보면 대성당 1번의 7초 쉼도 쉼으로 안 잡힌다
const QUIET_DB = -45;
const PAUSE_DB = -35;

/** WAV(LINEAR16)의 data 묶음 @returns {Int16Array} */
function wavSamples(buf) {
  for (let i = 12; i + 8 <= buf.length;) {
    const id = buf.toString('latin1', i, i + 4), len = buf.readUInt32LE(i + 4);
    if (id === 'data') {
      const data = Buffer.from(buf.subarray(i + 8, i + 8 + len));   // 짝수 위치에서 시작하는 사본이어야 Int16Array로 본다
      return new Int16Array(data.buffer, data.byteOffset, data.length >> 1);
    }
    i += 8 + len + (len & 1);
  }
  throw new Error('WAV에 소리(data)가 없습니다');
}

/** 10ms마다 평균 세기(dBFS) @returns {number[]} */
function frameLevels(pcm, rate) {
  const n = Math.round(rate * FRAME_SEC), out = [];
  for (let i = 0; i < pcm.length; i += n) {
    let sum = 0;
    const end = Math.min(pcm.length, i + n);
    for (let j = i; j < end; j++) sum += pcm[j] * pcm[j];
    out.push(20 * Math.log10(Math.sqrt(sum / (end - i)) / 32768 + 1e-9));
  }
  return out;
}

/** 앞뒤 쉼을 걷는다 — 말소리 앞 40ms·뒤 150ms는 남긴다(첫소리·끝소리 꼬리를 자르지 않게). 소리가 없으면 빈 배열 */
function trimSilence(pcm, rate) {
  const lv = frameLevels(pcm, rate), n = Math.round(rate * FRAME_SEC);
  const first = lv.findIndex((x) => x > QUIET_DB);
  if (first < 0) return pcm.subarray(0, 0);
  let last = lv.length - 1;
  while (lv[last] <= QUIET_DB) last--;
  return pcm.subarray(Math.max(0, (first - 4) * n), Math.min(pcm.length, (last + 16) * n));
}

/** 소리 사이의 쉼 길이(초) — 앞뒤 쉼은 세지 않는다 @returns {number[]} */
function innerPauses(pcm, rate) {
  const out = [];
  let run = 0, heard = false;
  for (const x of frameLevels(pcm, rate)) {
    if (x <= PAUSE_DB) { run++; continue; }
    if (heard && run) out.push(run * FRAME_SEC);
    heard = true;
    run = 0;
  }
  return out;
}

/** 앞뒤 끝의 조용한 길이(초, -35dB 아래) — 걷고 남긴 숨소리·끝소리 꼬리도 귀에는 쉼이다 */
function edgeQuiet(pcm, rate) {
  const lv = frameLevels(pcm, rate);
  let head = 0, tail = 0;
  while (head < lv.length && lv[head] <= PAUSE_DB) head++;
  while (tail < lv.length - head && lv[lv.length - 1 - tail] <= PAUSE_DB) tail++;
  return { head: head * FRAME_SEC, tail: tail * FRAME_SEC };
}

/** 문단마다 문장 소리를 잇는다 — 사이의 '들리는 쉼'(-35dB 아래)이 PAUSE가 되게 무음을 채운다.
 *  고정 무음만 끼우면 문장마다 다른 끝소리 꼬리가 더해져 문장 사이가 0.7~1.1초, 문단 사이가 2초 넘게 흔들렸다 @returns {Int16Array} */
function joinTrack(paragraphs, rate) {
  const gap = (sec) => new Int16Array(Math.max(0, Math.round(rate * sec)));
  const parts = [];
  let tail = 0, first = true;
  paragraphs.forEach((sentences) => sentences.forEach((s, si) => {
    const edge = edgeQuiet(s, rate);
    const want = first ? PAUSE.lead : si ? PAUSE.sentence : PAUSE.paragraph;
    parts.push(gap(want - tail - edge.head), s);
    tail = edge.tail;
    first = false;
  }));
  parts.push(gap(PAUSE.tail - tail));
  const out = new Int16Array(parts.reduce((a, p) => a + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

/** PCM → MP3(ffmpeg·LAME) */
function encodeMp3(pcm, rate) {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 's16le', '-ar', String(rate), '-ac', '1', '-i', 'pipe:0',
    '-codec:a', 'libmp3lame', '-b:a', MP3_BITRATE, '-map_metadata', '-1', '-id3v2_version', '0', '-f', 'mp3', 'pipe:1'],
  { input: Buffer.from(pcm.buffer, pcm.byteOffset, pcm.byteLength), maxBuffer: 1 << 28 });
  if (r.error) throw new Error(`ffmpeg가 필요합니다(MP3로 굳힌다): ${r.error.message}`);
  if (r.status !== 0) throw new Error(`ffmpeg: ${String(r.stderr).slice(0, 300)}`);
  return r.stdout;
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

// 말 빠르기 — 2026-10-27 대성당 13번이 원고는 65초 분량인데 89초로 나왔다(다시 합성하면 65초). 어긋난 음성은 들어 보기
// 전에는 모르므로 합성할 때 문장마다 걸러 낸다. 앞뒤 쉼을 걷은 문장 하나의 빠르기라 짧은 문장일수록 빠르게 나온다
const RATE_BAND = [4.2, 8.5];
const SHORT_SENTENCE = 12;   // 이보다 짧은 문장은 빠르기가 들쭉날쭉해 재지 않는다
// 문장 안 쉼의 상한 — 쉼표 자리는 -35dB로 재면 0.6초 안쪽이다(대성당 13번에서 가장 길었던 것이 0.57초). 대성당 1번은 엔진이 7초를 쉬었다
const MAX_INNER_PAUSE = 1.0;

/** 쉼 표시·공백을 뺀 글자 수를 초로 나눈다 */
function speechRate(markup, seconds) {
  return speechChars(markup) / Math.max(0.1, seconds);
}
function speechChars(markup) { return markup.replace(/\[[^\]]*\]/g, '').replace(/\s/g, '').length; }

/** 문장 소리를 들이기 전에 잰다 — 틀리면 이유 문장, 맞으면 null */
function sentenceProblem(markup, pcm, rate) {
  if (!pcm.length) return '소리가 없습니다';
  const longest = Math.max(0, ...innerPauses(pcm, rate));
  if (longest > MAX_INNER_PAUSE) return `문장 안에서 ${longest.toFixed(1)}초를 쉽니다`;
  const r = speechRate(markup, pcm.length / rate);
  if (speechChars(markup) >= SHORT_SENTENCE && (r < RATE_BAND[0] || r > RATE_BAND[1])) return `말 빠르기 ${r.toFixed(2)}자/초`;
  return null;
}

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
      // 대괄호는 합성 표시([pause short])로 읽힌다
      if (/S\d{2}|[A-Z]\d{2}\b|\*\*|#|\(|\)|\[|\]/.test(t.text || '')) errors.push(`${tw}: 원고에 출처 ID·괄호·마크다운이 섞여 있습니다 — 소리 내 읽힙니다`);
      for (const s of t.sources || []) if (!p.sources || !p.sources[s]) errors.push(`${tw}: 출처 ${s}가 sources에 없습니다`);
      if (!(t.sources || []).length) errors.push(`${tw}: 출처가 하나도 없습니다`);
      if (t.role === 'STOP' && !(t.stop && Number.isInteger(t.stop.n))) errors.push(`${tw}: 관람 지점 번호가 없습니다`);
      try { sentencePlan(spokenText(t.text)); } catch (e) { errors.push(`${tw}: ${e.message}`); }
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

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/** 문장 하나 → 16비트 PCM. 한도 초과·서버 오류는 잠깐 쉬고 다시 묻는다.
 *  다시 합성할 때(2·3번째)마다 속도를 1%씩 늦춘다 — 같은 요청을 곧바로 다시 보내면 같은 소리가 돌아왔다(대성당 5번의 한 문장이 세 번 다 3.99자/초) */
async function synthesize(markup, key, retry = 0) {
  const audioConfig = { ...AUDIO, speakingRate: +(AUDIO.speakingRate - retry * 0.01).toFixed(2) };
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(`https://texttospeech.googleapis.com/v1/text:synthesize?key=${encodeURIComponent(key)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ input: { markup }, voice: VOICE, audioConfig })
    });
    if (res.ok) return wavSamples(Buffer.from((await res.json()).audioContent, 'base64'));
    if ((res.status === 429 || res.status >= 500) && attempt < 4) { await wait(2000 * attempt); continue; }
    throw new Error(`TTS ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }
}

/** 여럿을 동시에 n개까지 */
async function mapLimit(items, n, fn) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (next < items.length) { const k = next++; out[k] = await fn(items[k], k); }
  }));
  return out;
}

/** 한 트랙을 문장마다 합성해 잇는다 — 잰 값이 어긋난 문장은 두 번까지 다시, 그래도 어긋나면 audio 없이 돌려준다 */
async function synthesizeTrack(spoken, src, key) {
  const plan = sentencePlan(spoken);
  const flat = plan.flatMap((sentences, pi) => sentences.map((markup) => ({ pi, markup })));
  let spent = 0;
  const clips = await mapLimit(flat, 4, async ({ markup }) => {
    for (let attempt = 1; attempt <= 3; attempt++) {
      const pcm = trimSilence(await synthesize(markup, key, attempt - 1), SAMPLE_RATE);
      spent += markup.length;
      const problem = sentenceProblem(markup, pcm, SAMPLE_RATE);
      if (!problem) return pcm;
      console.warn(`  ⚠ ${src}: ${problem} — ${attempt < 3 ? '다시 합성합니다' : '세 번 다 어긋났습니다'} («${markup.slice(0, 24)}…»)`);
    }
    return null;
  });
  if (clips.includes(null)) return { audio: null, spent };
  const pcm = joinTrack(plan.map((_, pi) => clips.filter((_c, k) => flat[k].pi === pi)), SAMPLE_RATE);
  const inner = Math.max(0, ...clips.flatMap((c) => innerPauses(c, SAMPLE_RATE)));
  const n = flat.length;
  console.log(`  ♪ ${src}: ${Math.round(pcm.length / SAMPLE_RATE)}초 · 문장 ${n} · 쉼 문장 사이 ${n - plan.length}곳 ${PAUSE.sentence}초·문단 사이 ${plan.length - 1}곳 ${PAUSE.paragraph}초 · 문장 안 가장 긴 쉼 ${inner.toFixed(2)}초`);
  return { audio: encodeMp3(pcm, SAMPLE_RATE), spent };
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
  const failed = [];
  for (const p of places) {
    const tracks = [];
    for (const t of p.tracks) {
      const reviewedAt = t.reviewedAt || p.reviewedAt || null;
      if (!draft && !reviewedAt) continue;
      const src = `seville/${p.id.replace(/^seville-/, '')}-${t.id}.mp3`;
      const file = path.join(outDir, src);
      const spoken = spokenText(t.text);
      const fingerprint = sha256(JSON.stringify([spoken, VOICE, AUDIO, PAUSE, COMMA_PAUSE, MP3_BITRATE, MAKE_VERSION]));
      if (!(state[src] === fingerprint && fs.existsSync(file))) {
        const made = await synthesizeTrack(spoken, src, key);
        spent += made.spent;
        if (!made.audio) { failed.push(src); continue; }
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, made.audio);
        if (!draft) state[src] = fingerprint;
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
  // 상태는 먼저 남긴다 — 다시 돌릴 때 잘 만든 트랙에 또 돈을 쓰지 않게
  if (!draft) fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2) + '\n');
  if (failed.length) {
    // 카탈로그는 쓰지 않는다 — 실패한 트랙이 빠지거나 옛 파일이 실린 채 배포되지 않게
    console.error(`✗ 잰 값(말 빠르기·문장 안 쉼)이 어긋난 문장이 있는 트랙 ${failed.length}편: ${failed.join(', ')} — 다시 돌리면 이것만 합성합니다. 계속되면 그 문장을 들어 보세요`);
    process.exit(1);
  }
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'catalog.json'), JSON.stringify(catalog, null, 2) + '\n');
  console.log(`${draft ? '검수용 ' : ''}카탈로그: ${catalog.places.length}곳 · 이번에 합성한 글자 ${spent.toLocaleString()}자 → ${path.relative(ROOT, outDir)}/`);
}

module.exports = { sinoKorean, spokenText, withJosa, sentencePlan, mp3Seconds, speechRate, RATE_BAND, PAUSE, check, loadPlaces,
  wavSamples, trimSilence, innerPauses, joinTrack, sentenceProblem, synthesizeTrack, SAMPLE_RATE };
if (require.main === module) main().catch((e) => { console.error(e.message); process.exit(1); });
