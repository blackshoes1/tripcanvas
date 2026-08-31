// 여행 문서에 실제 변경을 적용하는 순수 함수들. 네트워크·Supabase를 모른다(라우트가 CAS로 저장한다).
//
// 원칙 둘:
// 1. 같은 요청을 두 번 받아도 결과가 같아야 한다(§27 idempotency) — 이미 그 상태면 alreadyApplied로 알린다.
// 2. 무엇을 '수락'한 것인지는 **서버가 다시 계산해서** 정한다. 클라이언트가 보낸 인덱스를 그대로 믿지 않는다.
import type { ActivityStatus } from './contract';
import type { TripDoc } from './todayView';

export type SettableStatus = 'COMPLETED' | 'SKIPPED' | 'PLANNED';

export interface ActivityRef { dayIndex: number; spotIndex: number }

/** 'd{dayIndex}s{spotIndex}' — 이 문서 안에서의 위치. 문서 밖으로 나가면 의미가 없다. */
export function parseActivityId(id: string): ActivityRef | null {
  const m = /^d(\d+)s(\d+)$/.exec(String(id ?? ''));
  return m ? { dayIndex: Number(m[1]), spotIndex: Number(m[2]) } : null;
}
export function activityId(dayIndex: number, spotIndex: number): string {
  return `d${dayIndex}s${spotIndex}`;
}

function clone(trip: TripDoc): TripDoc {
  return JSON.parse(JSON.stringify(trip ?? {})) as TripDoc;
}
function spotAt(trip: TripDoc, ref: ActivityRef) {
  return trip.days?.[ref.dayIndex]?.spots?.[ref.spotIndex] ?? null;
}

export interface ApplyResult {
  ok: boolean;
  trip: TripDoc;
  applied: boolean;
  alreadyApplied: boolean;
  error?: 'ACTIVITY_NOT_FOUND' | 'NAME_MISMATCH' | 'SUGGESTION_STALE';
  name?: string;
}

/**
 * 방문 완료·건너뛰기. PLANNED는 되돌리기다(기본값이므로 필드를 지운다).
 * expectedName을 주면 위치가 밀렸을 때(다른 기기가 순서를 바꿈) 엉뚱한 장소를 완료 처리하지 않는다.
 */
export function applyActivityStatus(
  trip: TripDoc, id: string, status: SettableStatus, expectedName?: string
): ApplyResult {
  const ref = parseActivityId(id);
  const current = ref ? spotAt(trip, ref) : null;
  if (!ref || !current) return { ok: false, trip, applied: false, alreadyApplied: false, error: 'ACTIVITY_NOT_FOUND' };
  if (expectedName != null && String(current.name ?? '') !== expectedName) {
    return { ok: false, trip, applied: false, alreadyApplied: false, error: 'NAME_MISMATCH', name: String(current.name ?? '') };
  }
  const now: ActivityStatus = (current.status as ActivityStatus) ?? 'PLANNED';
  if (now === status || (status === 'PLANNED' && current.status == null)) {
    return { ok: true, trip, applied: false, alreadyApplied: true, name: String(current.name ?? '') };
  }
  const next = clone(trip);
  const target = spotAt(next, ref)!;
  if (status === 'PLANNED') delete target.status;
  else target.status = status;
  return { ok: true, trip: next, applied: true, alreadyApplied: false, name: String(current.name ?? '') };
}

/** adaptive 제안의 원형(서버가 방금 다시 계산한 것)에서 필요한 부분만. */
export interface RawSuggestion {
  id: string;
  type: string;
  title: string;
  action: { kind?: string; si?: number | null; fromDay?: number | null; drop?: string[] };
}

/**
 * 다른 날의 유동 장소를 오늘로 옮긴다. 삽입 위치는 그 빈 시간의 직전 일정 뒤 —
 * 그냥 뒤에 붙이면 고정 예약보다 나중이 되어 순서가 뒤집힌다.
 */
export function applyMoveToToday(
  trip: TripDoc, dayIndex: number, fromDay: number, spotIndex: number, afterActivityId: string | null
): ApplyResult {
  const src = trip.days?.[fromDay]?.spots ?? null;
  const moving = src?.[spotIndex] ?? null;
  if (!moving || fromDay === dayIndex) return { ok: false, trip, applied: false, alreadyApplied: false, error: 'SUGGESTION_STALE' };
  const next = clone(trip);
  const [spot] = next.days![fromDay].spots!.splice(spotIndex, 1);
  const target = next.days![dayIndex].spots ?? (next.days![dayIndex].spots = []);
  let at = target.length;
  const after = afterActivityId ? parseActivityId(afterActivityId) : null;
  if (after && after.dayIndex === dayIndex) at = Math.min(target.length, after.spotIndex + 1);
  target.splice(at, 0, spot);
  return { ok: true, trip: next, applied: true, alreadyApplied: false, name: String(spot.name ?? '') };
}

/**
 * 재구성 적용. 뺀 일정은 버리지 않는다 — 다음 날 앞쪽으로 옮기고, 마지막 날이면 '건너뜀'으로만 표시한다.
 * 고정 예약과 mustVisit은 애초에 drop 목록에 들어오지 않는다(adaptive.generateReplan의 보장).
 */
export function applyReplan(trip: TripDoc, dayIndex: number, dropIds: string[]): ApplyResult {
  const indexes = dropIds
    .map((id) => parseActivityId(id))
    .filter((r): r is ActivityRef => !!r && r.dayIndex === dayIndex)
    .map((r) => r.spotIndex)
    .sort((a, b) => b - a);
  if (!indexes.length) return { ok: true, trip, applied: false, alreadyApplied: true };
  const next = clone(trip);
  const day = next.days?.[dayIndex];
  if (!day?.spots) return { ok: false, trip, applied: false, alreadyApplied: false, error: 'ACTIVITY_NOT_FOUND' };
  const nextDay = next.days?.[dayIndex + 1];
  if (nextDay) {
    const moved: NonNullable<typeof day.spots> = [];
    indexes.forEach((si) => { const s = day.spots![si]; if (s) { day.spots!.splice(si, 1); moved.unshift(s); } });
    nextDay.spots = moved.concat(nextDay.spots ?? []);
  } else {
    indexes.forEach((si) => { if (day.spots![si]) day.spots![si].status = 'SKIPPED'; });
  }
  return { ok: true, trip: next, applied: true, alreadyApplied: false };
}

/**
 * 제안 수락 — 서버가 방금 다시 계산한 제안만 받는다.
 * REST/RETURN_TO_HOTEL은 일정을 바꾸지 않는다(사용자의 '그렇게 할게' 응답 기록일 뿐).
 */
export function applySuggestion(
  trip: TripDoc, dayIndex: number, sug: RawSuggestion, afterActivityId: string | null
): ApplyResult {
  const kind = sug.action?.kind ?? '';
  if (sug.type === 'REPLAN') return applyReplan(trip, dayIndex, sug.action?.drop ?? []);
  if (kind === 'REST' || kind === 'RETURN_TO_HOTEL') {
    return { ok: true, trip, applied: false, alreadyApplied: false, name: sug.title };
  }
  const fromDay = sug.action?.fromDay;
  const si = sug.action?.si;
  if (fromDay != null && si != null) return applyMoveToToday(trip, dayIndex, fromDay, si, afterActivityId);
  // 이미 오늘 일정에 있는 곳·식사처럼 장소를 직접 골라야 하는 제안은 서버가 바꿀 것이 없다.
  return { ok: false, trip, applied: false, alreadyApplied: false, error: 'SUGGESTION_STALE' };
}
