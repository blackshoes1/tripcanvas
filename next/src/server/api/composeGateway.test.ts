// 기존 /api/v1 핸들러의 Gateway를 레지스트리에 따라 조립한다(Strangler). LEGACY면 Supabase 그대로, NEW_BACKEND면 새 저장소,
// DUAL_READ면 읽기는 두 곳의 합집합(알림·거절 키를 잃으면 같은 알림이 두 번 간다) · 쓰기는 새 저장소.
import { describe, expect, it } from 'vitest';

import type { Gateway } from '@/features/trip-state/services/handlers';
import type { MigrationRegistry } from '../config/migrationRegistry';
import type {
  DeviceRepository, MemoryRecord, MemoryRepository, NotificationLogRepository, PriceObservationRepository, SuggestionFeedbackRepository
} from '../repositories/types';
import { composeGateway } from './composeGateway';

const USER = 'u-a';
const registry = (over: Partial<MigrationRegistry>): MigrationRegistry => ({
  AUTH: 'LEGACY', TRIP: 'LEGACY', BOOKING: 'LEGACY', PRICING: 'LEGACY', ADAPTIVE: 'LEGACY', COLLAB: 'LEGACY', REALTIME: 'LEGACY', STORAGE: 'LEGACY', ...over
});

function legacyGateway(log: string[]): Gateway {
  return {
    async listTrips() { log.push('legacy.listTrips'); return []; },
    async getTrip() { log.push('legacy.getTrip'); return null; },
    async saveTrip(_id, _d, rev) { log.push('legacy.saveTrip'); return { applied: true, conflict: false, revision: rev + 1, data: null }; },
    async listDismissed() { log.push('legacy.listDismissed'); return ['legacy-key']; },
    async recordFeedback() { log.push('legacy.recordFeedback'); },
    async listPriceObservations() { log.push('legacy.listPriceObservations'); return [{ booking_id: 'b', seller: 'legacy', price: 1, currency: 'KRW', quality: null, verified: false, offers: null, observed_at: '2026-01-01T00:00:00.000Z' }]; },
    async listSentNotificationKeys() { log.push('legacy.listSentNotificationKeys'); return ['legacy-sent']; },
    async recordNotifications() { log.push('legacy.recordNotifications'); },
    async saveDevice() { log.push('legacy.saveDevice'); },
    async removeDevice() { log.push('legacy.removeDevice'); },
    async listMemories() { log.push('legacy.listMemories'); return [mem('legacy-1', 'k-legacy', 500)]; },
    async saveMemory(_t, row) { log.push('legacy.saveMemory'); return { row: { ...row, id: 'legacy-new' }, created: true }; }
  };
}
function mem(id: string, key: string | null, at: number): MemoryRecord {
  return { id, day_index: 0, activity_id: null, type: 'NOTE', caption: null, asset_refs: [], lat: null, lng: null, at_minutes: at, captured_at: '2026-09-01T00:00:00.000Z', client_key: key };
}

function newRepos(log: string[]) {
  const feedback: SuggestionFeedbackRepository = {
    async listDismissed(u) { log.push(`new.listDismissed:${u}`); return ['new-key']; },
    async record(u, _t, _d, key, action) { log.push(`new.record:${u}:${key}:${action}`); }
  };
  const notifications: NotificationLogRepository = {
    async listSentKeys(u) { log.push(`new.listSentKeys:${u}`); return ['new-sent']; },
    async record(u, _t, _d, items) { log.push(`new.recordNotifications:${u}:${items.length}`); }
  };
  const devices: DeviceRepository = {
    async save(u, r) { log.push(`new.saveDevice:${u}:${r.deviceId}`); },
    async remove(u, id) { log.push(`new.removeDevice:${u}:${id}`); }
  };
  const memories: MemoryRepository = {
    async list(u) { log.push(`new.listMemories:${u}`); return [mem('new-1', 'k-new', 400), mem('new-2', 'k-legacy', 900)]; },
    async save(u, _t, row) { log.push(`new.saveMemory:${u}`); return { row: { ...row, id: 'new-saved' }, created: true }; }
  };
  const prices: PriceObservationRepository = {
    async listForTrip(u) { log.push(`new.listForTrip:${u}`); return [{ booking_id: 'b', seller: 'new', price: 2, currency: 'KRW', quality: null, verified: true, offers: null, observed_at: '2026-02-01T00:00:00.000Z' }]; },
    async append() { log.push('new.append'); }
  };
  return { feedback, notifications, devices, memories, prices };
}

const reg = { deviceId: 'dev', platform: 'ios' as const, pushToken: 't', enabled: true, preferences: {}, appVersion: null };

