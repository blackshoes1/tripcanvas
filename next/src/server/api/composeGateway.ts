// 기존 /api/v1 핸들러의 Gateway를 레지스트리로 조립한다(Strangler). 핸들러는 그대로고, 메서드만 새 저장소로 바꿔 끼운다.
//   LEGACY       레거시 Gateway 그대로
//   NEW_BACKEND  새 저장소
//   DUAL_READ    읽기는 합집합(거절·알림 키를 잃으면 같은 제안·알림이 두 번 온다) · 쓰기는 새 저장소만(dual write 금지, §33)
// 새 저장소가 없으면(DATABASE_URL 없음) 레지스트리 값과 무관하게 레거시다.
import type { Gateway } from '@/features/trip-state/services/handlers';
import type { MigrationRegistry, MigrationState } from '../config/migrationRegistry';
import type {
  DeviceRepository, MemoryRecord, MemoryRepository, NotificationLogRepository, PriceObservationRepository, SuggestionFeedbackRepository
} from '../repositories/types';

export interface AdaptiveRepositories {
  feedback: SuggestionFeedbackRepository;
  notifications: NotificationLogRepository;
  devices: DeviceRepository;
  memories: MemoryRepository;
}

export interface ComposeGatewayInput {
  registry: MigrationRegistry;
  userId: string;
  legacy: Gateway;
  adaptive: AdaptiveRepositories | null;
  pricing: PriceObservationRepository | null;
}

function union(a: string[], b: string[]): string[] {
  return [...new Set([...a, ...b])];
}

/** 같은 client_key(또는 id)는 새 쪽이 이기고, 현지 시각 순 */
function mergeMemories(fresh: MemoryRecord[], legacy: MemoryRecord[]): MemoryRecord[] {
  const keys = new Set(fresh.map((m) => m.client_key ?? `id:${m.id}`));
  const extra = legacy.filter((m) => !keys.has(m.client_key ?? `id:${m.id}`));
  return [...fresh, ...extra].sort((x, y) => (x.at_minutes ?? 0) - (y.at_minutes ?? 0));
}

export function composeGateway(input: ComposeGatewayInput): Gateway {
  const { legacy, userId } = input;
  const adaptive: MigrationState = input.adaptive ? input.registry.ADAPTIVE : 'LEGACY';
  const pricing: MigrationState = input.pricing ? input.registry.PRICING : 'LEGACY';
  const gw: Gateway = { ...legacy };

  if (adaptive !== 'LEGACY') {
    const repos = input.adaptive!;
    const dual = adaptive === 'DUAL_READ';
    gw.listDismissed = async (tripId, dayISO) => {
      const fresh = await repos.feedback.listDismissed(userId, tripId, dayISO);
      return dual ? union(fresh, await legacy.listDismissed(tripId, dayISO)) : fresh;
    };
    gw.recordFeedback = (tripId, dayISO, key, action) => repos.feedback.record(userId, tripId, dayISO, key, action, 'ios');
    gw.listSentNotificationKeys = async (tripId, dayISO) => {
      const fresh = await repos.notifications.listSentKeys(userId, tripId, dayISO);
      return dual ? union(fresh, await legacy.listSentNotificationKeys(tripId, dayISO)) : fresh;
    };
    gw.recordNotifications = (tripId, dayISO, items) => repos.notifications.record(userId, tripId, dayISO, items);
    gw.saveDevice = (registration) => repos.devices.save(userId, registration);
    gw.removeDevice = (deviceId) => repos.devices.remove(userId, deviceId);
    gw.listMemories = async (tripId, dayIndex) => {
      const fresh = await repos.memories.list(userId, tripId, dayIndex);
      return dual ? mergeMemories(fresh, await legacy.listMemories(tripId, dayIndex)) : fresh;
    };
    gw.saveMemory = (tripId, row) => repos.memories.save(userId, tripId, row);
  }

  if (pricing !== 'LEGACY') {
    const repo = input.pricing!;
    gw.listPriceObservations = async (tripId) => {
      const fresh = await repo.listForTrip(userId, tripId);
      if (pricing !== 'DUAL_READ') return fresh;
      const old = await legacy.listPriceObservations(tripId);
      return [...fresh, ...old].sort((x, y) => x.observed_at.localeCompare(y.observed_at));
    };
    // 쓰기는 언제나 새 저장소다 — DUAL_READ는 읽기만 두 곳을 본다(이관 기간 한정, §32)
    gw.savePriceObservation = (tripId, obs) => repo.append(userId, tripId, obs);
  }

  return gw;
}
