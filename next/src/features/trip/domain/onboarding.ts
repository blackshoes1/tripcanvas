// 첫 방문 판정 (순수) — 레거시 app.js 상단의 firstVisit 계산과 같은 규칙.
import { SAMPLE_TRIP_ID } from '@/features/cloud/domain/syncDecisions';

/**
 * 온보딩을 보여줄 때인가.
 *
 * 샘플만 있는 것도 '아직 시작 안 함'으로 본다 — 레거시가 첫 방문에 심어 주는 데모라
 * 그걸 가진 것만으로 여행을 만들었다고 볼 수 없다. 반대로 **한 번 닫았으면 다시 안 띄운다**:
 * 여행을 다 지운 사람에게 소개 화면이 되돌아오면 지운 게 아니라 초기화된 것처럼 보인다.
 *
 * @param dismissed 이미 닫은 적이 있는지 (tripcanvas_onboarded_v1)
 * @param trips 저장소의 여행 목록 (없으면 null)
 */
export function isFirstVisit(dismissed: boolean, trips: readonly { id: string }[] | null): boolean {
  if (dismissed) return false;
  if (!trips || !trips.length) return true;
  return trips.every(t => t && t.id === SAMPLE_TRIP_ID);
}
