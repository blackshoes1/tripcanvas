// With J 이야기 — 카탈로그 정규화와 장소 매칭 (stories.js)
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const S = require('../stories.js');

const SHA = 'a'.repeat(64);
const track = (over = {}) => ({ id: 'core', role: 'CORE', title: '핵심', src: 'seville/x.mp3', seconds: 90, bytes: 700000, sha256: SHA, sources: ['A01'], reviewedAt: '2026-10-22', ...over });
const RAW = {
  version: 1,
  updated: '2026-10-22',
  voice: { disclosure: 'AI 음성으로 읽었어요' },
  places: [
    { id: 'seville-plaza-espana', kind: 'PLACE', name: '스페인 광장', localName: 'Plaza de España', city: '세비야', lat: 37.3772, lng: -5.9869, radiusM: 300,
      aliases: ['세비야 스페인 광장'], placeIds: ['ChIJ_plaza_sevilla'], tracks: [track({ id: 'more', role: 'MORE', title: '더 듣기' }), track()] },
    { id: 'seville-alcazar', kind: 'PLACE', name: '레알 알카사르', localName: 'Real Alcázar de Sevilla', city: '세비야', lat: 37.3831, lng: -5.9903, radiusM: 300,
      aliases: ['알카사르', 'Real Alcázar', 'Alcázar de Sevilla'], placeIds: [], tracks: [track({ src: 'seville/alcazar-core.mp3' })] },
    { id: 'seville-cathedral', kind: 'PLACE', name: '세비야 대성당', localName: 'Catedral de Sevilla', city: '세비야', lat: 37.3858, lng: -5.9931, radiusM: 250,
      aliases: ['대성당', 'Catedral de Sevilla', '히랄다'], placeIds: [],
      tracks: [3, 1, 2].map(n => track({ id: 's' + n, role: 'STOP', title: '지점 ' + n, src: `seville/cathedral-0${n}.mp3`, stop: { n, find: ['금빛'], localName: 'Retablo' } })) },
    { id: 'seville-city', kind: 'CITY', name: '세비야', lat: 37.3891, lng: -5.9845, radiusM: 8000, tracks: [track({ id: 'intro', src: 'seville/city.mp3' })] }
  ],
  sources: { A01: { title: '알카사르 공식', url: 'https://www.alcazarsevilla.org/' }, BAD: { title: 'x', url: 'javascript:alert(1)' } }
};
const CAT = S.normalizeCatalog(RAW);

test('정규화: 검수되지 않았거나 경로가 위험한 트랙은 버리고, 들을 것이 없는 장소도 버린다', () => {
  const cat = S.normalizeCatalog({ places: [
    { ...RAW.places[1], id: 'a', tracks: [track({ reviewedAt: null })] },
    { ...RAW.places[1], id: 'b', tracks: [track({ src: '../secret.mp3' })] },
    { ...RAW.places[1], id: 'c', tracks: [track({ src: 'https://evil.example/x.mp3' })] },
    { ...RAW.places[1], id: 'd', tracks: [track({ sha256: 'xyz' })] },
    { ...RAW.places[1], id: 'e', tracks: [track({ role: 'STOP' })] },          // 관람 지점인데 번호가 없다
    { ...RAW.places[1], id: 'f', lat: null, tracks: [track()] },
    { ...RAW.places[1], id: 'g', radiusM: 999999, tracks: [track()] },
    { ...RAW.places[1], id: 'ok', tracks: [track(), track()] }                // 같은 id 트랙은 하나만
  ] });
  assert.deepEqual(cat.places.map(p => p.id), ['ok']);
  assert.equal(cat.places[0].tracks.length, 1);
});

test('정규화: 트랙은 핵심 → 더 듣기 → 관람 지점(번호 순)이고, 출처는 https만', () => {
  assert.deepEqual(CAT.places[0].tracks.map(t => t.role), ['CORE', 'MORE']);
  assert.deepEqual(CAT.places[2].tracks.map(t => t.stop && t.stop.n), [1, 2, 3]);
  assert.deepEqual(Object.keys(CAT.sources), ['A01']);
  assert.equal(CAT.disclosure, 'AI 음성으로 읽었어요');
  assert.deepEqual(S.normalizeCatalog(null).places, []);
});

