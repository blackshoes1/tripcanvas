import type { Trip } from '@/features/trip/domain/types';
import { PgLegCacheRepository } from '../infrastructure/database/pgLegCacheRepository';
import { legRequestsFor, toLegCache } from '../routing/legFiller';
import type { HealthComponent } from '../api/health';
import { getEnv } from '../config/env';
import { getDb } from '../infrastructure/database/client';
import { PgLiveActivityRepository } from '../infrastructure/database/pgLiveActivityRepository';
import { createApnsSender } from './apns';
import { readApnsConfig } from './apnsConfig';
import { runLiveActivityBatch } from './worker';

type ConfigStatus = 'unconfigured' | 'invalid' | 'configured';
type Worker = { close(): void; lastError: boolean };
const globalWorker = globalThis as typeof globalThis & { liveActivityWorker?: Worker };

export function liveActivityConfigStatus(): ConfigStatus {
  try { return readApnsConfig(process.env) ? 'configured' : 'unconfigured'; }
  catch { return 'invalid'; }
}

export function liveActivityWorkerStatus(): ConfigStatus | 'running' | 'error' | 'disabled' {
  const status = liveActivityConfigStatus();
  if (status !== 'configured') return status;
  const worker = globalWorker.liveActivityWorker;
  if (worker) return worker.lastError ? 'error' : 'running';
  return 'disabled';
}

export function liveActivityHealth(): HealthComponent {
  const status = liveActivityWorkerStatus();
  if (status === 'unconfigured') return { status: 'unconfigured' };
  if (status === 'running') return { status: 'ok', detail: '서버 갱신 worker 실행 중 — 기기 도착 여부는 별도 확인' };
  return { status: 'error', detail: status === 'invalid' ? 'APNs 설정 오류'
    : status === 'disabled' ? '서버 갱신 worker가 실행되지 않음' : '서버 갱신 worker 오류' };
}

/** NAS의 상시 실행 Node 서버 전용. serverless나 빌드에서는 장기 타이머를 만들지 않는다. */
export function startLiveActivityWorker(): void {
  if (globalWorker.liveActivityWorker || process.env.NODE_ENV === 'test'
    || process.env.NEXT_PHASE === 'phase-production-build' || process.env.VERCEL) return;
  const env = getEnv();
  if (!env.newAuthEnabled || env.registry.TRIP !== 'NEW_BACKEND' || env.readOnly) return;
  let config;
  try { config = readApnsConfig(process.env); }
  catch { console.error('[live-activity] APNS_CONFIGURATION_INVALID'); return; }
  if (!config) return;
  const db = getDb();
  if (!db) return;
  const repo = new PgLiveActivityRepository(db);
  const legs = new PgLegCacheRepository(db);
  const send = createApnsSender(config);
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const result = await runLiveActivityBatch({ repo, send,
        cachedLegs: async (trip, dayIndex) => toLegCache(await legs.getMany(
          legRequestsFor(trip as unknown as Trip, dayIndex).map(request => request.key)))
      });
      if (result.failed) worker.lastError = true;
      else if (result.sent) worker.lastError = false;
    }
    catch { worker.lastError = true; console.error('[live-activity] WORKER_FAILED'); }
    finally { running = false; }
  };
  const timer = setInterval(() => { void tick(); }, 5_000);
  timer.unref();
  const worker: Worker = { lastError: false, close() {
    clearInterval(timer); send.close();
    delete globalWorker.liveActivityWorker;
    process.off('SIGTERM', worker.close); process.off('SIGINT', worker.close);
  } };
  globalWorker.liveActivityWorker = worker;
  process.once('SIGTERM', worker.close); process.once('SIGINT', worker.close);
  void tick();
}
