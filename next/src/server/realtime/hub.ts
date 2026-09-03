// 실시간 허브 — 접속 하나의 상태 기계와 방송. 전송 계층(ws)은 server.ts가 얇게 감싸고, 판단은 전부 여기 있다(테스트 가능하게).
//
// 상태: 접속 → (AUTH) → READY → (SUBSCRIBE) → 여행별 구독.
//   · 인증 전에는 아무것도 구독할 수 없다. 제한 시간 안에 AUTH가 없으면 끊는다.
//   · 구독은 **멤버십을 서버가 확인**한 뒤에만 열린다(§41 — 화면이 감추는 것으로 보안을 만들지 않는다).
//   · 토큰이 만료되면 끊는다 — 나간 사람의 소켓이 계속 듣고 있으면 안 된다(§84).
//   · 심장박동(PING/PONG)으로 죽은 접속을 정리한다. 이 서버는 상태를 갖지만 **진실은 PostgreSQL**이다(§45).
import type { RequestContext, TokenVerifier } from '../auth/types';
import { messageFor, type RealtimeEvent } from './events';

/** ws.WebSocket의 최소 계약 — 테스트는 가짜를 넣는다 */
export interface RealtimeSocket {
  send(data: string): void;
  close(code?: number, reason?: string): void;
}

export interface RealtimeConnection {
  /** 클라이언트가 보낸 한 프레임 */
  receive(raw: string): Promise<void>;
  /** 소켓이 닫혔다(피어가 끊었거나 우리가 끊었다) */
  disconnected(): void;
}

export interface RealtimeHubOptions {
  verifier: TokenVerifier;
  /** 이 사용자가 이 여행(client_id)을 볼 수 있는가 — 소유자 또는 활성 멤버 */
  canRead(userId: string, tripId: string): Promise<boolean>;
  authTimeoutMs: number;
  heartbeatMs: number;
  now?: () => number;
  log?: (message: string, error?: unknown) => void;
}

export const CLOSE = { UNAUTHORIZED: 4401, TIMEOUT: 4408, EXPIRED: 4440, GOING_AWAY: 1001 } as const;

interface Conn {
  socket: RealtimeSocket;
  ctx: RequestContext | null;
  /** 구독한 여행(client_id) */
  trips: Set<string>;
  connectedAt: number;
  /** 마지막으로 살아 있음을 확인한 시각 — PING을 보낸 뒤 PONG으로 갱신된다 */
  seenAt: number;
  pinged: boolean;
  handle: RealtimeConnection;
}

