// 지도 장면(Scene) 뷰 모델 — buildMapScene이 만드는 직렬화 가능한 그리기 명세.
// '무엇을 그릴지'(엔진·핀·선·점선·칩)는 전부 domain에서 끝내고, SDK 어댑터는 그리기만 한다.

export type MapEngine = 'kakao' | 'google';

export interface ScenePin {
  lat: number;
  lng: number;
  di: number;
  si: number;
  /** 동선 순서 (si+1) */
  label: number;
  /** 핀 색 — colorBy 'day'(기본)=일자 색 / 'city'=도시 색 */
  color: string;
  /** 선택 코스 — 작고 반투명한 핀 */
  opt: boolean;
  /** 카테고리 배지 아이콘 (번호를 대체하지 않고 모서리에) */
  catIcon: string | null;
  /** 마우스오버 툴팁 */
  title: string;
}

export interface SceneLine {
  pts: { lat: number; lng: number }[];
  color: string;
  opacity: number;
  /** 점선 — 숙소 복귀·일자 간 연결(자동 합성 구간) */
  dashed: boolean;
}

/** 그날 목록엔 없지만 동선이 닿는 숙소(연박 등) — 클릭 대상이 아닌 옅은 🏠 표식 */
export interface SceneGhost {
  lat: number;
  lng: number;
  color: string;
  title: string;
}

/** 경로 중간 소요시간 칩 (일자 필터 보기 전용) */
export interface SceneChip {
  lat: number;
  lng: number;
  text: string;
}

export interface MapScene {
  engine: MapEngine;
  pins: ScenePin[];
  lines: SceneLine[];
  ghosts: SceneGhost[];
  chips: SceneChip[];
}

/** 카메라 프레이밍 명세 — pts에 맞추고 pad(px)·maxZoom(구글 기준, 카카오는 레벨 환산) 적용 */
export interface FitTarget {
  pts: [number, number][];
  pad: number;
  maxZoom?: number;
}
