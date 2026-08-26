'use strict';
// 렌터카 시장가 프록시(서버 전용 키) — Discovery Provider 레지스트리.
// 컨셉: "현재 예약한 렌터카보다 더 좋은 조건이 더 싸게 나오면 알려준다" — 특정 업체 재확인이 아니라
// 같은 지역·기간·유사 차량의 시장 탐색이 목적이다. core 로직은 Provider에 종속되지 않는다.
// 스크래핑 없음 — 상용/공식 API만. 키가 없으면 AUTH_REQUIRED를 그대로 반환한다(가짜 가격 금지).
// 새 Provider는 buildAdapters에 같은 계약({id,status,search})으로 추가한다.

const MAX_BODY_BYTES = 2048;
const RATE_WINDOW_MS = 60_000;
const RATE_LIMIT = 10;
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
  return String((req.headers && (req.headers['x-vercel-forwarded-for'] || req.headers['x-forwarded-for'])) || (req.socket && req.socket.remoteAddress) || 'unknown')
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

const str = (value, max) => (typeof value === 'string' && value.trim() ? value.trim().slice(0, max || 200) : undefined);
const num = value => { const n = Number(value); return Number.isFinite(n) && n > 0 ? n : undefined; };
const isoDateTime = value => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(String(value || ''));

// deep link 위생: https + 공인 호스트만 (hotel-offers와 동일 정책)
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

// 요청 검증 — 거부 사유를 구분해 반환한다(원인 없는 invalid_request 금지 — hotel의 교훈)
function validRequest(body) {
  if (!body || typeof body !== 'object') return null;
  const out = {
    pickup: str(body.pickup, 120),
    pickupCode: /^[A-Za-z]{3}$/.test(String(body.pickupCode || '')) ? String(body.pickupCode).toUpperCase() : undefined,
    ret: str(body.return, 120),
    returnCode: /^[A-Za-z]{3}$/.test(String(body.returnCode || '')) ? String(body.returnCode).toUpperCase() : undefined,
    pickupAt: body.pickupAt, returnAt: body.returnAt,
    driverAge: Math.min(99, Math.max(18, Math.round(Number(body.driverAge) || 35))),
    currency: CURS.includes(body.currency) ? body.currency : 'KRW',
    vehicleClass: str(body.vehicleClass, 40), transmission: str(body.transmission, 20)
  };
  if (!out.pickup && !out.pickupCode) return { invalid: 'LOCATION_NOT_FOUND' };
  if (!isoDateTime(out.pickupAt) || !isoDateTime(out.returnAt)) return { invalid: 'INVALID_DATES' };
  if (String(out.pickupAt) >= String(out.returnAt)) return { invalid: 'INVALID_DATE_ORDER' };
  const floor = new Date(Date.now() - 86400000).toISOString().slice(0, 16);
  if (String(out.pickupAt) < floor) return { past: true };
  return out;
}

// ── Provider 레지스트리 ──
// 현재 셀프서비스로 접근 가능한 렌터카 Discovery API가 확인되지 않았다(RentSyst·Booking.com Demand·
// CarTrawler 모두 파트너 계약 필요). 계약/키가 생기면 여기에 adapter를 추가한다 — 계약(contract):
//   { id, role:'discovery', status():'CONNECTED'|'AUTH_REQUIRED'|'UNAVAILABLE', search(q):Promise<{offers:[...]}> }
// 키 없이는 AUTH_REQUIRED를 그대로 알린다. 가짜 가격·mock으로 대체하지 않는다(테스트에서만 adapters 주입 허용).
function buildAdapters(env) {
  const adapters = [];
  // 예: RentSyst broker — 계약·키 확보 시 활성화 (환경변수: RENTSYST_API_KEY / RENTSYST_API_SECRET)
  // 예: 기타 broker/OTA — CAR_DISCOVERY_PROVIDER 로 선택
  void env;
  return adapters;
}

// 자격증명 존재 여부만 알린다 — 값은 절대 응답에 넣지 않는다.
// 목적은 관측: 환경변수 이름 오타·재배포 누락을 "왜 안 되지"로 헤매지 않고 바로 구분하기 위함.
const CAR_CRED_KEYS = ['CAR_DISCOVERY_API_KEY', 'TRAVELPAYOUTS_TOKEN'];
const CAR_MARKER_KEYS = ['CAR_DISCOVERY_MARKER', 'TRAVELPAYOUTS_MARKER'];
function credentialState(env) {
  const e = env || {};
  const has = (keys) => keys.filter(k => typeof e[k] === 'string' && e[k].trim());
  const keys = has(CAR_CRED_KEYS), markers = has(CAR_MARKER_KEYS);
  return { present: keys.length > 0, keys, marker: markers.length > 0 };
}

