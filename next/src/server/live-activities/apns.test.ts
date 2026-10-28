import { generateKeyPairSync, verify } from 'node:crypto';
import { connect, createServer } from 'node:http2';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import type { LiveActivityState } from '@/features/trip-state/domain/contract';
import { writeFixture } from '../../features/trip-state/domain/parityFiles';
import { createApnsSender, createHttp2ApnsTransport, type ApnsRequest, type ApnsResponse } from './apns';
import type { ApnsConfig } from './apnsConfig';
import type { LiveActivityUpdate } from './types';

const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const config: ApnsConfig = { teamId: 'ABCDEFGHIJ', keyId: '0123456789', privateKey };
const at = new Date('2026-10-27T12:00:00.000Z');
const target = { pushToken: 'ab'.repeat(32), environment: 'production' as const };
const state: LiveActivityState = {
  target: { dayIndex: 1, activityId: 'd1s1', revision: 7 },
  tripName: '서울 여행', dayLabel: 'Day 2', status: 'UPCOMING', nextTitle: '점심',
  nextStartISO: '2026-10-27T12:30:00.250Z', travelMinutes: 12, departureText: '곧 나설 시간이에요',
  scheduleElapsed: false, fixedTitle: null, fixedStartISO: null, pulseText: '여유 있게 가요', stateVersion: 'v2'
};
const update: LiveActivityUpdate = {
  state, event: 'update', at, staleAt: new Date('2026-10-27T12:30:00Z'),
  expiresAt: new Date('2026-10-27T20:00:00Z')
};
function setup(response: ApnsResponse = { status: 200, body: '', headers: {} }) {
  const requests: ApnsRequest[] = [];
  const transport = vi.fn(async (request: ApnsRequest) => { requests.push(request); return response; });
  const send = createApnsSender(config, { transport, now: () => at });
  return { requests, transport, send };
}

