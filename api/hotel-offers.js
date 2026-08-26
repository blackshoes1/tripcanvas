'use strict';
// 호텔 시세 프록시 (서버 전용 키) — Metasearch(Discovery) + 공식 API(Verification) 레지스트리.
// 특정 외부 서비스 의존은 adapter 내부에만 둔다: HOTEL_METASEARCH_PROVIDER(기본 serpapi — 구글 호텔
// 검색 결과를 구조화해 주는 상용 API)로 선택하고, 키가 없으면 앱을 깨지 않고 AUTH_REQUIRED를 반환한다.
// 스크래핑 없음 — 상용/공식 API만. deep link는 https만 통과시켜 클라이언트로 전달한다.

const P = require('../price.js');

const MAX_BODY_BYTES = 2048;
const UPSTREAM_TIMEOUT_MS = 9000;
const RATE_WINDOW_MS = 60_000;
const RATE_LIMIT = 10;                 // 메타서치는 호출당 비용 발생 — kakao 프록시보다 빡빡하게
const MATCH_MIN = 0.55;                // 이 미만 신뢰도는 자동 확정하지 않고 후보만 반환 (§22)
const MAX_OFFERS = 20;
const CURS = ['KRW', 'USD', 'EUR', 'JPY', 'CNY'];
const buckets = new Map();

function send(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.end(JSON.stringify(body));
}

function parseBody(req) {
  const length = Number(req.headers && req.headers['content-length']);
  if (Number.isFinite(length) && length > MAX_BODY_BYTES) throw Object.assign(new Error('too_large'), { status: 413 });
  const raw = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : req.body;
  const measured = typeof raw === 'string' ? Buffer.byteLength(raw) : Buffer.byteLength(JSON.stringify(raw || {}));
  if (measured > MAX_BODY_BYTES) throw Object.assign(new Error('too_large'), { status: 413 });
  try { return typeof raw === 'string' ? JSON.parse(raw) : raw; }
  catch (_) { throw Object.assign(new Error('invalid_json'), { status: 400 }); }
}

function sameOrigin(req) {
  const origin = req.headers && req.headers.origin;
  if (!origin) return true;
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  try { return !!host && new URL(origin).host === String(host).split(',')[0].trim(); }
  catch (_) { return false; }
}

function clientIp(req) {
  return String((req.headers && (req.headers['x-vercel-forwarded-for'] || req.headers['x-forwarded-for'])) || req.socket?.remoteAddress || 'unknown')
    .split(',')[0].trim();
}

function rateAllowed(req, now) {
  const key = clientIp(req);
  const current = buckets.get(key);
  if (!current || now - current.started >= RATE_WINDOW_MS) {
    buckets.set(key, { started: now, count: 1 });
    return true;
  }
  current.count += 1;
  return current.count <= RATE_LIMIT;
}

const isoDate = value => /^\d{4}-\d{2}-\d{2}$/.test(String(value || ''));
const str = (value, max) => (typeof value === 'string' && value.trim() ? value.trim().slice(0, max || 200) : undefined);
const num = value => { const n = Number(value); return Number.isFinite(n) && n > 0 ? n : undefined; };

// deep link 위생: https + 공인 호스트만 통과 (§37 — 내부망/스킴 주입 차단. 서버는 이 링크를 fetch하지 않는다)
function safeLink(value) {
  if (typeof value !== 'string') return undefined;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:') return undefined;
    const host = url.hostname;
    if (/^(localhost|127\.|10\.|192\.168\.|169\.254\.|0\.|\[)/.test(host) || !host.includes('.')) return undefined;
    return url.toString().slice(0, 1000);
  } catch (_) { return undefined; }
}