function providerHealth(env, adapters) {
  const list = (adapters && adapters.length) ? adapters : buildAdapters(env);
  if (!list.length) {
    // 연결된 소스가 없다는 사실은 그대로 두되, 원인을 구분해 알린다.
    const cred = credentialState(env);
    return [{
      id: 'car-market', role: 'discovery', status: 'AUTH_REQUIRED',
      credentials: cred.present ? 'PRESENT' : 'MISSING',
      envKeys: cred.keys, marker: cred.marker,
      detail: cred.present
        ? '자격증명은 등록됨 — Provider adapter 미연결(API 문서 승인 후 연결)'
        : '연결된 시장 소스 없음 — 자격증명 미등록'
    }];
  }
  return list.map(a => ({ id: a.id, role: 'discovery', status: a.status() }));
}

// Provider 응답 → NormalizedCarOffer[] — 필드 차이는 adapter가 흡수하고, 여기서 최종 위생 처리만 한다
function normalizeOffers(offers, currency) {
  const out = [];
  for (const o of Array.isArray(offers) ? offers : []) {
    if (!o) continue;
    const total = num(o.totalPrice) || num(o.price);
    const seller = str(o.sellerName || o.seller, 80);
    if (!seller || !total) continue;
    out.push({
      seller, sourceProvider: str(o.sourceProvider, 40) || seller,
      vehicleName: str(o.vehicleName, 80), vehicleClass: str(o.vehicleClass, 40),
      transmission: str(o.transmission, 20), mileage: str(o.mileagePolicy || o.mileage, 40),
      insurance: str(o.insuranceLevel || o.insurance, 40),
      seats: num(o.seats), deposit: num(o.depositAmount || o.deposit),
      refundable: o.refundable === true ? true : (o.refundable === false ? false : undefined),
      pickupLocation: str(o.pickupLocation, 120), pickupCode: str(o.pickupCode, 3),
      returnLocation: str(o.returnLocation, 120), returnCode: str(o.returnCode, 3),
      price: total, total, cur: currency,
      link: safeLink(o.deepLink || o.link),
      observedAt: new Date().toISOString()
    });
  }
  return out.sort((a, b) => a.total - b.total).slice(0, MAX_OFFERS);
}

// Failover: 한 Provider 실패가 전체를 막지 않는다 — 성공한 결과만 합친다
async function runSearch(ctx, request) {
  const adapters = (ctx.adapters && ctx.adapters.length) ? ctx.adapters : buildAdapters(ctx.env);
  const connected = adapters.filter(a => a.status() === 'CONNECTED');
  if (!connected.length) throw Object.assign(new Error('no_provider'), { code: 'AUTH_REQUIRED' });
  const all = []; let lastErr = null;
  for (const adapter of connected) {
    try {
      const result = await adapter.search(request);
      all.push(...normalizeOffers(result && result.offers, request.currency));
    } catch (error) {
      lastErr = error;
      console.log('[car-offers] provider ' + adapter.id + ' failed:', String((error && error.code) || error).slice(0, 80));
    }
  }
  if (!all.length) {
    if (lastErr) throw lastErr;
    throw Object.assign(new Error('none'), { code: 'NO_AVAILABILITY' });
  }
  return { offers: all };
}

function createHandler(deps) {
  const env = (deps && deps.env) || process.env;
  const adapters = deps && deps.adapters;
  const now = (deps && deps.now) || (() => Date.now());
  return async function handler(req, res) {
    if (req.method === 'GET') {
      if (!String(req.url || '').includes('health')) return send(res, 400, { error: 'bad_request' });
      return send(res, 200, { providers: providerHealth(env, adapters) });
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
    if (request.invalid) return send(res, 400, { error: request.invalid });
    if (request.past) return send(res, 400, { error: 'PAST_DATE' });

    try {
      const result = await runSearch({ env, adapters }, request);
      return send(res, 200, { status: 'OK', offers: result.offers, checkedAt: new Date().toISOString() });
    } catch (error) {
      const code = (error && error.code) || 'PROVIDER_ERROR';
      if (!(error && error.code)) console.error('[car-offers] unexpected:', String((error && error.stack) || error).slice(0, 300));
      const status = code === 'AUTH_REQUIRED' ? 503 : code === 'RATE_LIMIT' ? 429 : code === 'NETWORK_ERROR' ? 504
        : code === 'LOCATION_NOT_FOUND' || code === 'NO_AVAILABILITY' ? 404 : 502;
      const detail = (error && typeof error.detail === 'string') ? error.detail.replace(/[0-9a-f]{32,}/gi, '***').slice(0, 160) : undefined;
      return send(res, status, detail ? { error: code, detail } : { error: code });
    }
  };
}

module.exports = createHandler();
module.exports.createHandler = createHandler;
module.exports.runSearch = runSearch;
module.exports._private = { validRequest, normalizeOffers, providerHealth, safeLink, buckets };
