// PostgreSQL LISTEN — 트리거(0004)가 커밋 시점에 보낸 알림을 받는다. **전용 연결**이 필요해 Pool을 쓰지 않는다.
//
// 끊긴 LISTEN은 조용하다. 아무 오류도 안 나고 이벤트만 영원히 오지 않는다 — 그래서 다시 붙고, 상태를 밖으로 알린다
// (헬스체크가 이 값을 본다). PostgreSQL이 진실이므로 끊긴 동안 놓친 알림은 복구하지 않는다:
// 클라이언트는 탭 복귀·패널 열기에 API로 다시 읽는 폴백이 있다(§45).
export interface ListenerClient {
  connect(): Promise<void>;
  query(sql: string): Promise<unknown>;
  onNotification(handler: (payload: string) => void): void;
  onError(handler: (error: Error) => void): void;
  end(): Promise<void>;
}

export type ListenerStatus = 'IDLE' | 'CONNECTING' | 'LISTENING' | 'RECONNECTING' | 'STOPPED';

export interface PgListenerOptions {
  channel: string;
  connect(): Promise<ListenerClient>;
  onPayload(payload: string): void;
  retryDelayMs?: number;
  log?: (message: string, error?: unknown) => void;
}

export function createPgListener(opts: PgListenerOptions) {
  const retry = opts.retryDelayMs ?? 2_000;
  const log = opts.log ?? ((m: string, e?: unknown) => console.warn(`[tripcanvas-realtime] ${m}`, e ?? ''));
  let status: ListenerStatus = 'IDLE';
  let client: ListenerClient | null = null;
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  async function attach(): Promise<void> {
    if (stopped) return;
    status = status === 'IDLE' ? 'CONNECTING' : status;
    try {
      const next = await opts.connect();
      if (stopped) { await next.end().catch(() => {}); return; }
      next.onNotification(opts.onPayload);
      next.onError((e) => {
        if (stopped || client !== next) return;
        log('LISTEN 연결이 끊겼다 — 다시 붙는다', e);
        client = null;
        status = 'RECONNECTING';
        next.end().catch(() => {});
        schedule();
      });
      await next.connect();
      await next.query(`listen "${opts.channel}"`);
      client = next;
      status = 'LISTENING';
    } catch (e) {
      if (stopped) return;
      log('LISTEN 연결 실패 — 다시 시도한다', e);
      status = 'RECONNECTING';
      schedule();
    }
  }

  function schedule(): void {
    if (stopped || timer) return;
    timer = setTimeout(() => { timer = null; void attach(); }, retry);
  }

  return {
    async start(): Promise<void> {
      stopped = false;
      await attach();
    },
    async stop(): Promise<void> {
      stopped = true;
      status = 'STOPPED';
      if (timer) { clearTimeout(timer); timer = null; }
      const current = client;
      client = null;
      if (current) await current.end().catch(() => {});
    },
    status(): ListenerStatus { return status; }
  };
}

export type PgListener = ReturnType<typeof createPgListener>;

/** 운영용 — node-postgres 한 연결. LISTEN은 Pool에서 쓰면 안 된다(연결이 돌아가면 구독이 사라진다) */
export async function pgClientFactory(connectionString: string): Promise<ListenerClient> {
  const { Client } = await import('pg');
  const client = new Client({ connectionString });
  return {
    connect: async () => { await client.connect(); },
    query: (sql: string) => client.query(sql),
    onNotification: (handler) => { client.on('notification', (n) => { if (n.payload) handler(n.payload); }); },
    onError: (handler) => { client.on('error', handler); },
    end: () => client.end()
  };
}
