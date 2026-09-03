// 실시간 허브 — 접속 하나의 상태 기계와 방송. 소켓은 가짜다(전송 계층은 server.ts가 얇게 감싼다).
// 보안(§84): 인증 전에는 아무것도 구독할 수 없고, 멤버가 아닌 여행은 구독되지 않으며, 토큰이 만료되면 끊는다.
import { describe, expect, it, vi } from 'vitest';

import type { RequestContext, TokenVerifier } from '../auth/types';
import { createRealtimeHub, type RealtimeSocket } from './hub';
import { parseNotification } from './events';

const ctxOf = (userId: string, expiresAt = 2_000): RequestContext => ({
  userId, legacySupabaseUserId: userId, email: null, sessionId: null, tokenSource: 'supabase', expiresAt
});
const verifier: TokenVerifier = {
  async verify(token) { return token.startsWith('tok-') ? ctxOf(`u-${token.slice(4)}`, token === 'tok-soon' ? 1_100 : 2_000) : null; }
};

function fakeSocket() {
  const sent: Record<string, unknown>[] = [];
  const closed: { code: number; reason: string }[] = [];
  const socket: RealtimeSocket = {
    send: (raw) => { sent.push(JSON.parse(raw)); },
    close: (code, reason) => { closed.push({ code: code ?? 1000, reason: reason ?? '' }); }
  };
  return { socket, sent, closed, types: () => sent.map((m) => m.type) };
}

/** 멤버십: u-a는 trip1의 멤버, u-b는 아니다 */
const canRead = async (userId: string, tripId: string) => userId === 'u-a' && tripId === 'trip1';

function setup(opts: { now?: () => number } = {}) {
  let now = 1_000_000;
  const hub = createRealtimeHub({
    verifier, canRead, authTimeoutMs: 5_000, heartbeatMs: 30_000,
    now: opts.now ?? (() => now)
  });
  return { hub, advance: (ms: number) => { now += ms; } };
}
const evt = (kind: string, actorId: string, id = 1) => parseNotification(JSON.stringify({
  tripId: 'row-1', clientId: 'trip1', id, kind, actorId
}))!;

describe('인증', () => {
  it('AUTH 전에는 구독할 수 없다 — 오류를 주고 끊는다', async () => {
    const { hub } = setup();
    const s = fakeSocket();
    const conn = hub.connect(s.socket);
    await conn.receive(JSON.stringify({ type: 'SUBSCRIBE', tripId: 'trip1' }));
    expect(s.sent).toEqual([{ type: 'ERROR', code: 'UNAUTHORIZED' }]);
    expect(s.closed[0].code).toBe(4401);
  });

  it('토큰이 틀리면 UNAUTHORIZED로 끊는다', async () => {
    const { hub } = setup();
    const s = fakeSocket();
    await hub.connect(s.socket).receive(JSON.stringify({ type: 'AUTH', token: 'nope' }));
    expect(s.sent).toEqual([{ type: 'ERROR', code: 'UNAUTHORIZED' }]);
    expect(s.closed[0].code).toBe(4401);
  });

  it('제한 시간 안에 AUTH가 없으면 끊는다', async () => {
    const { hub, advance } = setup();
    const s = fakeSocket();
    hub.connect(s.socket);
    advance(4_000); hub.sweep();
    expect(s.closed).toEqual([]);
    advance(2_000); hub.sweep();
    expect(s.closed[0].code).toBe(4408);
  });

  it('AUTH가 되면 READY, 그 다음 구독할 수 있다', async () => {
    const { hub } = setup();
    const s = fakeSocket();
    const conn = hub.connect(s.socket);
    await conn.receive(JSON.stringify({ type: 'AUTH', token: 'tok-a' }));
    expect(s.sent).toEqual([{ type: 'READY' }]);
    await conn.receive(JSON.stringify({ type: 'SUBSCRIBE', tripId: 'trip1' }));
    expect(s.sent[1]).toEqual({ type: 'SUBSCRIBED', tripId: 'trip1' });
  });

  it('엉뚱한 메시지는 BAD_REQUEST일 뿐 접속을 끊지 않는다', async () => {
    const { hub } = setup();
    const s = fakeSocket();
    const conn = hub.connect(s.socket);
    await conn.receive(JSON.stringify({ type: 'AUTH', token: 'tok-a' }));
    await conn.receive('not json');
    await conn.receive(JSON.stringify({ type: 'WAT' }));
    expect(s.types()).toEqual(['READY', 'ERROR', 'ERROR']);
    expect(s.sent[1]).toEqual({ type: 'ERROR', code: 'BAD_REQUEST' });
    expect(s.closed).toEqual([]);
  });
});