// 요청 검증 — 이름/토큰·체크인/아웃·인원·통화. 이름만이 아니라 좌표·placeId를 함께 받아 식별 정확도를 높인다 (§6)
function validRequest(body) {
  if (!body || typeof body !== 'object') return null;
  const out = {
    name: str(body.name, 160),
    placeId: (typeof body.placeId === 'string' && /^[A-Za-z0-9_-]{5,200}$/.test(body.placeId)) ? body.placeId : undefined,
    ptoken: (typeof body.ptoken === 'string' && /^[A-Za-z0-9_=-]{4,300}$/.test(body.ptoken)) ? body.ptoken : undefined,
    lat: Number.isFinite(Number(body.lat)) && Math.abs(Number(body.lat)) <= 90 ? Number(body.lat) : undefined,
    lng: Number.isFinite(Number(body.lng)) && Math.abs(Number(body.lng)) <= 180 ? Number(body.lng) : undefined,
    checkIn: body.checkIn, checkOut: body.checkOut,
    adults: Math.min(8, Math.max(1, Math.round(Number(body.adults) || 2))),
    // upstream(google_hotels)은 객실 수 파라미터를 지원하지 않는다 — 시세는 항상 1실 기준이다.
    // 요청값은 응답 basis로 되돌려, 클라이언트가 '1실 기준'임을 표시할 수 있게만 쓴다.
    rooms: Math.min(4, Math.max(1, Math.round(Number(body.rooms) || 1))),
    currency: CURS.includes(body.currency) ? body.currency : 'KRW',
    gl: /^[a-z]{2}$/.test(String(body.country || '')) ? body.country : 'kr',
    hl: /^[a-z]{2}$/.test(String(body.language || '')) ? body.language : 'ko'
  };
  if (!out.name && !out.ptoken) return { invalid: 'INVALID_NAME' };
  if (!isoDate(out.checkIn) || !isoDate(out.checkOut)) return { invalid: 'INVALID_DATES' };
  if (out.checkIn >= out.checkOut) return { invalid: 'INVALID_DATE_ORDER' };
  // upstream은 지난 날짜를 조회할 수 없다 — 여기서 거르지 않으면 PROVIDER_ERROR로 뭉뚱그려진다.
  // 기기·서버 시간대 차를 감안해 UTC 기준 하루 여유를 둔다.
  const floor = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  if (out.checkIn < floor) return { past: true };
  return out;
}

// upstream 오류 → §35 분류 코드 (원문·키는 절대 노출하지 않는다)
function upstreamCode(status) {
  if (status === 401 || status === 403) return 'AUTH_ERROR';
  if (status === 429) return 'RATE_LIMIT';
  return 'PROVIDER_ERROR';
}
// SerpApi는 일부 오류를 HTTP 200 + 본문 error 문자열로 준다 — 메시지 유형만 분류(키 무관 문자열)
function bodyError(message) {
  const m = String(message || '');
  const code = /out of searches|rate ?limit/i.test(m) ? 'RATE_LIMIT'
    : /hasn't returned any results|no results/i.test(m) ? 'PROPERTY_NOT_FOUND'
    : /invalid api key|unauthorized|api_key/i.test(m) ? 'AUTH_ERROR'
    : 'PROVIDER_ERROR';
  if (code === 'PROVIDER_ERROR') console.log('[hotel-offers] upstream error:', m.slice(0, 120));   // 진단용 — 키·요청값 없음
  return Object.assign(new Error('upstream_body'), { code, detail: m.slice(0, 160) });
}

