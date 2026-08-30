// 가져오기·내보내기 도메인 — 순수(§9). 파일 읽기·다운로드는 services가 맡는다.
// 레거시 exportBtn / importFile.onchange와 같은 판정을 유지한다(§28).
import legacyLib from '@legacy/lib.js';

import type { Trip } from '@/features/trip/domain/types';

const { parseTripPayload, TC_LIMITS } = legacyLib;

/** 파일 하나의 상한 — 이보다 크면 읽기도 전에 거절한다 (레거시와 동일) */
export const IMPORT_MAX_BYTES: number = TC_LIMITS.jsonBytes;

/** 내보내기 파일 이름 — 공백은 밑줄로 (레거시와 같은 규칙) */
export function exportFilename(name: string, ext = 'json'): string {
  const base = (name || '여행').replace(/\s+/g, '_');
  return `${base}.${ext}`;
}

/** 내보내기 본문 — 사람이 열어볼 수 있게 들여쓴다 */
export function exportJson(trip: Trip): string {
  return JSON.stringify(trip, null, 2);
}

/**
 * 가져온 텍스트 → 내 여행. **새 id를 단다** — 같은 파일을 두 번 가져오거나 남의 여행을
 * 받았을 때 기존 여행을 덮어쓰지 않도록(id가 같으면 저장소에서 한쪽이 사라진다).
 */
export function importTrip(text: string, newId: string): { ok: true; trip: Trip } | { ok: false; error: string } {
  const r = parseTripPayload(text) as { ok: true; value: Trip } | { ok: false; error: string };
  if (!r.ok) return r;
  return { ok: true, trip: { ...r.value, id: newId } };
}