describe('composeGateway', () => {
  it('LEGACY: 레거시 Gateway가 그대로다', async () => {
    const log: string[] = [];
    const gw = composeGateway({ registry: registry({}), userId: USER, legacy: legacyGateway(log), adaptive: newRepos(log), pricing: newRepos(log).prices });
    expect(await gw.listDismissed('t', '2026-09-01')).toEqual(['legacy-key']);
    await gw.saveDevice(reg);
    expect(await gw.listPriceObservations('t')).toMatchObject([{ seller: 'legacy' }]);
    expect(log).toEqual(['legacy.listDismissed', 'legacy.saveDevice', 'legacy.listPriceObservations']);
  });

  it('ADAPTIVE=NEW_BACKEND: 제안 거절·알림·기기·기록은 새 저장소(사용자 id가 붙는다), 가격은 아직 레거시', async () => {
    const log: string[] = [];
    const repos = newRepos(log);
    const gw = composeGateway({ registry: registry({ ADAPTIVE: 'NEW_BACKEND' }), userId: USER, legacy: legacyGateway(log), adaptive: repos, pricing: repos.prices });
    expect(await gw.listDismissed('t', '2026-09-01')).toEqual(['new-key']);
    await gw.recordFeedback('t', '2026-09-01', 'sug', 'SKIPPED');
    expect(await gw.listSentNotificationKeys('t', '2026-09-01')).toEqual(['new-sent']);
    await gw.recordNotifications('t', '2026-09-01', [{ kind: 'k', dedupeKey: 'd', stateVersion: 'v' }]);
    await gw.saveDevice(reg);
    await gw.removeDevice('dev');
    expect((await gw.listMemories('t', null)).map((m) => m.id)).toEqual(['new-1', 'new-2']);
    expect((await gw.saveMemory('t', mem('x', 'k', 1))).row.id).toBe('new-saved');
    expect(await gw.listPriceObservations('t')).toMatchObject([{ seller: 'legacy' }]);
    expect(log).toEqual([
      `new.listDismissed:${USER}`, `new.record:${USER}:sug:SKIPPED`, `new.listSentKeys:${USER}`, `new.recordNotifications:${USER}:1`,
      `new.saveDevice:${USER}:dev`, `new.removeDevice:${USER}:dev`, `new.listMemories:${USER}`, `new.saveMemory:${USER}`, 'legacy.listPriceObservations'
    ]);
  });

  it('ADAPTIVE=DUAL_READ: 읽기는 합집합(중복 제거), 쓰기는 새 저장소만', async () => {
    const log: string[] = [];
    const repos = newRepos(log);
    const gw = composeGateway({ registry: registry({ ADAPTIVE: 'DUAL_READ' }), userId: USER, legacy: legacyGateway(log), adaptive: repos, pricing: repos.prices });
    expect((await gw.listDismissed('t', '2026-09-01')).sort()).toEqual(['legacy-key', 'new-key']);
    expect((await gw.listSentNotificationKeys('t', '2026-09-01')).sort()).toEqual(['legacy-sent', 'new-sent']);
    // 같은 client_key는 새 쪽이 이기고, 시각 순으로 합친다
    expect((await gw.listMemories('t', null)).map((m) => m.id)).toEqual(['new-1', 'new-2']);
    await gw.recordFeedback('t', '2026-09-01', 'sug', 'SKIPPED');
    await gw.saveDevice(reg);
    expect(log.filter((l) => l.startsWith('legacy.record') || l.startsWith('legacy.save'))).toEqual([]);
  });

  it('PRICING=NEW_BACKEND / DUAL_READ: 관측 목록', async () => {
    const log: string[] = [];
    const repos = newRepos(log);
    const only = composeGateway({ registry: registry({ PRICING: 'NEW_BACKEND' }), userId: USER, legacy: legacyGateway(log), adaptive: repos, pricing: repos.prices });
    expect(await only.listPriceObservations('t')).toMatchObject([{ seller: 'new' }]);
    const dual = composeGateway({ registry: registry({ PRICING: 'DUAL_READ' }), userId: USER, legacy: legacyGateway(log), adaptive: repos, pricing: repos.prices });
    expect((await dual.listPriceObservations('t')).map((o) => o.seller)).toEqual(['legacy', 'new']);   // 관측 시각 순
  });

  it('새 저장소가 없으면(DATABASE_URL 없음) 레지스트리 값과 무관하게 레거시다', async () => {
    const log: string[] = [];
    const gw = composeGateway({ registry: registry({ ADAPTIVE: 'NEW_BACKEND', PRICING: 'NEW_BACKEND' }), userId: USER, legacy: legacyGateway(log), adaptive: null, pricing: null });
    await gw.listDismissed('t', '2026-09-01');
    await gw.listPriceObservations('t');
    expect(log).toEqual(['legacy.listDismissed', 'legacy.listPriceObservations']);
  });
});
