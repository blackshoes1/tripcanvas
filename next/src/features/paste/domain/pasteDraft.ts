// 붙여넣기 초안 도메인 — 순수(§9). 파싱 규칙(parseDirect·normalizeDraftDays)과 검증
// (validateTripPayload)은 lib.js의 단일 소스를 그대로 쓴다 — 두 앱이 같은 글을 같게 읽어야 한다.
import legacyLib from '@legacy/lib.js';

import type { Day, Spot, Trip } from '@/features/trip/domain/types';

const { parseDirect, normalizeDraftDays, validateTripPayload } = legacyLib;

/** 초안을 어디에 넣을지 */
export type DraftTarget = 'new' | 'append' | 'overwrite';

export interface Draft {
  name: string;
  start: string;
  days: Day[];
}

export type DraftResult = { ok: true; draft: Draft } | { ok: false; error: string };

/** 초안 하나를 검증까지 마쳐서 돌려준다 — 일자가 하나도 없으면 초안이 아니다 */
function checkDraft(raw: { name?: string; start?: string; days?: unknown }): DraftResult {
  const days = normalizeDraftDays(raw.days) as Day[];
  if (!days.length) return { ok: false, error: '일정을 못 읽었어요 — 형식을 확인해주세요' };
  const checked = validateTripPayload({
    name: raw.name || '붙여넣은 여행', start: raw.start || '', days
  }) as { ok: true; value: Trip } | { ok: false; error: string };
  if (!checked.ok) return checked;
  return { ok: true, draft: { name: checked.value.name, start: checked.value.start, days: checked.value.days } };
}

/** 직접 형식 텍스트 → 초안 */
export function draftFromText(text: string): DraftResult {
  if (!text.trim()) return { ok: false, error: '내용을 붙여넣어주세요' };
  try {
    return checkDraft(parseDirect(text) as { name: string; start: string; days: unknown });
  } catch {
    return { ok: false, error: '일정을 해석하지 못했습니다 — 입력 형식을 확인해주세요' };
  }
}

/** AI가 돌려준 객체 → 초안 (모양은 자유롭게 와도 된다 — normalizeDraftDays가 눕힌다) */
export function draftFromAi(value: unknown): DraftResult {
  const v = (value ?? {}) as { name?: string; start?: string; days?: unknown };
  if (!v || typeof v !== 'object') return { ok: false, error: '일정을 못 읽었어요 — 형식을 확인해주세요' };
  return checkDraft(v);
}

/** 좌표가 없는 장소들 — 지오코딩 대상 */
export function spotsNeedingCoords(days: Day[]): Spot[] {
  const out: Spot[] = [];
  for (const d of days) for (const s of d.spots) {
    if (s.lat == null || s.lng == null || isNaN(s.lat) || isNaN(s.lng)) out.push(s);
  }
  return out;
}

/** 좌표를 못 찾은 장소 수 — 버리지 않고 '위치 미지정'으로 남긴다 */
export function noLocCount(days: Day[]): number {
  return spotsNeedingCoords(days).length;
}

/**
 * 초안을 여행에 넣는다. **합친 결과를 한 번 더 검증한다** — 덧붙이기가 전체 한도를
 * 넘기면 반쪽만 들어가는 대신 통째로 거절해야 한다.
 */
export function applyDraft(
  current: Trip | null, draft: Draft, target: DraftTarget,
  ids: { newId: string; today: string }
): { ok: true; trip: Trip } | { ok: false; error: string } {
  let next: Trip;
  if (target === 'append' && current) {
    next = { ...current, days: [...current.days, ...draft.days], start: current.start || draft.start || '' };
  } else if (target === 'overwrite' && current) {
    next = { ...current, days: draft.days, name: draft.name || current.name, start: draft.start || current.start };
  } else {
    next = {
      id: ids.newId, name: draft.name || '붙여넣은 여행',
      start: draft.start || ids.today, days: draft.days
    };
  }
  const r = validateTripPayload(next) as { ok: true; value: Trip } | { ok: false; error: string };
  return r.ok ? { ok: true, trip: r.value } : r;
}
