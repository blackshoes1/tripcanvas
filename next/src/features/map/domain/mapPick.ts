// 지도에서 장소 담기 — 판정 규칙 (순수·DI). SDK 호출은 services가 한다 (§27).
//
// 레거시가 겪은 두 문제를 그대로 물려받아 막는다:
// 1) 폰에는 우클릭이 없어 탭이 유일한 추가 경로인데, 더블탭 확대·패닝과 구분해야 한다 → 지연 후 확정
// 2) 국내는 좌표→장소 API가 없어 이름을 '추측'해야 하고, 그 추측이 엉뚱한 상호를 넣었다
//    → 좁은 반경 안에서 가장 가까운 것만 인정하고, 없으면 비워 둔다 (빈 칸이 오답보다 낫다)

/** 더블탭 확대와 구분하려고 기다리는 시간 (레거시 TAP_ADD_DELAY) */
export const TAP_ADD_DELAY_MS = 260;

/** 탭한 자리에서 '가장 가까운' 장소로 인정할 반경(m). 이보다 멀면 이름을 추측하지 않는다 */
export const NEAR_POI_RADIUS_M = 40;

/** 지도에 깔 POI 카테고리 — 음식점·카페·관광명소·숙박·문화시설·마트·지하철역 */
export const POI_CATS = ['FD6', 'CE7', 'AT4', 'AD5', 'CT1', 'MT1', 'SW8'] as const;

/** 좌표 역추적에 훑을 카테고리 — 여행에 실제로 담기는 것만 좁게 */
export const KAKAO_NEARBY_CATS = ['FD6', 'CE7', 'AT4', 'AD5', 'CT1'] as const;

/** 카카오 level은 작을수록 확대. 동네 수준 이상으로 확대했을 때만 POI를 깐다 */
export const POI_MAX_LEVEL = 4;
/** 화면이 라벨로 뒤덮이지 않게 */
export const POI_MAX = 60;
/** bounds를 못 쓸 때 중심에서 훑을 반경(m) */
export const POI_FALLBACK_RADIUS_M = 500;

export interface TapPoint {
  lat: number;
  lng: number;
  /** 구글 POI 아이콘을 탭했을 때만 — '무엇을 눌렀는지' 아는 유일한 경로 */
  placeId?: string;
}

export interface TapGateDeps {
  onAdd: (p: TapPoint) => void;
  delayMs?: number;
  /** 테스트 주입 (기본은 window 타이머) */
  setTimer?: (fn: () => void, ms: number) => number;
  clearTimer?: (id: number) => void;
}

/**
 * 지도 탭 → 장소 추가 게이트. tap()은 바로 추가하지 않고 기다렸다가 확정한다.
 * 그 사이 cancel()이 오면(더블탭 확대·패닝) 추가하지 않는다.
 * 대기 중 새 탭이 오면 이전 대기는 버린다 — 연타로 여러 개가 들어가지 않게.
 */
export function createTapGate(deps: TapGateDeps) {
  const delay = deps.delayMs ?? TAP_ADD_DELAY_MS;
  const setTimer = deps.setTimer ?? ((fn, ms) => window.setTimeout(fn, ms));
  const clearTimer = deps.clearTimer ?? (id => window.clearTimeout(id));
  let pending: number | null = null;

  function cancel(): void {
    if (pending != null) { clearTimer(pending); pending = null; }
  }

  return {
    /** 지연 후 확정되는 탭 */
    tap(p: TapPoint): void {
      cancel();
      pending = setTimer(() => { pending = null; deps.onAdd(p); }, delay);
    },
    /** POI 칩·우클릭처럼 '무엇을 눌렀는지 확실한' 경로는 기다리지 않는다 */
    now(p: TapPoint): void {
      cancel();
      deps.onAdd(p);
    },
    cancel,
    get isPending() { return pending != null; }
  };
}

export interface NearbyCandidate {
  name: string;
  /** SDK가 준 거리(m). 없거나 숫자가 아니면 반경으로 친다 (레거시와 동일) */
  distance?: string | number;
}

/**
 * 인근 후보들 중 '가장 가까운' 상호 하나. 후보가 없으면 null.
 * 거리를 모르는 후보는 반경 끝에 있는 것으로 쳐서, 거리를 아는 후보에게 자리를 내준다.
 */
export function nearestPlaceName(
  candidates: NearbyCandidate[],
  radiusM: number = NEAR_POI_RADIUS_M
): string | null {
  let best: { name: string; dist: number } | null = null;
  for (const c of candidates) {
    if (!c || !c.name) continue;
    const d = Number(c.distance);
    const dist = isFinite(d) ? d : radiusM;
    if (!best || dist < best.dist) best = { name: c.name, dist };
  }
  return best ? best.name : null;
}

/** 그 확대 수준에서 POI를 깔아야 하는가 — 넓게 보는 중엔 라벨이 의미가 없다 */
export function shouldShowPoi(level: number, maxLevel: number = POI_MAX_LEVEL): boolean {
  return isFinite(level) && level <= maxLevel;
}
