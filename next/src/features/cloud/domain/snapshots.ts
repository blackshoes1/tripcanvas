// 버전 히스토리 판정 — 순수(§9). 레거시 cloudSnapshot/loadSnapList와 같은 규칙.
//
// 스냅샷은 '되돌릴 지점'이지 변경 로그가 아니다. 편집할 때마다 쌓으면 목록이 1분 단위로
// 채워져 정작 어제 상태를 못 찾는다 → 여행별 10분에 한 번, 최근 15개만 남긴다.

/** 같은 여행의 스냅샷 간 최소 간격 (레거시와 동일) */
export const SNAPSHOT_INTERVAL_MS = 10 * 60 * 1000;
/** 남겨 두는 개수 */
export const SNAPSHOT_KEEP = 15;

export interface SnapshotRow {
  id: number;
  created_at: string;
}

/** 지금 스냅샷을 남길 때인가 — 마지막으로 남긴 시각 기준 */
export function shouldSnapshot(lastAt: number | undefined, now: number): boolean {
  return lastAt == null || now - lastAt >= SNAPSHOT_INTERVAL_MS;
}

/**
 * 지울 스냅샷 — 최신 SNAPSHOT_KEEP개를 뺀 나머지.
 * 목록이 최신순이라는 보장이 없으므로 여기서 정렬해서 고른다(서버 정렬에 기대지 않는다).
 */
export function staleSnapshotIds(rows: SnapshotRow[], keep = SNAPSHOT_KEEP): number[] {
  return [...(rows ?? [])]
    .filter(r => r && r.id != null)
    .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
    .slice(keep)
    .map(r => r.id);
}

/** 목록에 보여줄 시각 — "10/1 14:05" */
export function snapshotLabel(createdAt: string): string {
  const d = new Date(createdAt);
  if (isNaN(d.getTime())) return '';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getMonth() + 1}/${d.getDate()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