describe('구독과 권한', () => {
  it('멤버가 아닌 여행은 구독되지 않는다 — 방송도 오지 않는다', async () => {
    const { hub } = setup();
    const s = fakeSocket();
    const conn = hub.connect(s.socket);
    await conn.receive(JSON.stringify({ type: 'AUTH', token: 'tok-b' }));
    await conn.receive(JSON.stringify({ type: 'SUBSCRIBE', tripId: 'trip1' }));
    expect(s.sent[1]).toEqual({ type: 'ERROR', code: 'FORBIDDEN', tripId: 'trip1' });
    hub.publish(evt('REACTION', 'u-a'));
    expect(s.types()).toEqual(['READY', 'ERROR']);
  });

  it('구독한 사람에게만, 여행별로 간다. mine은 구독자마다 계산한다', async () => {
    const { hub } = setup();
    const a1 = fakeSocket(); const a2 = fakeSocket(); const other = fakeSocket();
    for (const s of [a1, a2]) {
      const conn = hub.connect(s.socket);
      await conn.receive(JSON.stringify({ type: 'AUTH', token: 'tok-a' }));
      await conn.receive(JSON.stringify({ type: 'SUBSCRIBE', tripId: 'trip1' }));
    }
    await hub.connect(other.socket).receive(JSON.stringify({ type: 'AUTH', token: 'tok-b' }));   // 구독 안 함
    hub.publish(evt('CANDIDATE_PROPOSED', 'u-a', 7));
    expect(a1.sent[2]).toEqual({ type: 'ACTIVITY', tripId: 'trip1', id: 7, kind: 'CANDIDATE_PROPOSED', mine: true });
    expect(a2.sent[2]).toMatchObject({ id: 7, mine: true });
    hub.publish(evt('REACTION', 'u-z', 8));
    expect(a1.sent[3]).toMatchObject({ id: 8, mine: false });
    expect(other.types()).toEqual(['READY']);
    expect(hub.stats()).toMatchObject({ connections: 3, subscriptions: 2 });
  });

  it('구독을 거두거나 접속이 끊기면 더는 오지 않는다', async () => {
    const { hub } = setup();
    const s = fakeSocket();
    const conn = hub.connect(s.socket);
    await conn.receive(JSON.stringify({ type: 'AUTH', token: 'tok-a' }));
    await conn.receive(JSON.stringify({ type: 'SUBSCRIBE', tripId: 'trip1' }));
    await conn.receive(JSON.stringify({ type: 'UNSUBSCRIBE', tripId: 'trip1' }));
    hub.publish(evt('REACTION', 'u-z'));
    expect(s.types()).toEqual(['READY', 'SUBSCRIBED', 'UNSUBSCRIBED']);

    await conn.receive(JSON.stringify({ type: 'SUBSCRIBE', tripId: 'trip1' }));
    conn.disconnected();
    hub.publish(evt('REACTION', 'u-z'));
    expect(s.types()).toEqual(['READY', 'SUBSCRIBED', 'UNSUBSCRIBED', 'SUBSCRIBED']);
    expect(hub.stats()).toEqual({ connections: 0, subscriptions: 0 });
  });

  it('보낼 때 소켓이 터져도 다른 구독자에게는 간다', async () => {
    const { hub } = setup();
    const broken = fakeSocket(); const good = fakeSocket();
    broken.socket.send = () => { throw new Error('socket gone'); };
    for (const s of [broken, good]) {
      const conn = hub.connect(s.socket);
      await conn.receive(JSON.stringify({ type: 'AUTH', token: 'tok-a' }));
      await conn.receive(JSON.stringify({ type: 'SUBSCRIBE', tripId: 'trip1' }));
    }
    hub.publish(evt('REACTION', 'u-z'));
    expect(good.sent.at(-1)).toMatchObject({ type: 'ACTIVITY' });
    expect(hub.stats().connections).toBe(1);   // 터진 쪽은 정리된다
  });
});

describe('수명', () => {
  it('토큰이 만료되면 끊는다 — 나간 사람의 소켓이 계속 듣고 있지 않게', async () => {
    const { hub, advance } = setup();
    const s = fakeSocket();
    const conn = hub.connect(s.socket);
    await conn.receive(JSON.stringify({ type: 'AUTH', token: 'tok-soon' }));   // exp 1_100초
    await conn.receive(JSON.stringify({ type: 'SUBSCRIBE', tripId: 'trip1' }));
    hub.sweep();
    expect(s.closed).toEqual([]);
    advance(200_000);   // 1_000초 + 200초 → exp를 지난다
    hub.sweep();
    expect(s.closed[0].code).toBe(4440);
    expect(hub.stats()).toEqual({ connections: 0, subscriptions: 0 });
  });

  it('PING에 PONG이 없으면 다음 주기에 끊는다', async () => {
    const { hub, advance } = setup();
    const alive = fakeSocket(); const dead = fakeSocket();
    for (const s of [alive, dead]) await hub.connect(s.socket).receive(JSON.stringify({ type: 'AUTH', token: 'tok-a' }));
    advance(30_000); hub.sweep();
    expect(alive.types().at(-1)).toBe('PING');
    await hub.connectionsFor('u-a')[0].receive(JSON.stringify({ type: 'PONG' }));   // alive만 답한다
    advance(30_000); hub.sweep();
    expect(dead.closed[0].code).toBe(4408);
    expect(alive.closed).toEqual([]);
  });

  it('close()는 모든 접속을 정리한다', async () => {
    const { hub } = setup();
    const s = fakeSocket();
    await hub.connect(s.socket).receive(JSON.stringify({ type: 'AUTH', token: 'tok-a' }));
    hub.closeAll();
    expect(s.closed[0].code).toBe(1001);
    expect(hub.stats().connections).toBe(0);
  });
});

describe('멤버십 확인 실패', () => {
  it('DB가 안 되면 구독을 열어 주지 않는다(닫힌 쪽으로)', async () => {
    const hub = createRealtimeHub({
      verifier, canRead: async () => { throw new Error('db down'); },
      authTimeoutMs: 5_000, heartbeatMs: 30_000, now: () => 1_000_000, log: vi.fn()
    });
    const s = fakeSocket();
    const conn = hub.connect(s.socket);
    await conn.receive(JSON.stringify({ type: 'AUTH', token: 'tok-a' }));
    await conn.receive(JSON.stringify({ type: 'SUBSCRIBE', tripId: 'trip1' }));
    expect(s.sent[1]).toEqual({ type: 'ERROR', code: 'FORBIDDEN', tripId: 'trip1' });
  });
});