// ── Metasearch adapter: serpapi (Google Hotels 결과 구조화 API) ──
// 다른 상용 메타서치를 붙이려면 같은 형태의 adapter를 추가하고 HOTEL_METASEARCH_PROVIDER로 선택한다.
function serpapiAdapter(env, fetchImpl) {
  const key = env.HOTEL_METASEARCH_API_KEY;
  async function call(params) {
    const query = new URLSearchParams({ engine: 'google_hotels', api_key: key, ...params });
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
    try {
      const upstream = await fetchImpl(`https://serpapi.com/search.json?${query}`, { signal: controller.signal });
      if (!upstream.ok) throw Object.assign(new Error('upstream'), { code: upstreamCode(upstream.status), detail: 'HTTP ' + upstream.status });
      const text = await upstream.text();
      if (Buffer.byteLength(text) > 2 * 1024 * 1024) throw Object.assign(new Error('big'), { code: 'INVALID_RESPONSE' });
      try { return JSON.parse(text); }
      catch (_) { throw Object.assign(new Error('json'), { code: 'INVALID_RESPONSE' }); }
    } catch (error) {
      if (error && error.code) throw error;
      throw Object.assign(new Error('net'), { code: error && error.name === 'AbortError' ? 'NETWORK_ERROR' : 'NETWORK_ERROR' });
    } finally { clearTimeout(timer); }
  }
  return {
    id: 'google-hotels', via: 'serpapi', role: 'discovery',
    status() { return key ? 'CONNECTED' : 'AUTH_REQUIRED'; },
    async search(q, retriedWithoutToken) {
      const base = {
        check_in_date: q.checkIn, check_out_date: q.checkOut,
        adults: String(q.adults), currency: q.currency, gl: q.gl, hl: q.hl
      };
      let token = q.ptoken, confidence = token ? 1 : 0, matchedName = '';
      if (!token) {
        const list = await call({ ...base, q: q.name });
        if (typeof list.error === 'string') throw bodyError(list.error);
        const properties = Array.isArray(list.properties) ? list.properties.slice(0, 12) : [];
        // 특정 호텔명이 정확히 매칭되면 구글 호텔이 목록 대신 property 상세를 바로 반환한다
        // → 목록 단계를 건너뛰고 그대로 상세로 사용 (호출 1회 절약). identity 검증은 동일하게 거친다.
        if (!properties.length && list.name && (list.prices || list.featured_prices || list.property_token)) {
          const prop = {
            name: str(list.name, 160) || '', token: str(list.property_token, 300),
            lat: list.gps_coordinates && list.gps_coordinates.latitude, lng: list.gps_coordinates && list.gps_coordinates.longitude
          };
          const score = P.identityScore({ name: q.name, lat: q.lat, lng: q.lng }, prop);
          if (score < MATCH_MIN) {
            return { unmatched: true, candidates: prop.token ? [{ name: prop.name, token: prop.token, score: Math.round(score * 100) / 100 }] : [] };
          }
          const offers = normalizeDetail(list, q.currency);
          if (!offers.length) throw Object.assign(new Error('empty'), { code: 'NO_AVAILABILITY' });
          return { property: { name: prop.name, token: prop.token, confidence: Math.round(score * 100) / 100 }, offers };
        }
        if (!properties.length) {
          console.log('[hotel-offers] no properties; upstream keys:', Object.keys(list).slice(0, 20).join(','));   // 진단용 — 응답 최상위 키 이름만
          throw Object.assign(new Error('none'), { code: 'PROPERTY_NOT_FOUND' });
        }
        const scored = properties
          .map(p => ({
            name: str(p.name, 160) || '', token: str(p.property_token, 300),
            score: P.identityScore(
              { name: q.name, lat: q.lat, lng: q.lng },
              { name: p.name, lat: p.gps_coordinates && p.gps_coordinates.latitude, lng: p.gps_coordinates && p.gps_coordinates.longitude })
          }))
          .filter(p => p.token)
          .sort((a, b) => b.score - a.score);
        if (!scored.length) throw Object.assign(new Error('none'), { code: 'PROPERTY_NOT_FOUND' });
        if (scored[0].score < MATCH_MIN) {
          return { unmatched: true, candidates: scored.slice(0, 3).map(c => ({ name: c.name, token: c.token, score: Math.round(c.score * 100) / 100 })) };
        }
        token = scored[0].token; confidence = scored[0].score; matchedName = scored[0].name;
      }
      const canRetry = !!q.ptoken && !retriedWithoutToken && !!q.name;   // 캐시 토큰으로 실패한 경우에만 재검색(무한루프 방지)
      let detail;
      try { detail = await call({ ...base, property_token: token }); }
      catch (error) {
        if (canRetry) return this.search({ ...q, ptoken: undefined }, true);   // 무효해진 캐시 토큰 → 이름으로 다시 찾는다
        throw error;
      }
      if (typeof detail.error === 'string') {
        if (canRetry) return this.search({ ...q, ptoken: undefined }, true);
        throw bodyError(detail.error);
      }
      const offers = normalizeDetail(detail, q.currency);
      if (!offers.length) throw Object.assign(new Error('empty'), { code: 'NO_AVAILABILITY' });
      return {
        property: { name: str(detail.name, 160) || matchedName || q.name || '', token, confidence: Math.round(confidence * 100) / 100 },
        offers
      };
    }
  };
}

