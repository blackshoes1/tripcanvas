import { randomUUID, sign } from 'node:crypto';
import { connect, constants, type ClientHttp2Session, type IncomingHttpHeaders, type OutgoingHttpHeaders } from 'node:http2';

import type { ApnsConfig } from './apnsConfig';
import type { LiveActivitySendResult, LiveActivitySender, LiveActivityUpdate } from './types';

const TOPIC = 'com.fromj.trip.push-type.liveactivity';
const FOUNDATION_EPOCH = 978307200;
const TOKEN_LIFETIME_MS = 45 * 60_000;
const SERVER_RETRY_MS = 15 * 60_000;
const REASONS = new Set([
  'BadCollapseId', 'BadDeviceToken', 'BadExpirationDate', 'BadMessageId', 'BadPriority', 'BadTopic',
  'DeviceTokenNotForTopic', 'DuplicateHeaders', 'IdleTimeout', 'InvalidPushType', 'MissingDeviceToken',
  'MissingTopic', 'PayloadEmpty', 'TopicDisallowed', 'BadCertificate', 'BadCertificateEnvironment',
  'ExpiredProviderToken', 'Forbidden', 'InvalidProviderToken', 'MissingProviderToken',
  'UnrelatedKeyIdInToken', 'BadEnvironmentKeyIdInToken', 'BadPath', 'MethodNotAllowed', 'ExpiredToken',
  'Unregistered', 'PayloadTooLarge', 'TooManyProviderTokenUpdates', 'TooManyRequests',
  'InternalServerError', 'ServiceUnavailable', 'Shutdown'
]);

export interface ApnsRequest { origin: string; headers: OutgoingHttpHeaders; body: string }
export interface ApnsResponse { status: number; headers: IncomingHttpHeaders; body: string }
export type ApnsTransport = (request: ApnsRequest) => Promise<ApnsResponse>;

/** 환경마다 연결을 재사용한다. 테스트만 connectSession을 바꾼다 — 운영 주소는 sender가 고정한다. */
export function createHttp2ApnsTransport(connectSession: (origin: string) => ClientHttp2Session = connect): ApnsTransport & { close(): void } {
  const sessions = new Map<string, ClientHttp2Session>();
  const transport: ApnsTransport = (request) => new Promise((resolve, reject) => {
    let session = sessions.get(request.origin);
    if (!session || session.closed || session.destroyed) {
      session = connectSession(request.origin);
      const current = session;
      sessions.set(request.origin, current);
      const forget = () => { if (sessions.get(request.origin) === current) sessions.delete(request.origin); };
      current.on('error', forget);
      current.on('goaway', () => { forget(); current.close(); });
      current.on('close', forget);
      current.setTimeout(60_000, () => { forget(); current.close(); });
      current.unref();
    }
    const stream = session.request(request.headers);
    let headers: IncomingHttpHeaders = {};
    let body = '';
    stream.setEncoding('utf8');
    stream.setTimeout(10_000, () => { stream.close(constants.NGHTTP2_CANCEL); reject(new Error('APNs timeout')); });
    stream.on('response', (value) => { headers = value; });
    stream.on('data', (chunk: string) => {
      body += chunk;
      if (body.length > 8192) { stream.close(constants.NGHTTP2_CANCEL); reject(new Error('APNs response too large')); }
    });
    let ended = false;
    stream.on('error', reject);
    stream.on('close', () => { if (!ended) reject(new Error('APNs stream closed')); });
    stream.on('end', () => {
      ended = true;
      const status = Number(headers[':status']);
      if (!Number.isInteger(status)) reject(new Error('APNs status missing'));
      else resolve({ status, headers, body });
    });
    stream.end(request.body);
  });
  return Object.assign(transport, { close() { for (const session of sessions.values()) session.destroy(); sessions.clear(); } });
}

function unix(date: Date): number {
  if (!Number.isFinite(date.getTime()) || date.getTime() < 0) throw new Error('date');
  return Math.floor(date.getTime() / 1000);
}

function contentState(update: LiveActivityUpdate): Record<string, unknown> {
  const state = update.state;
  const date = (iso: string | null): number | undefined => {
    if (iso === null) return undefined;
    const value = Date.parse(iso);
    if (!Number.isFinite(value)) throw new Error('date');
    // ActivityKit은 ContentState를 Swift의 기본 Codable 방식으로 읽는다(2001-01-01 기준 초).
    return value / 1000 - FOUNDATION_EPOCH;
  };
  return {
    tripName: state.tripName, dayLabel: state.dayLabel,
    nextTitle: state.nextTitle, nextStartAt: date(state.nextStartISO),
    travelMinutes: state.travelMinutes ?? undefined, departureText: state.departureText ?? undefined,
    status: state.status, scheduleElapsed: state.scheduleElapsed,
    fixedTitle: state.fixedTitle ?? undefined, fixedStartAt: date(state.fixedStartISO),
    pulseText: state.pulseText, stateVersion: state.stateVersion
  };
}

