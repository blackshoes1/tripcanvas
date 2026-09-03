// 실시간 사이드카의 전송 계층 — ws와 http만 감싼다. 판단은 전부 hub.ts에 있다.
//
// 왜 사이드카인가: Next Route Handler는 WebSocket 업그레이드를 다루지 않는다. 별도 프로세스로 두면
// Vercel(정적·API)과 NAS(전체)가 같은 코드를 쓰면서, 소켓이 필요한 곳에서만 이 프로세스를 띄울 수 있다.
// 상태(누가 무엇을 구독하는가)는 이 프로세스 안에만 있고 **진실은 PostgreSQL**이다 — 죽어도 앱은 그대로 돈다(§45).
import { createServer, type Server } from 'node:http';
import { WebSocketServer } from 'ws';

import { parseNotification } from './events';
import type { RealtimeHub } from './hub';
import type { PgListener } from './pgListener';

export interface RealtimeServerOptions {
  hub: RealtimeHub;
  listener: PgListener;
  port: number;
  /** WebSocket 경로. 리버스 프록시가 이 경로만 넘긴다 */
  path?: string;
  sweepIntervalMs?: number;
  log?: (message: string, error?: unknown) => void;
}

export function createRealtimeServer(opts: RealtimeServerOptions) {
  const path = opts.path ?? '/ws';
  const log = opts.log ?? ((m: string, e?: unknown) => console.log(`[tripcanvas-realtime] ${m}`, e ?? ''));
  const wss = new WebSocketServer({ noServer: true, maxPayload: 16 * 1024 });
  let sweeper: ReturnType<typeof setInterval> | null = null;

  const http: Server = createServer((req, res) => {
    if (req.url === '/health') {
      // LISTEN이 붙어 있지 않으면 실시간이 죽은 것이다 — 조용히 살아 있지 않게 상태를 그대로 알린다
      const listening = opts.listener.status() === 'LISTENING';
      res.writeHead(listening ? 200 : 503, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
      res.end(JSON.stringify({ ok: listening, listener: opts.listener.status(), ...opts.hub.stats() }));
      return;
    }
    res.writeHead(404, { 'content-type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ code: 'NOT_FOUND', error: 'NOT_FOUND', message: '없는 경로입니다.' }));
  });

  http.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (url.pathname !== path) { socket.destroy(); return; }
    wss.handleUpgrade(req, socket, head, (ws) => {
      // 토큰은 첫 프레임(AUTH)으로 받는다 — 쿼리스트링에 실으면 프록시·접근 로그에 그대로 남는다
      const conn = opts.hub.connect({
        send: (data) => ws.send(data),
        close: (code, reason) => ws.close(code, reason)
      });
      ws.on('message', (data) => { void conn.receive(String(data)); });
      ws.on('close', () => conn.disconnected());
      ws.on('error', () => conn.disconnected());
    });
  });

  return {
    async start(): Promise<void> {
      await new Promise<void>((resolve) => http.listen(opts.port, resolve));
      sweeper = setInterval(() => opts.hub.sweep(), opts.sweepIntervalMs ?? 15_000);
      log(`실시간 서버 준비됨 — ws://0.0.0.0:${opts.port}${path}`);
    },
    /** 실제로 붙은 포트. 설정이 0이면 임의 포트라 여기서 확인한다 */
    port(): number {
      const address = http.address();
      return address && typeof address === 'object' ? address.port : opts.port;
    },
    /** LISTEN이 준 payload 한 줄 → 허브 방송 */
    dispatch(payload: string): void {
      const event = parseNotification(payload);
      if (!event) { log('모르는 알림 payload를 버렸다'); return; }
      opts.hub.publish(event);
    },
    async stop(): Promise<void> {
      if (sweeper) { clearInterval(sweeper); sweeper = null; }
      opts.hub.closeAll();
      wss.close();
      await new Promise<void>((resolve) => http.close(() => resolve()));
    }
  };
}