// serpapi 응답 → NormalizedHotelOffer[] — 외부 응답 형태 차이는 여기서만 흡수한다 (§7)
function normalizeDetail(json, currency) {
  const out = [];
  const push = (seller, roomName, rate, total, link, refundable) => {
    const price = num(rate && rate.extracted_lowest);
    const totalPrice = num(total && total.extracted_lowest);
    if (!seller || (!price && !totalPrice)) return;
    out.push({
      seller, roomName, cur: currency,
      price: price || totalPrice, total: totalPrice,
      link: safeLink(link),
      refundable: refundable === true ? true : undefined,
      verified: false,
      observedAt: new Date().toISOString()
    });
  };
  for (const fp of Array.isArray(json.featured_prices) ? json.featured_prices : []) {
    const seller = str(fp && fp.source, 80);
    const rooms = Array.isArray(fp && fp.rooms) && fp.rooms.length ? fp.rooms : [null];
    for (const room of rooms) {
      push(seller, str(room && room.name, 120),
        (room && room.rate_per_night) || (fp && fp.rate_per_night),
        (room && room.total_rate) || (fp && fp.total_rate),
        (room && room.link) || (fp && fp.link));
    }
  }
  for (const pr of Array.isArray(json.prices) ? json.prices : []) {
    push(str(pr && pr.source, 80), undefined, pr && pr.rate_per_night, pr && pr.total_rate, pr && pr.link, pr && pr.free_cancellation);
  }
  // (판매처, 객실명) 중복은 실효가가 낮은 쪽만 유지
  const best = new Map();
  for (const offer of out) {
    const key = `${offer.seller}|${offer.roomName || ''}`;
    const prev = best.get(key);
    if (!prev || P.offerPrice(offer) < P.offerPrice(prev)) best.set(key, offer);
  }
  return [...best.values()].sort((a, b) => P.offerPrice(a) - P.offerPrice(b)).slice(0, MAX_OFFERS);
}

// ── Official Verification Provider Registry — credential 없으면 AUTH_REQUIRED, 임의 우회 없음 (§13·14) ──
// 새 Provider는 여기 항목 추가만으로 붙는다: match(판매처명)·status()·verify(offer, request).
function defaultVerifiers(env) {
  return [
    { id: 'booking.com', role: 'verification', match: s => /booking\.com/i.test(s || ''), status: () => (env.BOOKING_API_KEY ? 'CONNECTED' : 'AUTH_REQUIRED'), verify: null },
    { id: 'expedia', role: 'verification', match: s => /expedia/i.test(s || ''), status: () => (env.EXPEDIA_API_KEY ? 'CONNECTED' : 'AUTH_REQUIRED'), verify: null },
    { id: 'agoda', role: 'verification', match: s => /agoda/i.test(s || ''), status: () => (env.AGODA_API_KEY ? 'CONNECTED' : 'AUTH_REQUIRED'), verify: null }
  ];
}

// 하락 후보를 공식 API로 재검증 (연결된 Provider가 있을 때만). 한 Provider 실패가 전체를 막지 않는다 (§35·36)
async function verifyOffers(offers, verifiers, request) {
  for (const offer of offers) {
    const v = (verifiers || []).find(x => x.match(offer.seller) && x.status() === 'CONNECTED' && typeof x.verify === 'function');
    if (!v) continue;
    try {
      const result = await v.verify(offer, request);
      if (result && typeof result === 'object') Object.assign(offer, result, { verified: true, verifiedBy: v.id, verifiedAt: new Date().toISOString() });
    } catch (_) { /* 검증 실패 → 미검증 오퍼로 유지 */ }
  }
  return offers;
}

