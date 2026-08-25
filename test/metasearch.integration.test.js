// 실제 Metasearch API 통합 테스트 (§44) — HOTEL_METASEARCH_API_KEY가 있을 때만 실행, CI/무키 환경은 skip.
// 실 API 비용이 발생하므로 호출은 1회(검색+상세)로 최소화한다. Secret은 출력하지 않는다.
const test = require('node:test');
const assert = require('node:assert/strict');
const { runSearch } = require('../api/hotel-offers.js');

const KEY = process.env.HOTEL_METASEARCH_API_KEY;
const skip = KEY ? false : 'HOTEL_METASEARCH_API_KEY 미설정 — 실 API 통합 테스트 skip';

function future(days) { const d = new Date(Date.now() + days * 864e5); return d.toISOString().slice(0, 10); }

test('실 API: 특정 호텔 검색 → 여러 판매처 오퍼 normalization 확인', { skip }, async () => {
  const result = await runSearch({ env: process.env, fetchImpl: globalThis.fetch }, {
    name: 'Cap Rocat', lat: 39.4699, lng: 2.7166,
    checkIn: future(60), checkOut: future(62),
    adults: 2, rooms: 1, currency: 'KRW', gl: 'kr', hl: 'ko'
  });
  if (result.unmatched) {
    // 실데이터 특성상 매칭 실패 가능 — 그래도 후보 구조는 계약대로여야 한다
    assert.ok(Array.isArray(result.candidates) && result.candidates.length, '후보 반환');
    assert.ok(result.candidates[0].token, '후보 token');
    return;
  }
  assert.ok(result.property && result.property.token, 'property token 확보');
  assert.ok(result.offers.length >= 1, `오퍼 존재 (${result.offers.length}개)`);
  for (const offer of result.offers) {
    assert.ok(offer.seller, 'seller 존재');
    assert.ok(offer.price > 0, '가격 정규화');
    assert.equal(offer.cur, 'KRW', '요청 통화 반영');
    if (offer.link) assert.match(offer.link, /^https:/, '딥링크는 https만');
  }
  console.log(`  ↳ 실 API 결과: ${result.offers.length}개 오퍼, 판매처: ${[...new Set(result.offers.map(o => o.seller))].slice(0, 5).join(', ')}`);
});
