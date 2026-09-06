// 장소 검색 결과 모델 — 지도 SDK 원본을 Spot 필드로 옮긴 뒤의 모양.
// 정규화(이름·도시·카테고리·영업시간)는 lib.js 순수 함수가 단일 소스다.
import type { OpeningHour, SpotCategory } from '@/features/trip/domain/types';

export interface PlaceResult {
  name: string;
  /** 표시용 주소 — 같은 이름의 후보를 사람이 가려내는 근거 */
  addr: string;
  city: string;
  lat: number;
  lng: number;
  cat?: SpotCategory;
  hours?: OpeningHour[];
  /** 구글 Place ID — 예약 가격 추적의 호텔 identity 매칭에 쓰인다 */
  placeId?: string;
  /** 카카오 장소 ID — 국내 장소를 특정해 지도 링크를 바로 길찾기로 연다 */
  kakaoId?: string;
}

/** 실패 원인 — '무결과'와 구분해 사용자에게 다른 안내를 준다 */
export type SearchError = 'network' | 'quota' | 'auth' | 'error';

export interface SearchOutcome {
  results: PlaceResult[];
  /** results가 비었을 때만 의미 있다: null이면 진짜 무결과, 코드면 실패 */
  error: SearchError | null;
}