// 검색 파이프라인 — HTTP handler와 cron job이 공유한다
async function runSearch(deps, request) {
  const env = deps.env || process.env;
  const fetchImpl = deps.fetchImpl || globalThis.fetch;
  const which = env.HOTEL_METASEARCH_PROVIDER || 'serpapi';
  if (which !== 'serpapi') throw Object.assign(new Error('unknown_provider'), { code: 'PROVIDER_ERROR' });
  const adapter = serpapiAdapter(env, fetchImpl);
  if (adapter.status() !== 'CONNECTED') throw Object.assign(new Error('no_key'), { code: 'AUTH_REQUIRED' });
  const result = await adapter.search(request);
  if (result.unmatched) return result;
  result.offers = await verifyOffers(result.offers, deps.verifiers || defaultVerifiers(env), request);
  return result;
}

function providerHealth(env) {
  const adapter = serpapiAdapter(env, globalThis.fetch);
  return [
    { id: `${adapter.id} (${adapter.via})`, role: 'discovery', status: adapter.status() },
    ...defaultVerifiers(env).map(v => ({ id: v.id, role: v.role, status: v.status() }))
  ];
}

function createHandler({ fetchImpl = globalThis.fetch, env = process.env, now = Date.now, verifiers } = {}) {
  return async function handler(req, res) {
    if (req.method === 'GET') {
      const wantsHealth = String(req.url || '').includes('health');
      if (!wantsHealth) return send(res, 400, { error: 'bad_request' });
      return send(res, 200, { providers: providerHealth(env) });   // §34 Provider health — 키 값은 노출하지 않음
    }
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'GET, POST');
      return send(res, 405, { error: 'method_not_allowed' });
    }
    if (!sameOrigin(req)) return send(res, 403, { error: 'origin_not_allowed' });
    if (!rateAllowed(req, now())) return send(res, 429, { error: 'RATE_LIMIT' });

    let body;
    try { body = parseBody(req); }
    catch (error) { return send(res, error.status || 400, { error: error.message }); }
    const request = validRequest(body);
    if (!request) return send(res, 400, { error: 'invalid_request' });
    if (request.invalid) return send(res, 400, { error: request.invalid });   // 사유를 그대로 알려 화면에서 바로 고칠 수 있게
    if (request.past) return send(res, 400, { error: 'PAST_DATE' });

    try {
      const result = await runSearch({ env, fetchImpl, verifiers }, request);
      if (result.unmatched) return send(res, 200, { status: 'UNMATCHED', candidates: result.candidates });
      return send(res, 200, { status: 'OK', property: result.property, offers: result.offers,
        basis: { rooms: 1, adults: request.adults, requestedRooms: request.rooms },   // 비교 가격의 기준 — 1실 고정
        checkedAt: new Date().toISOString() });
    } catch (error) {
      const code = (error && error.code) || 'PROVIDER_ERROR';
      // code가 없으면 upstream 분류 오류가 아니라 이 코드에서 난 예외다 — 흔적을 남겨야 다음에 원인을 찾는다
      if (!(error && error.code)) console.error('[hotel-offers] unexpected:', String((error && error.stack) || (error && error.message) || error).slice(0, 300));
      const status = code === 'AUTH_REQUIRED' ? 503 : code === 'RATE_LIMIT' ? 429 : code === 'NETWORK_ERROR' ? 504 : code === 'PROPERTY_NOT_FOUND' || code === 'NO_AVAILABILITY' ? 404 : 502;
      // 원인 문구를 함께 돌려준다 — 화면에서 바로 보이면 "계속 실패"의 원인을 왕복 없이 알 수 있다.
      // provider가 준 문구만 담고(키·요청값 아님), 혹시 모를 키 패턴은 지운다.
      const detail = (error && typeof error.detail === 'string')
        ? error.detail.replace(/[0-9a-f]{32,}/gi, '***').slice(0, 160) : undefined;
      return send(res, status, detail ? { error: code, detail } : { error: code });
    }
  };
}

module.exports = createHandler();
module.exports.createHandler = createHandler;
module.exports.runSearch = runSearch;
module.exports.providerHealth = providerHealth;
module.exports._private = { validRequest, normalizeDetail, safeLink, defaultVerifiers, verifyOffers, buckets, MATCH_MIN };