function retryAfter(response: ApnsResponse, now: Date, minimum: number): number {
  const header = response.headers['retry-after'];
  const raw = Array.isArray(header) ? header[0] : header;
  const seconds = Number(raw);
  const delay = raw && Number.isFinite(seconds) ? seconds * 1000 : Date.parse(raw ?? '') - now.getTime();
  return Math.max(minimum, Number.isFinite(delay) ? delay : 0);
}

/** 성공은 APNs 수락이다. 실제 기기 표시를 뜻하지 않는다. 재시도 예약은 worker 한 곳이 맡는다. */
export function createApnsSender(config: ApnsConfig, deps: { transport?: ApnsTransport; now?: () => Date } = {}): LiveActivitySender & { close(): void } {
  const transport = deps.transport ?? createHttp2ApnsTransport();
  const now = deps.now ?? (() => new Date());
  let cached: { value: string; issuedAt: number } | null = null;
  function authorization(): string {
    const time = now().getTime();
    if (!cached || time < cached.issuedAt || time - cached.issuedAt >= TOKEN_LIFETIME_MS) {
      const header = Buffer.from(JSON.stringify({ alg: 'ES256', kid: config.keyId })).toString('base64url');
      const claims = Buffer.from(JSON.stringify({ iss: config.teamId, iat: Math.floor(time / 1000) })).toString('base64url');
      const signature = sign('sha256', Buffer.from(`${header}.${claims}`), { key: config.privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64url');
      cached = { value: `${header}.${claims}.${signature}`, issuedAt: time };
    }
    return `bearer ${cached.value}`;
  }
  const send: LiveActivitySender = async (target, update): Promise<LiveActivitySendResult> => {
    if (!/^[a-f0-9]+$/i.test(target.pushToken) || target.pushToken.length % 2 !== 0) {
      return { ok: false, permanent: true, invalidToken: true, reason: 'InvalidPushToken' };
    }
    let body: string;
    let expiration: number;
    try {
      const timestamp = unix(update.at);
      expiration = update.event === 'end' ? 0 : unix(update.expiresAt);
      if (update.event === 'update' && expiration <= timestamp) throw new Error('expired');
      body = JSON.stringify({ aps: {
        timestamp, event: update.event, 'content-state': contentState(update),
        ...(update.staleAt ? { 'stale-date': unix(update.staleAt) } : {}),
        ...(update.event === 'end' ? { 'dismissal-date': timestamp } : {})
      } });
    } catch {
      return { ok: false, permanent: true, reason: 'InvalidContentState' };
    }
    if (Buffer.byteLength(body) > 4096) return { ok: false, permanent: true, reason: 'PayloadTooLarge' };
    let response: ApnsResponse;
    try {
      response = await transport({
        origin: target.environment === 'sandbox' ? 'https://api.sandbox.push.apple.com' : 'https://api.push.apple.com',
        headers: {
          ':method': 'POST', ':path': `/3/device/${target.pushToken}`, authorization: authorization(),
          'apns-topic': TOPIC, 'apns-push-type': 'liveactivity', 'apns-priority': '10',
          'apns-expiration': String(expiration), 'apns-id': randomUUID(), 'content-type': 'application/json'
        }, body
      });
    } catch {
      return { ok: false, permanent: false, retryAfterMs: 60_000, reason: 'TransportError' };
    }
    if (response.status === 200) return { ok: true };
    let reason = `APNsHTTP${response.status}`;
    try {
      const parsed = JSON.parse(response.body) as { reason?: unknown };
      if (typeof parsed.reason === 'string' && REASONS.has(parsed.reason)) reason = parsed.reason;
    } catch { /* 불완전한 응답도 고정 오류명만 남긴다. 본문·token·JWT는 기록하지 않는다. */ }
    if (response.status === 410 || reason === 'BadDeviceToken' || reason === 'DeviceTokenNotForTopic') {
      return { ok: false, permanent: true, invalidToken: true, reason };
    }
    if (reason === 'IdleTimeout') {
      return { ok: false, permanent: false, retryAfterMs: retryAfter(response, now(), 60_000), reason };
    }
    if (response.status === 429 || response.status >= 500 || response.status === 403 && reason !== 'Forbidden') {
      if (reason === 'ExpiredProviderToken') cached = null;
      const minimum = response.status === 429 ? (reason === 'TooManyProviderTokenUpdates' ? 20 * 60_000 : 60_000) : SERVER_RETRY_MS;
      return { ok: false, permanent: false, retryAfterMs: retryAfter(response, now(), minimum), reason };
    }
    return { ok: false, permanent: true, reason };
  };
  return Object.assign(send, { close() { if ('close' in transport && typeof transport.close === 'function') transport.close(); } });
}
