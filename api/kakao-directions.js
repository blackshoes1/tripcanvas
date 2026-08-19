'use strict';

const MAX_BODY_BYTES = 1024;
const UPSTREAM_TIMEOUT_MS = 8000;
const RATE_WINDOW_MS = 60_000;
const RATE_LIMIT = 30;
const buckets = new Map();

function send(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.end(JSON.stringify(body));
}

function coordinate(value, min, max) {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
}

function point(value) {
  return value && typeof value === 'object'
    && coordinate(value.lat, -90, 90)
    && coordinate(value.lng, -180, 180);
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

function safeRoute(route) {
  const summary = route && route.summary;
  if (!summary) return null;
  const sections = Array.isArray(route.sections) ? route.sections.map(section => ({
    roads: Array.isArray(section.roads) ? section.roads.map(road => ({
      vertexes: Array.isArray(road.vertexes) ? road.vertexes.filter(Number.isFinite).slice(0, 20_000) : []
    })) : []
  })) : [];
  return {
    result_code: Number(route.result_code) || 0,
    summary: {
      duration: Number(summary.duration) || 0,
      distance: Number(summary.distance) || 0,
      fare: { taxi: Number(summary.fare && summary.fare.taxi) || 0 }
    },
    sections
  };
}

function createHandler({ fetchImpl = globalThis.fetch, env = process.env, now = Date.now } = {}) {
  return async function handler(req, res) {
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      return send(res, 405, { error: 'method_not_allowed' });
    }
    if (!sameOrigin(req)) return send(res, 403, { error: 'origin_not_allowed' });
    if (!rateAllowed(req, now())) return send(res, 429, { error: 'rate_limited' });

    let body;
    try { body = parseBody(req); }
    catch (error) { return send(res, error.status || 400, { error: error.message }); }
    if (!body || !point(body.origin) || !point(body.destination)) {
      return send(res, 400, { error: 'invalid_coordinates' });
    }

    const key = env.KAKAO_REST_API_KEY;
    if (!key) return send(res, 503, { error: 'service_unavailable' });

    const query = new URLSearchParams({
      origin: `${body.origin.lng},${body.origin.lat}`,
      destination: `${body.destination.lng},${body.destination.lat}`
    });
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
    try {
      const upstream = await fetchImpl(`https://apis-navi.kakaomobility.com/v1/directions?${query}`, {
        headers: { Authorization: `KakaoAK ${key}` },
        signal: controller.signal
      });
      if (!upstream.ok) return send(res, 502, { error: 'upstream_failed' });
      const text = await upstream.text();
      if (Buffer.byteLength(text) > 512 * 1024) return send(res, 502, { error: 'upstream_failed' });
      const json = JSON.parse(text);
      const route = json.routes && json.routes[0];
      if (!route) return send(res, 502, { error: 'route_unavailable' });
      if (route.result_code !== 0) return send(res, 422, { error: 'route_unavailable', code: Number(route.result_code) || -1 });
      const safe = safeRoute(route);
      if (!safe) return send(res, 502, { error: 'route_unavailable' });
      return send(res, 200, { route: safe });
    } catch (error) {
      return send(res, error && error.name === 'AbortError' ? 504 : 502, {
        error: error && error.name === 'AbortError' ? 'upstream_timeout' : 'upstream_failed'
      });
    } finally {
      clearTimeout(timer);
    }
  };
}

module.exports = createHandler();
module.exports.createHandler = createHandler;
module.exports._private = { MAX_BODY_BYTES, point, safeRoute, buckets };
