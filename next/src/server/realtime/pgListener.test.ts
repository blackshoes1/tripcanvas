// LISTEN 연결 — 실시간의 목숨줄이다. 끊긴 채로 조용히 살아 있으면 "실시간이 안 되는데 아무도 모르는" 상태가 된다.
// 그래서 끊기면 다시 붙고 다시 LISTEN하며, 상태를 밖으로 알린다(운영 점검·헬스체크가 본다).
import { describe, expect, it, vi } from 'vitest';

import { createPgListener, type ListenerClient } from './pgListener';

function fakeClient() {
  const queries: string[] = [];
  let onError: ((e: Error) => void) | null = null;
  let onNotify: ((payload: string) => void) | null = null;
  const client: ListenerClient = {
    connect: vi.fn(async () => {}),
    query: vi.fn(async (sql: string) => { queries.push(sql); }),
    onNotification: (fn) => { onNotify = fn; },
    onError: (fn) => { onError = fn; },
    end: vi.fn(async () => {})
  };
  return { client, queries, fail: (e: Error) => onError?.(e), notify: (p: string) => onNotify?.(p) };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('createPgListener', () => {
  it('붙으면 LISTEN하고 알림을 그대로 넘긴다', async () => {
    const f = fakeClient();
    const got: string[] = [];
    const listener = createPgListener({ channel: 'tc_realtime', connect: async () => f.client, onPayload: (p) => got.push(p), retryDelayMs: 10 });
    await listener.start();
    expect(f.queries).toEqual(['listen "tc_realtime"']);
    expect(listener.status()).toBe('LISTENING');
    f.notify('{"a":1}');
    expect(got).toEqual(['{"a":1}']);
    await listener.stop();
    expect(f.client.end).toHaveBeenCalled();
    expect(listener.status()).toBe('STOPPED');
  });

  it('연결이 끊기면 다시 붙어 다시 LISTEN한다 — 새 연결에서', async () => {
    const first = fakeClient(); const second = fakeClient();
    const clients = [first.client, second.client];
    const log = vi.fn();
    const listener = createPgListener({
      channel: 'tc_realtime', connect: async () => clients.shift()!, onPayload: () => {}, retryDelayMs: 1, log
    });
    await listener.start();
    first.fail(new Error('connection terminated'));
    expect(listener.status()).toBe('RECONNECTING');
    await new Promise((r) => setTimeout(r, 30));
    expect(second.queries).toEqual(['listen "tc_realtime"']);
    expect(listener.status()).toBe('LISTENING');
    expect(log).toHaveBeenCalled();
    await listener.stop();
  });

  it('처음 연결이 실패해도 포기하지 않고 다시 시도한다', async () => {
    const good = fakeClient();
    let attempts = 0;
    const listener = createPgListener({
      channel: 'tc_realtime', retryDelayMs: 1, onPayload: () => {}, log: vi.fn(),
      connect: async () => { if (attempts++ < 2) throw new Error('ECONNREFUSED'); return good.client; }
    });
    await listener.start();
    await new Promise((r) => setTimeout(r, 40));
    expect(attempts).toBe(3);
    expect(listener.status()).toBe('LISTENING');
    await listener.stop();
  });

  it('멈춘 뒤에는 다시 붙지 않는다', async () => {
    const f = fakeClient();
    let connects = 0;
    const listener = createPgListener({
      channel: 'tc_realtime', retryDelayMs: 1, onPayload: () => {}, log: vi.fn(),
      connect: async () => { connects++; return f.client; }
    });
    await listener.start();
    await listener.stop();
    f.fail(new Error('too late'));
    await flush();
    await new Promise((r) => setTimeout(r, 20));
    expect(connects).toBe(1);
    expect(listener.status()).toBe('STOPPED');
  });
});
