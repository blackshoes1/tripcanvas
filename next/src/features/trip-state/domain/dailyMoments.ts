import { createHash } from 'node:crypto';

type ObjectValue = Record<string, unknown>;
const object = (value: unknown): ObjectValue => value && typeof value === 'object' && !Array.isArray(value) ? value as ObjectValue : {};
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

export interface DailyMomentOption { key: string; name: string; activityId: string; selectable: boolean; disabledReason?: string }
export interface DailyMomentRow {
  userId: string; label: string; mine: boolean; spotKey: string; spotName: string;
  activityId: string | null; status: 'ACTIVE' | 'UNAVAILABLE';
}
export interface DailyMomentsResponse {
  dayIndex: number; dayKey: string; revision: number; options: DailyMomentOption[]; moments: DailyMomentRow[];
}
export interface SavedDailyMoment { userId: string; label: string; spotKey: string; spotName: string }

/** A wish names a place, never a positional d0s0 slot. Time edits and reorder keep identity;
 * name/location edits require the person to choose again. Identical places are ambiguous and not selectable. */
export function dailyMomentOptions(data: unknown, dayIndex: number): { dayKey: string; options: DailyMomentOption[] } | null {
  const trip = object(data), days = trip.days;
  if (!Array.isArray(days) || !Number.isInteger(dayIndex) || dayIndex < 0 || dayIndex >= days.length) return null;
  const day = object(days[dayIndex]);
  let dayKey = `undated:${dayIndex}:${hash(String(day.title ?? '')).slice(0, 16)}`;
  if (typeof trip.start === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(trip.start)) {
    const time = Date.parse(`${trip.start}T00:00:00Z`);
    if (Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === trip.start) {
      dayKey = `date:${new Date(time + dayIndex * 86400000).toISOString().slice(0, 10)}`;
    }
  }
  const options: DailyMomentOption[] = (Array.isArray(day.spots) ? day.spots : []).map((value, index) => {
    const spot = object(value), name = typeof spot.name === 'string' ? spot.name.trim() : '';
    // An explicit place ID alone cannot distinguish two planned visits to the same place.
    const identity = ['name', 'city', 'placeId', 'kakaoId', 'providerId', 'lat', 'lng', 'addr'].map(key => spot[key] ?? null);
    const pending = object(spot.choice).state === 'PENDING';
    return { key: hash(identity), name, activityId: `d${dayIndex}s${index}`, selectable: !!name && !pending,
      ...(pending ? { disabledReason: '아직 고르지 않은 일정이에요. 먼저 두 곳 중 하나를 골라 주세요.' } : {}) };
  });
  const counts = new Map<string, number>();
  for (const row of options) counts.set(row.key, (counts.get(row.key) ?? 0) + 1);
  for (const row of options) if (counts.get(row.key)! > 1) {
    row.selectable = false;
    row.disabledReason = '같은 장소가 여러 번 있어 먼저 일정에서 구분해 주세요.';
  }
  return { dayKey, options };
}

export function buildDailyMomentRows(saved: SavedDailyMoment[], options: DailyMomentOption[], viewerId: string): DailyMomentRow[] {
  return saved.map(row => {
    const matches = options.filter(option => option.key === row.spotKey && option.selectable);
    const match = matches.length === 1 ? matches[0] : undefined;
    return { ...row, mine: row.userId === viewerId, activityId: match?.activityId ?? null,
      status: match ? 'ACTIVE' : 'UNAVAILABLE' };
  });
}

export interface DailyMomentImpact {
  userId: string; label: string; spotName: string; status: 'KEPT' | 'CHANGED' | 'REMOVED' | 'UNAVAILABLE'; text: string;
}

/** This describes individual wishes. It does not infer agreement or turn them into fixed bookings. */
export function dailyMomentImpacts(moments: DailyMomentRow[], changes: { activityId?: string | null; kind: string }[]): DailyMomentImpact[] {
  return moments.map(row => {
    const ownChanges = changes.filter(change => change.activityId === row.activityId && row.activityId !== null);
    const removed = ownChanges.some(change => /REMOVE|SKIP|DROP/i.test(change.kind));
    const status = row.status === 'UNAVAILABLE' ? 'UNAVAILABLE' : removed ? 'REMOVED' : ownChanges.length ? 'CHANGED' : 'KEPT';
    const ending = { KEPT: '일정에 남아요', CHANGED: '시간이나 순서가 달라져요', REMOVED: '이번 조정에서 빠져요', UNAVAILABLE: '일정이 바뀌어 다시 확인이 필요해요' }[status];
    return { userId: row.userId, label: row.label, spotName: row.spotName, status, text: `${row.label} 님이 고른 ${row.spotName}: ${ending}` };
  });
}
