// 공유 링크 도메인 — 순수(§9). 압축기는 주입받는다(LZString 어댑터는 services).
// 레거시 shareBtn / decodeSharedTrip / 해시 분기와 같은 판정을 유지한다(§28).
//
// ⚠️ 상한이 둘인 것은 의도다. **만들 때는 8000자에서 거절**하고(주소창·메신저가 자르는 길이),
// **읽을 때는 12000자까지 받는다**(TC_LIMITS.shareChars) — 예전에 만들어진 링크나 다른 경로로
// 온 링크를 우리가 좁혀서 못 열게 되면, 받는 쪽에는 되살릴 방법이 없다.
import legacyLib from '@legacy/lib.js';

import type { Trip } from '@/features/trip/domain/types';

const { parseTripPayload, TC_LIMITS } = legacyLib;

/** 링크를 **만들 때**의 상한 (레거시 shareBtn: url.length>8000이면 파일로 안내) */
export const SHARE_URL_MAX = 8000;

export type ShareParse = { ok: true; trip: Trip } | { ok: false; error: string };

/** 공유 해시의 두 갈래 — #v=는 읽기전용 보기, #t=는 구버전(즉시 저장) 호환 */
export type ShareHash =
  | { kind: 'view'; encoded: string }
  | { kind: 'legacy'; encoded: string }
  | { kind: 'none' };

/** location.hash → 어떤 공유 링크인지 */
export function readShareHash(hash: string): ShareHash {
  if (hash.startsWith('#v=')) return { kind: 'view', encoded: hash.slice(3) };
  if (hash.startsWith('#t=')) return { kind: 'legacy', encoded: hash.slice(3) };
  return { kind: 'none' };
}

/**
 * 여행 → 읽기전용 공유 URL. 너무 길면 만들지 않고 파일 내보내기를 권한다
 * (잘린 링크는 받는 쪽에서 '깨진 링크'로만 보여 원인을 알 수 없다).
 */
export function buildShareUrl(
  trip: Trip, base: { origin: string; pathname: string }, compress: (s: string) => string
): { ok: true; url: string } | { ok: false; error: string } {
  let data: string;
  try { data = compress(JSON.stringify(trip)); }
  catch { return { ok: false, error: '공유 링크를 만들 수 없습니다' }; }
  const url = `${base.origin}${base.pathname}#v=${data}`;
  if (url.length > SHARE_URL_MAX) {
    return { ok: false, error: '여행이 너무 커서 링크로 공유할 수 없습니다. "내보내기"로 파일을 전달하세요' };
  }
  return { ok: true, url };
}

/**
 * 공유 링크 → 여행. 압축 해제 전후로 크기를 두 번 본다 —
 * 압축된 문자열은 짧아도 풀면 거대할 수 있어(zip bomb), 푼 뒤 크기도 확인해야 한다.
 */
export function decodeSharedTrip(encoded: string, decompress: (s: string) => string | null): ShareParse {
  if (typeof encoded !== 'string' || encoded.length > TC_LIMITS.shareChars) {
    return { ok: false, error: '공유 링크가 허용 길이를 초과했습니다' };
  }
  let text: string | null;
  try { text = decompress(encoded); }
  catch { return { ok: false, error: '공유 링크를 해석할 수 없습니다' }; }
  // 풀리지 않은 것과 너무 큰 것은 다른 문제다 — 뭉뚱그리면 '크기 초과'라는 엉뚱한 이유를 보게 된다
  // (LZString은 못 푸는 입력에 예외 대신 null을 준다)
  if (typeof text !== 'string') return { ok: false, error: '공유 링크를 해석할 수 없습니다' };
  if (text.length > TC_LIMITS.jsonBytes) {
    return { ok: false, error: '공유 데이터가 허용 크기를 초과했습니다' };
  }
  const r = parseTripPayload(text) as { ok: true; value: Trip } | { ok: false; error: string };
  return r.ok ? { ok: true, trip: r.value } : r;
}

/** 공유받은 여행을 내 것으로 — 새 id를 달고 이름이 비면 채운다 (레거시 roSave) */
export function claimSharedTrip(trip: Trip, newId: string): Trip {
  return { ...structuredClone(trip), id: newId, name: trip.name || '공유된 여행' };
}