test('매칭: placeId가 같으면 이름·좌표가 없어도 그 장소다', () => {
  assert.equal(S.storyForSpot({ name: '광장', placeId: 'ChIJ_plaza_sevilla' }, CAT)?.id, 'seville-plaza-espana');
});

test('매칭: 좌표가 반경 안이고 이름이 맞으면 붙는다 — 한국어·스페인어·악센트 없이', () => {
  assert.equal(S.storyForSpot({ name: '스페인 광장', lat: 37.3770, lng: -5.9871 }, CAT)?.id, 'seville-plaza-espana');
  assert.equal(S.storyForSpot({ name: 'Real Alcazar de Sevilla', lat: 37.3829, lng: -5.9905 }, CAT)?.id, 'seville-alcazar');
  assert.equal(S.storyForSpot({ name: '알카사르 궁전', lat: '37.3833', lng: '-5.9901' }, CAT)?.id, 'seville-alcazar');
});

test('매칭: 이름만 같은 다른 도시의 장소에는 붙지 않는다 — 마드리드 스페인 광장·세고비아 알카사르', () => {
  assert.equal(S.storyForSpot({ name: '스페인 광장', lat: 40.4233, lng: -3.7122, city: '마드리드' }, CAT), null);
  assert.equal(S.storyForSpot({ name: 'Plaza de España', lat: 40.4233, lng: -3.7122 }, CAT), null);
  assert.equal(S.storyForSpot({ name: '알카사르', lat: 40.9527, lng: -4.1325, city: '세고비아' }, CAT), null);
  assert.equal(S.storyForSpot({ name: 'Alcázar de los Reyes Cristianos', lat: 37.8789, lng: -4.7838 }, CAT), null);
});

test('매칭: 좌표가 없거나 이름이 다르면 붙지 않는다', () => {
  assert.equal(S.storyForSpot({ name: '스페인 광장', city: '세비야' }, CAT), null);
  assert.equal(S.storyForSpot({ name: '스페인 광장', lat: 0, lng: 0 }, CAT), null);
  // 알카사르 바로 옆 식당 — 반경 안이지만 이름이 다르다
  assert.equal(S.storyForSpot({ name: 'Bodega Santa Cruz', lat: 37.3850, lng: -5.9910 }, CAT), null);
  assert.equal(S.storyForSpot({ name: '광장', lat: 37.3772, lng: -5.9869 }, CAT), null);   // 너무 짧은 이름
});

test('매칭: 대성당 근처라도 이름이 맞는 쪽으로 — 반경이 겹치면 가까운 장소', () => {
  assert.equal(S.storyForSpot({ name: '세비야 대성당', lat: 37.3858, lng: -5.9931 }, CAT)?.id, 'seville-cathedral');
  assert.equal(S.storyForSpot({ name: '알카사르', lat: 37.3845, lng: -5.9915 }, CAT)?.id, 'seville-alcazar');
});

test('도시 이야기는 날에 붙는다 — 그날 장소 하나라도 반경 안이면', () => {
  assert.equal(S.cityStoryForDay({ spots: [{ name: '숙소' }, { name: '바', lat: 37.39, lng: -5.99 }] }, CAT)?.id, 'seville-city');
  assert.equal(S.cityStoryForDay({ spots: [{ name: '프라도', lat: 40.4138, lng: -3.6921 }] }, CAT), null);
  assert.equal(S.cityStoryForDay({ spots: [] }, CAT), null);
  assert.equal(S.storyForSpot({ name: '세비야', lat: 37.3891, lng: -5.9845 }, CAT), null);   // 도시는 장소 매칭에 쓰지 않는다
});

test('여행 전체의 이야기 — 같은 이야기는 한 번만', () => {
  const trip = { days: [
    { spots: [{ name: '스페인 광장', lat: 37.3772, lng: -5.9869 }, { name: '알카사르', lat: 37.3831, lng: -5.9903 }] },
    { spots: [{ name: '알카사르', lat: 37.3831, lng: -5.9903 }] },
    { spots: [{ name: '프라도', lat: 40.4138, lng: -3.6921 }] }
  ] };
  assert.deepEqual(S.storiesForTrip(trip, CAT).map(p => p.id).sort(), ['seville-alcazar', 'seville-city', 'seville-plaza-espana']);
  assert.deepEqual(S.storiesForTrip(null, CAT), []);
});