describe('ActivityKit APNs 전송', () => {
  it('실제 sender의 body만 Swift 기본 decoder 공용 픽스처로 쓴다', async () => {
    const { send, requests } = setup();
    await send(target, { ...update, state: { ...state, tripName: '잠금화면 정합성', dayLabel: 'Day 2',
      departureText: null, fixedTitle: '미술관 예약', fixedStartISO: '2026-10-27T13:00:00Z' } });
    await send(target, { ...update, at: new Date('2026-10-27T14:00:00Z'), staleAt: null,
      state: { ...state, tripName: '잠금화면 정합성', dayLabel: 'Day 2', status: 'COMPLETED',
        nextTitle: '예정 시간 지남', nextStartISO: null, travelMinutes: null, departureText: null,
        fixedTitle: null, fixedStartISO: null, scheduleElapsed: true, shouldEnd: true, target: undefined,
        pulseText: '예정한 시간은 지났어요', stateVersion: 'elapsed-v2' } });
    expect(requests).toHaveLength(2);
    const payloads = requests.map(request => JSON.parse(request.body));
    expect(payloads[0].aps['content-state'].nextStartAt).toBe(814797000.25);
    expect(payloads[1].aps['content-state'].nextStartAt).toBeUndefined();
    expect(payloads[0].aps['content-state'].target).toEqual(state.target);
    expect(payloads[1].aps['content-state'].target).toBeUndefined();
    expect(payloads[1].aps['content-state'].shouldEnd).toBe(true);
    // P256 키는 테스트마다 새로 만들지만 JWT·header는 파일에 넣지 않는다. body는 결정적이다.
    writeFixture(path.join(__dirname, '../../../../ios/TripCanvasTests/Fixtures/live-activity-push.json'),
      JSON.stringify(payloads, null, 2) + '\n');
  });

  it('정확한 topic·환경·headers와 Swift 기본 Date 형식을 보낸다', async () => {
    const { send, requests } = setup();
    expect(await send(target, update)).toEqual({ ok: true });
    const request = requests[0]!;
    expect(request.origin).toBe('https://api.push.apple.com');
    expect(request.headers[':method']).toBe('POST');
    expect(request.headers[':path']).toBe(`/3/device/${target.pushToken}`);
    expect(request.headers['apns-topic']).toBe('com.fromj.trip.push-type.liveactivity');
    expect(request.headers['apns-push-type']).toBe('liveactivity');
    expect(request.headers['apns-priority']).toBe('10');
    expect(request.headers['apns-expiration']).toBe(String(update.expiresAt.getTime() / 1000));
    const { aps } = JSON.parse(request.body);
    expect(aps.timestamp).toBe(at.getTime() / 1000);
    expect(aps.event).toBe('update');
    expect(aps['stale-date']).toBe(update.staleAt!.getTime() / 1000);
    expect(aps['content-state']).toEqual({
      target: state.target,
      tripName: state.tripName, dayLabel: state.dayLabel, nextTitle: state.nextTitle,
      nextStartAt: Date.parse(state.nextStartISO!) / 1000 - 978307200,
      travelMinutes: 12, departureText: state.departureText, status: 'UPCOMING',
      scheduleElapsed: false, pulseText: state.pulseText, stateVersion: 'v2'
    });
    expect(request.body).not.toContain('nextStartISO');
    expect(aps.alert).toBeUndefined();
  });

  it('Debug 등록만 sandbox로 보내고 종료에는 마지막 내용과 즉시 닫는 시각을 담는다', async () => {
    const { send, requests } = setup();
    await send({ ...target, environment: 'sandbox' }, { ...update, event: 'end', staleAt: null });
    expect(requests[0]!.origin).toBe('https://api.sandbox.push.apple.com');
    const { aps } = JSON.parse(requests[0]!.body);
    expect(aps.event).toBe('end');
    expect(aps['content-state'].nextTitle).toBe('점심');
    expect(aps['dismissal-date']).toBe(at.getTime() / 1000);
    expect(aps['stale-date']).toBeUndefined();
    expect(requests[0]!.headers['apns-expiration']).toBe('0');
  });

  it('ES256 JWT는 실제 검증되고 45분 동안 재사용한 뒤 갱신된다', async () => {
    const tokens: string[] = [];
    let now = at;
    const send = createApnsSender(config, {
      now: () => now,
      transport: async (request) => {
        tokens.push(String(request.headers.authorization).slice(7));
        return { status: 200, body: '', headers: {} };
      }
    });
    await send(target, update);
    now = new Date(at.getTime() + 44 * 60_000);
    await send(target, update);
    now = new Date(at.getTime() + 45 * 60_000);
    await send(target, update);
    expect(tokens[0]).toBe(tokens[1]);
    expect(tokens[0]).not.toBe(tokens[2]);
    const [header, claims, signature] = tokens[0]!.split('.');
    expect(JSON.parse(Buffer.from(header!, 'base64url').toString())).toEqual({ alg: 'ES256', kid: config.keyId });
    expect(JSON.parse(Buffer.from(claims!, 'base64url').toString())).toEqual({ iss: config.teamId, iat: at.getTime() / 1000 });
    expect(verify('sha256', Buffer.from(`${header}.${claims}`), { key: publicKey, dsaEncoding: 'ieee-p1363' }, Buffer.from(signature!, 'base64url'))).toBe(true);
  });

  it.each([
    [400, 'BadDeviceToken'], [400, 'DeviceTokenNotForTopic'], [410, 'Unregistered'], [410, 'ExpiredToken']
  ])('%i %s는 토큰을 다시 쓰지 않는다', async (status, reason) => {
    const { send } = setup({ status, body: JSON.stringify({ reason }), headers: {} });
    expect(await send(target, update)).toEqual({ ok: false, permanent: true, invalidToken: true, reason });
  });

  it.each([429, 500, 503])('%i는 등록을 버리지 않고 지연 후 재시도한다', async (status) => {
    const { send } = setup({ status, body: JSON.stringify({ reason: status === 429 ? 'TooManyRequests' : 'ServiceUnavailable' }), headers: {} });
    const result = await send(target, update);
    expect(result).toMatchObject({ ok: false, permanent: false });
    if (!result.ok) expect(result.retryAfterMs).toBeGreaterThanOrEqual(status === 429 ? 60_000 : 15 * 60_000);
  });

  it('retry-after를 존중하고 provider token 과다 갱신은 20분 기다린다', async () => {
    const limited = setup({ status: 429, body: '{"reason":"TooManyRequests"}', headers: { 'retry-after': '120' } });
    expect(await limited.send(target, update)).toMatchObject({ retryAfterMs: 120_000 });
    const provider = setup({ status: 429, body: '{"reason":"TooManyProviderTokenUpdates"}', headers: {} });
    expect(await provider.send(target, update)).toMatchObject({ retryAfterMs: 20 * 60_000 });
  });

  it('인증 실패는 토큰 삭제와 구분하고 응답 본문을 로그/오류로 반사하지 않는다', async () => {
    const { send } = setup({ status: 403, body: '{"reason":"InvalidProviderToken","detail":"secret-value"}', headers: {} });
    const result = await send(target, update);
    expect(result).toEqual({ ok: false, permanent: false, retryAfterMs: 15 * 60_000, reason: 'InvalidProviderToken' });
    expect(JSON.stringify(result)).not.toContain('secret-value');
    const unknown = setup({ status: 400, body: '{"reason":"secret-private-token"}', headers: {} });
    expect(await unknown.send(target, update)).toEqual({ ok: false, permanent: true, reason: 'APNsHTTP400' });
  });

  it('만료된 provider JWT는 다음 전송 때 새 서명으로 교체한다', async () => {
    const tokens: string[] = [];
    const send = createApnsSender(config, { now: () => at, transport: async (request) => {
      tokens.push(String(request.headers.authorization));
      return tokens.length === 1
        ? { status: 403, body: '{"reason":"ExpiredProviderToken"}', headers: {} }
        : { status: 200, body: '', headers: {} };
    } });
    expect(await send(target, update)).toMatchObject({ ok: false, permanent: false, retryAfterMs: 900_000 });
    expect(await send(target, update)).toEqual({ ok: true });
    expect(tokens[0]).not.toBe(tokens[1]);
  });

  it('권한·payload 오류는 재시도 중단과 토큰 해제를 구분한다', async () => {
    for (const [status, reason] of [[403, 'Forbidden'], [413, 'PayloadTooLarge']] as const) {
      const { send } = setup({ status, body: JSON.stringify({ reason }), headers: {} });
      expect(await send(target, update)).toEqual({ ok: false, permanent: true, reason });
    }
    const { send } = setup({ status: 503, body: '{', headers: { 'retry-after': 'Tue, 27 Oct 2026 12:30:00 GMT' } });
    expect(await send(target, update)).toEqual({ ok: false, permanent: false, reason: 'APNsHTTP503', retryAfterMs: 30 * 60_000 });
  });

  it('유휴 연결 종료는 사용자 등록을 중단하지 않고 다시 보낸다', async () => {
    const { send } = setup({ status: 400, body: '{"reason":"IdleTimeout"}', headers: {} });
    expect(await send(target, update)).toEqual({ ok: false, permanent: false, retryAfterMs: 60_000, reason: 'IdleTimeout' });
  });

  it('전송 오류는 개인정보 없이 재시도로 분류한다', async () => {
    const send = createApnsSender(config, { transport: async () => { throw new Error(target.pushToken); }, now: () => at });
    expect(await send(target, update)).toEqual({ ok: false, permanent: false, retryAfterMs: 60_000, reason: 'TransportError' });
  });

  it('잘못된 token·날짜·4KB 초과 payload는 보내지 않고 이유를 구분한다', async () => {
    const { send, transport } = setup();
    expect(await send({ ...target, pushToken: '../secret' }, update)).toMatchObject({ permanent: true, invalidToken: true, reason: 'InvalidPushToken' });
    expect(await send(target, { ...update, state: { ...state, nextStartISO: 'not-a-date' } })).toEqual({ ok: false, permanent: true, reason: 'InvalidContentState' });
    expect(await send(target, { ...update, state: { ...state, nextTitle: '긴'.repeat(2000) } })).toEqual({ ok: false, permanent: true, reason: 'PayloadTooLarge' });
    expect(transport).not.toHaveBeenCalled();
  });
});

