// 전송 계층 — 진짜 WebSocket으로 붙어 본다. 업그레이드 경로·첫 프레임 인증·방송·헬스체크가 실제로 물려 있는지 확인한다.
// (판단 규칙 자체는 hub.test.ts가, 알림은 pgNotify.test.ts가 본다.)
import { afterEach, describe, expect, it, vi } from 'vitest';
import WebSocket from 'ws';

import type { RequestContext, TokenVerifier } from '../auth/types';
import { createRealtimeHub } from './hub';
import type { PgListener } from './pgListener';
import { createRealtimeServer } from './server';

const ctx: RequestContext = { userId: 'u-a', legacySupabaseUserId: 'u-a', email: null, sessionId: null, tokenSource: 'supabase' };
const verifier: TokenVerifier = { async verify(token) { return token === 'tok-a' ? ctx : null; } };

let stop: (() => Promise<void>) | null = null;
afterEach(async () => { await stop?.(); stop = null; });

async function start(listenerStatus: 'LISTENING' | 'RECONNECTING' = 'LISTENING') {
  const hub = createRealtimeHub({
    verifier, canRead: async (_u, tripId) => tripId === 'trip1', authTimeoutMs: 5_000, heartbeatMs: 30_000
  });
  const listener = { status: () => listenerStatus } as PgListener;
  const server = createRealtimeServer({ hub, listener, port: 0, log: vi.fn() });
  await server.start();
  stop = () => server.stop();
  return { hub, server, url: `ws://127.0.0.1:${server.port()}`, http: `http://127.0.0.1:${server.port()}` };
}

/** 다음 메시지 하나 */
function next(ws: WebSocket): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    ws.once('message', (d) => resolve(JSON.parse(String(d))));
    ws.once('error', reject);
  });
}
function open(url: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    ws.once('open', () => resolve(ws));
    ws.once('error', reject);
  });
}

describe('실시간 서버', () => {
  it('인증 → 구독 → 방송이 소켓으로 흐른다', async () => {
    const { server, url } = await start();
    const ws = await open(`${url}/ws`);
    ws.send(JSON.stringify({ type: 'AUTH', token: 'tok-a' }));
    expect(await next(ws)).toEqual({ type: 'READY' });
    ws.send(JSON.stringify({ type: 'SUBSCRIBE', tripId: 'trip1' }));
    expect(await next(ws)).toEqual({ type: 'SUBSCRIBED', tripId: 'trip1' });

    const arrived = next(ws);
    server.dispatch(JSON.stringify({ tripId: 'row-1', clientId: 'trip1', id: 5, kind: 'REACTION', actorId: 'u-z' }));
    expect(await arrived).toEqual({ type: 'ACTIVITY', tripId: 'trip1', id: 5, kind: 'REACTION', mine: false });
    ws.close();
  });

  it('토큰이 틀리면 4401로 끊긴다', async () => {
    const { url } = await start();
    const ws = await open(`${url}/ws`);
    const closed = new Promise<number>((resolve) => ws.once('close', resolve));
    ws.send(JSON.stringify({ type: 'AUTH', token: 'nope' }));
    expect(await next(ws)).toEqual({ type: 'ERROR', code: 'UNAUTHORIZED' });
    expect(await closed).toBe(4401);
  });

  it('/ws가 아닌 경로로는 업그레이드되지 않는다', async () => {
    const { url } = await start();
    await expect(open(`${url}/socket`)).rejects.toThrow();
  });

  it('모르는 알림 payload는 버린다 — 구독자에게 아무것도 가지 않는다', async () => {
    const { server, url } = await start();
    const ws = await open(`${url}/ws`);
    ws.send(JSON.stringify({ type: 'AUTH', token: 'tok-a' }));
    await next(ws);
    ws.send(JSON.stringify({ type: 'SUBSCRIBE', tripId: 'trip1' }));
    await next(ws);
    const seen: unknown[] = [];
    ws.on('message', (d) => seen.push(JSON.parse(String(d))));
    server.dispatch('쓰레기');
    server.dispatch(JSON.stringify({ clientId: '', kind: 'X' }));
    await new Promise((r) => setTimeout(r, 30));
    expect(seen).toEqual([]);
    ws.close();
  });

  it('헬스체크는 LISTEN 상태를 그대로 알린다 — 끊긴 채 200을 주지 않는다', async () => {
    const ok = await start('LISTENING');
    const good = await fetch(`${ok.http}/health`);
    expect(good.status).toBe(200);
    expect(await good.json()).toMatchObject({ ok: true, listener: 'LISTENING', connections: 0, subscriptions: 0 });
    await stop?.(); stop = null;

    const broken = await start('RECONNECTING');
    const bad = await fetch(`${broken.http}/health`);
    expect(bad.status).toBe(503);
    expect(await bad.json()).toMatchObject({ ok: false, listener: 'RECONNECTING' });
  });
});
