import type { PlaceAdmissionDetails } from '@/features/trip/domain/admission';

/**
 * 기존 Google/Kakao 검색에는 입장권·날짜별 예약 요건이 없다. 별도 제공처 자격증명과
 * 장소 ID→상품 매칭이 확보되기 전에는 일반 가격대·reservable을 입장료/필수 예약으로 옮기지 않는다.
 * 실제 조회를 하지 않았으므로 출처·확인 시각도 만들어 내지 않는다.
 */
export function placeAdmissionDetails(provider: 'kakao' | 'google', providerId: string): PlaceAdmissionDetails {
  return {
    provider, providerId, status: 'NOT_CONNECTED', requirement: 'UNKNOWN', quote: null,
    sourceURL: null, checkedAt: null, stale: false
  };
}