describe('HTTP/2 transport', () => {
  it('응답 전에 stream이 끊겨도 대기 상태에 남지 않고 실패한다', async () => {
    const server = createServer();
    server.on('stream', (stream) => { stream.close(); });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as AddressInfo).port;
    const transport = createHttp2ApnsTransport(() => connect(`http://127.0.0.1:${port}`));
    try {
      const { requests, send } = setup();
      await send(target, update);
      await expect(transport(requests[0]!)).rejects.toThrow();
    } finally {
      transport.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('실제 HTTP/2 응답을 읽고 같은 환경의 연결을 재사용한다', async () => {
    const paths: string[] = [];
    const server = createServer();
    server.on('stream', (stream, headers) => {
      paths.push(String(headers[':path']));
      stream.respond({ ':status': 410, 'apns-id': 'test-id' });
      stream.end('{"reason":"Unregistered"}');
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as AddressInfo).port;
    const open = vi.fn(() => connect(`http://127.0.0.1:${port}`));
    const transport = createHttp2ApnsTransport(open);
    try {
      const { requests, send } = setup();
      await send(target, update);
      const first = await transport(requests[0]!);
      const second = await transport(requests[0]!);
      expect(first).toMatchObject({ status: 410, body: '{"reason":"Unregistered"}', headers: { 'apns-id': 'test-id' } });
      expect(second.status).toBe(410);
      expect(paths).toHaveLength(2);
      expect(open).toHaveBeenCalledTimes(1);
    } finally {
      transport.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