export function createRealtimeHub(opts: RealtimeHubOptions) {
  const now = opts.now ?? (() => Date.now());
  const log = opts.log ?? ((m: string, e?: unknown) => console.warn(`[tripcanvas-realtime] ${m}`, e ?? ''));
  const conns = new Set<Conn>();

  function send(conn: Conn, message: Record<string, unknown>): void {
    try {
      conn.socket.send(JSON.stringify(message));
    } catch (e) {
      log('send 실패 — 접속을 정리한다', e);
      drop(conn);
    }
  }
  function drop(conn: Conn, code?: number, reason?: string): void {
    if (!conns.delete(conn)) return;
    conn.trips.clear();
    if (code != null) { try { conn.socket.close(code, reason); } catch { /* 이미 닫힌 소켓 */ } }
  }

  async function handle(conn: Conn, raw: string): Promise<void> {
    let msg: Record<string, unknown>;
    try {
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not an object');
      msg = parsed as Record<string, unknown>;
    } catch {
      send(conn, { type: 'ERROR', code: 'BAD_REQUEST' });
      return;
    }
    const type = String(msg.type ?? '');

    if (type === 'AUTH') {
      const token = typeof msg.token === 'string' ? msg.token : '';
      const ctx = token ? await opts.verifier.verify(token) : null;
      if (!ctx) {
        send(conn, { type: 'ERROR', code: 'UNAUTHORIZED' });
        drop(conn, CLOSE.UNAUTHORIZED, 'unauthorized');
        return;
      }
      conn.ctx = ctx;
      conn.seenAt = now();
      send(conn, { type: 'READY' });
      return;
    }

    if (!conn.ctx) {
      send(conn, { type: 'ERROR', code: 'UNAUTHORIZED' });
      drop(conn, CLOSE.UNAUTHORIZED, 'authenticate first');
      return;
    }
    conn.seenAt = now();
    conn.pinged = false;

    if (type === 'PONG') return;

    if (type === 'SUBSCRIBE' || type === 'UNSUBSCRIBE') {
      const tripId = typeof msg.tripId === 'string' ? msg.tripId : '';
      if (!tripId) { send(conn, { type: 'ERROR', code: 'BAD_REQUEST' }); return; }
      if (type === 'UNSUBSCRIBE') {
        conn.trips.delete(tripId);
        send(conn, { type: 'UNSUBSCRIBED', tripId });
        return;
      }
      let allowed = false;
      try {
        allowed = await opts.canRead(conn.ctx.userId, tripId);
      } catch (e) {
        // 확인할 수 없으면 열어 주지 않는다 — 닫힌 쪽으로 실패한다
        log('멤버십 확인 실패', e);
      }
      if (!allowed) { send(conn, { type: 'ERROR', code: 'FORBIDDEN', tripId }); return; }
      conn.trips.add(tripId);
      send(conn, { type: 'SUBSCRIBED', tripId });
      return;
    }

    send(conn, { type: 'ERROR', code: 'BAD_REQUEST' });
  }

  return {
    connect(socket: RealtimeSocket): RealtimeConnection {
      const conn: Conn = {
        socket, ctx: null, trips: new Set(), connectedAt: now(), seenAt: now(), pinged: false,
        handle: { receive: async () => {}, disconnected: () => {} }
      };
      conn.handle = {
        receive: (raw: string) => handle(conn, raw),
        disconnected: () => drop(conn)
      };
      conns.add(conn);
      return conn.handle;
    },

    /** 알림 하나를 그 여행 구독자에게. mine은 구독자마다 계산한다 */
    publish(event: RealtimeEvent): void {
      for (const conn of [...conns]) {
        if (!conn.ctx || !conn.trips.has(event.clientId)) continue;
        send(conn, messageFor(event, conn.ctx.userId) as unknown as Record<string, unknown>);
      }
    },

    /** 주기적으로 부른다: 인증 지연·토큰 만료·죽은 접속 정리 */
    sweep(): void {
      const t = now();
      for (const conn of [...conns]) {
        if (!conn.ctx) {
          if (t - conn.connectedAt >= opts.authTimeoutMs) drop(conn, CLOSE.TIMEOUT, 'auth timeout');
          continue;
        }
        const exp = conn.ctx.expiresAt;
        if (exp != null && t >= exp * 1000) { drop(conn, CLOSE.EXPIRED, 'token expired'); continue; }
        if (t - conn.seenAt < opts.heartbeatMs) continue;
        if (conn.pinged) { drop(conn, CLOSE.TIMEOUT, 'heartbeat timeout'); continue; }
        conn.pinged = true;
        send(conn, { type: 'PING' });
      }
    },

    closeAll(): void {
      for (const conn of [...conns]) drop(conn, CLOSE.GOING_AWAY, 'server shutting down');
    },

    stats(): { connections: number; subscriptions: number } {
      let subscriptions = 0;
      for (const conn of conns) subscriptions += conn.trips.size;
      return { connections: conns.size, subscriptions };
    },

    /** 테스트·운영 점검용 — 이 사용자의 접속들 */
    connectionsFor(userId: string): RealtimeConnection[] {
      return [...conns].filter((c) => c.ctx?.userId === userId).map((c) => c.handle);
    }
  };
}

export type RealtimeHub = ReturnType<typeof createRealtimeHub>;