test('표시: 길이·크기·출처', () => {
  assert.equal(S.durationText(45), '45초');
  assert.equal(S.durationText(105), '1분 45초');
  assert.equal(S.durationText(120), '2분');
  assert.equal(S.sizeText(1.4 * 1024 * 1024), '1.4MB');
  assert.equal(S.sizeText(300), '1KB');
  assert.equal(S.trackUrl(CAT.places[0].tracks[0]), 'stories/seville/x.mp3');
  assert.deepEqual(S.placeSources(CAT.places[1], CAT).map(s => s.id), ['A01']);
  assert.equal(S.storyBytes(CAT.places[0]), 1400000);
});

test('배포되는 stories/catalog.json은 정규화를 지나도 그대로이고, 가리키는 파일이 실제로 있다', () => {
  const file = path.join(__dirname, '..', 'stories', 'catalog.json');
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  const cat = S.normalizeCatalog(raw);
  const rawTracks = raw.places.reduce((a, p) => a + p.tracks.length, 0);
  const tracks = cat.places.reduce((a, p) => a + p.tracks.length, 0);
  assert.equal(tracks, rawTracks, '카탈로그에 검수되지 않았거나 잘못된 트랙이 있다');
  for (const p of cat.places) for (const t of p.tracks) {
    const f = path.join(__dirname, '..', 'stories', t.src);
    assert.ok(fs.existsSync(f), `${t.src} 파일이 없다`);
    assert.equal(fs.statSync(f).size, t.bytes, `${t.src} 크기가 카탈로그와 다르다`);
  }
});

test('배포되는 마요르카 이야기도 이름만 같은 곳에는 붙지 않는다 — 섬 이야기는 섬 안의 날에만', () => {
  const cat = S.normalizeCatalog(JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'stories', 'catalog.json'), 'utf8')));
  const at = (name, lat, lng) => (S.storyForSpot({ name, lat, lng }, cat) || { id: null }).id;
  assert.equal(at('팔마 대성당', 39.5675, 2.6483), 'mallorca-palma-cathedral');
  assert.equal(at('Cap Rocat', 39.4756, 2.7247), 'mallorca-cap-rocat');
  assert.equal(at('미라도르 데스 콜로메르', 39.9310, 3.1124), 'mallorca-formentor');
  // 팔마에서 타는 소예르 기차는 팔마 종점에, 소예르에 내리면 소예르역에 — 같은 음성이다
  assert.equal(at('소예르 기차', 39.5767, 2.6538), 'mallorca-soller-train-palma');
  assert.equal(at('Tren de Sóller', 39.7649, 2.7152), 'mallorca-soller-train');
  // 원고가 부르는 이름·현지 정식 이름·원고의 중심인 곳으로도 붙는다(2026-10-31 검토 — 전에는 모두 빠졌다)
  assert.equal(at('엔데로캇 곶 요새', 39.4761, 2.7247), 'mallorca-cap-rocat');
  assert.equal(at('Fort del Cap Enderrocat', 39.4761, 2.7247), 'mallorca-cap-rocat');
  assert.equal(at('Teatre Romà', 39.8461, 3.1200), 'mallorca-alcudia');
  assert.equal(at('쇼팽 박물관', 39.7095, 2.6220), 'mallorca-valldemossa');
  assert.equal(at('오렌지 급행', 39.5767, 2.6538), 'mallorca-soller-train-palma');
  // 바로 옆이어도 이름이 다르면(알무다이나 궁전), 이름이 같아도 멀면(폴렌사 항구의 '포르멘토르') 붙지 않는다
  assert.equal(at('알무다이나 궁전', 39.5677, 2.6466), null);
  assert.equal(at('포르멘토르', 39.904, 3.085), null);
  const city = (lat, lng) => (S.cityStoryForDay({ spots: [{ name: 'x', lat, lng }] }, cat) || { id: null }).id;
  assert.equal(city(39.5517, 2.7388), 'mallorca-island');   // 팔마 공항
  assert.equal(city(40.0, 3.84), null);                      // 메노르카
  assert.equal(city(37.389, -5.984), 'seville-city');
});
