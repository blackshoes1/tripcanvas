// `/api/v1`의 라우트를 한 벌로 조립한다.
//
// 요청 처리는 **기능별 모듈**(`routes/`)에 있고, 그 모듈들이 함께 쓰는 장비 —
// 인증 · 여행 조회 · revision CAS · 오류 응답 · 시계 · 구간 캐시 · 환율 — 는 `handlerKit.ts`
// 하나에 있다. 라우트는 규칙을 **다시 만들지 않고 받아 쓴다.**
//
// ⚠️ 이 파일의 공개 표면(`createHandlers`와 타입들)은 그대로다 — `route-deps.ts`와
// `composeGateway.ts`, 테스트가 여기서 가져간다.

import { createKit } from './handlerKit';
import { createDevicesHandlers } from './routes/devices';
import { createIntakeHandlers } from './routes/intake';
import { createPlanEditingHandlers } from './routes/planEditing';
import { createPricesHandlers } from './routes/prices';
import { createTripViewsHandlers } from './routes/tripViews';

import type { HandlerDeps } from './handlerKit';

export { LEG_WAIT_MS, bearerToken, readLocation, resolveClock } from './handlerKit';
export type { Gateway, HandlerDeps, LegSupport, TripRow } from './handlerKit';

/**
 * 라우트 한 벌. 돌려주는 모양은 예전과 같다 — 이름 하나하나가 `/api/v1`의 경로에 붙는다.
 *
 * 기능별로 나눈 이유는 파일을 줄이려는 것이 아니라 **무엇이 무엇에 기대는지 보이게** 하려는 것이다:
 * 라우트는 `kit`에만 기대고, `kit`은 `deps`(게이트웨이·구간 캐시·환율)에만 기댄다.
 */
export function createHandlers(deps: HandlerDeps) {
  const kit = createKit(deps);
  return {
    ...createTripViewsHandlers(kit),
    ...createPlanEditingHandlers(kit),
    ...createIntakeHandlers(kit),
    ...createDevicesHandlers(kit),
    ...createPricesHandlers(kit)
  };
}
