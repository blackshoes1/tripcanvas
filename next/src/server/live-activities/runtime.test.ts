import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { liveActivityConfigStatus, liveActivityHealth, startLiveActivityWorker } from './runtime';

const mocks = vi.hoisted(() => ({ config: vi.fn(), send: Object.assign(vi.fn(), { close: vi.fn() }),
  batch: vi.fn(), env: vi.fn(), db: vi.fn() }));
vi.mock('./apnsConfig', () => ({ readApnsConfig: mocks.config }));
vi.mock('./apns', () => ({ createApnsSender: () => mocks.send }));
vi.mock('./worker', () => ({ runLiveActivityBatch: mocks.batch }));
vi.mock('../config/env', () => ({ getEnv: mocks.env }));
vi.mock('../infrastructure/database/client', () => ({ getDb: mocks.db }));
vi.mock('../infrastructure/database/pgLiveActivityRepository', () => ({ PgLiveActivityRepository: class {} }));
const root = globalThis as typeof globalThis & { liveActivityWorker?: { close(): void } };
beforeEach(() => {
  vi.useFakeTimers(); vi.clearAllMocks();
  vi.stubEnv('NODE_ENV', 'production'); vi.stubEnv('NEXT_PHASE', ''); vi.stubEnv('VERCEL', '');
  mocks.config.mockReturnValue({});
  mocks.env.mockReturnValue({ newAuthEnabled: true, registry: { TRIP: 'NEW_BACKEND' }, readOnly: false });
  mocks.db.mockReturnValue({}); mocks.batch.mockResolvedValue({ sent: 1, failed: 0 });
});
afterEach(() => { root.liveActivityWorker?.close(); vi.useRealTimers(); vi.unstubAllEnvs(); });

describe('상시 실행 Next Node 서버의 잠금화면 worker', () => {
  it('처음 시작할 때와 5초마다 실행하며 중복 register는 worker를 늘리지 않는다', async () => {
    startLiveActivityWorker(); startLiveActivityWorker();
    expect(mocks.batch).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(mocks.batch).toHaveBeenCalledTimes(2);
    expect(liveActivityHealth().status).toBe('ok');
  });
  it('이전 batch가 실행 중이면 다음 tick은 겹치지 않는다', async () => {
    let release: () => void = () => {};
    mocks.batch.mockReturnValue(new Promise<{ sent: number; failed: number }>(resolve => { release = () => resolve({ sent: 0, failed: 0 }); }));
    startLiveActivityWorker();
    await vi.advanceTimersByTimeAsync(20_000);
    expect(mocks.batch).toHaveBeenCalledTimes(1);
    release(); await Promise.resolve();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(mocks.batch).toHaveBeenCalledTimes(2);
  });
  it('실패 로그에는 DB 주소·토큰·비밀을 넣지 않으며 다음 tick에서 회복한다', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.batch.mockRejectedValueOnce(new Error('private-db-and-token'));
    startLiveActivityWorker(); await Promise.resolve(); await Promise.resolve();
    expect(liveActivityHealth().status).toBe('error');
    expect(log).toHaveBeenCalledWith('[live-activity] WORKER_FAILED');
    expect(JSON.stringify(log.mock.calls)).not.toContain('private-db');
    await vi.advanceTimersByTimeAsync(5_000);
    expect(liveActivityHealth().status).toBe('ok');
    log.mockRestore();
  });
  it('APNs 거절은 빈 batch 뒤에도 오류로 남고 실제 수락 뒤에만 회복한다', async () => {
    mocks.batch.mockResolvedValueOnce({ sent: 0, failed: 1 }).mockResolvedValueOnce({ sent: 0, failed: 0 });
    startLiveActivityWorker(); await Promise.resolve(); await Promise.resolve();
    expect(liveActivityHealth().status).toBe('error');
    await vi.advanceTimersByTimeAsync(5_000);
    expect(liveActivityHealth().status).toBe('error');
    await vi.advanceTimersByTimeAsync(5_000);
    expect(liveActivityHealth().status).toBe('ok');
  });
  it.each([['NODE_ENV', 'test'], ['NEXT_PHASE', 'phase-production-build'], ['VERCEL', '1']])('%s=%s에서는 장기 timer를 시작하지 않는다', (key, value) => {
    vi.stubEnv(key, value); startLiveActivityWorker();
    expect(mocks.batch).not.toHaveBeenCalled();
  });
  it('APNs가 비었거나 잘못되면 실행하지 않고 health가 둘을 구분한다', () => {
    mocks.config.mockReturnValue(null); startLiveActivityWorker();
    expect(liveActivityHealth().status).toBe('unconfigured');
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.config.mockImplementation(() => { throw new Error('private-key'); });
    startLiveActivityWorker();
    expect(liveActivityConfigStatus()).toBe('invalid');
    expect(liveActivityHealth()).toEqual({ status: 'error', detail: 'APNs 설정 오류' });
    expect(mocks.batch).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith('[live-activity] APNS_CONFIGURATION_INVALID');
    log.mockRestore();
  });
  it.each([{ newAuthEnabled: false }, { readOnly: true }, { registry: { TRIP: 'LEGACY' } }])('자체 Auth/새 저장소/쓰기 가능 조건이 없으면 시작하지 않는다: %s', disabled => {
    mocks.env.mockReturnValue({ newAuthEnabled: true, registry: { TRIP: 'NEW_BACKEND' }, readOnly: false, ...disabled });
    startLiveActivityWorker();
    expect(mocks.batch).not.toHaveBeenCalled();
    expect(liveActivityHealth().status).toBe('error');
  });
});
