// 자연어 요청이 **서버에서** 해석되어 추천 옵션이 되고, 무엇으로 이해했는지 되돌아오는지.
//
// ⚠️ 해석 규칙은 `adaptive.js`의 `parseIntent`/`resolveIntent` 하나다(§엔진은 하나다).
//    여기서 보는 것은 그 결과가 **계약 모양으로 실려 나가는지**이지 규칙 자체가 아니다
//    (규칙은 `test/adaptive.test.js`가 본다).
import { describe, expect, it } from 'vitest';

import { computeToday, type TripDoc } from './todayView';

const trip: TripDoc = {
  id: 'intent', name: '의도', start: '2026-09-01', timeZone: 'Asia/Seoul',
  days: [{
    title: '첫날', mode: 'walk', startAt: '09:00',
    spots: [
      { name: '숙소', city: '서울', stay: true, stayMin: 0, lat: 37.55, lng: 126.98 },
      { name: '박물관', city: '서울', stayMin: 90, lat: 37.56, lng: 126.99 }
    ]
  }]
};

const at = (intent?: string | null, energyLevel?: 'LOW' | 'NORMAL' | 'HIGH') =>
  computeToday({
    tripId: 'intent', trip, revision: 1, updatedAt: '2026-08-31T00:00:00Z',
    todayISO: '2026-09-01', nowMinutes: 11 * 60, generatedAt: '2026-09-01T02:00:00Z',
    intent, energyLevel
  }).response;

describe('Today — 자연어 요청', () => {
  it('문장을 보내지 않으면 에코가 없다 — 하지 않은 말을 지어내지 않는다', () => {
    expect(at().intent).toBeNull();
    expect(at('').intent).toBeNull();
    expect(at('   ').intent).toBeNull();
  });

  it('무엇으로 이해했는지 값으로 돌려준다 — 규칙 이름·점수는 싣지 않는다', () => {
    const echo = at('오늘 좀 피곤해서 많이 걷기 싫어').intent!;
    expect(echo.text).toBe('오늘 좀 피곤해서 많이 걷기 싫어');
    expect(echo.understood).toBe(true);
    expect(echo.energyLevel).toBe('LOW');
    expect(echo.walkAverse).toBe(true);
    expect(echo.maxTravelMinutes).toBe(20);
    expect(echo.reasons.length).toBeGreaterThan(0);
    // 화면에 쓰는 것은 문장뿐이다 — 내부 점수가 새면 앱이 그걸 그리기 시작한다
    expect(JSON.stringify(echo)).not.toMatch(/score|weight/i);
  });

  /// 컨디션은 추천 점수를 바꾼다 — 에코만 바뀌고 계산은 그대로면 말을 들은 척만 한 것이다.
  it('해석 결과가 실제로 추천에 쓰인다', () => {
    expect(at('오늘 너무 피곤해').currentState.energyLevel).toBe('LOW');
    expect(at('오늘 쌩쌩해').currentState.energyLevel).toBe('HIGH');
  });

  it('컨디션은 문장이 말했을 때만 덮어쓴다', () => {
    // 문장에 컨디션이 없으면 버튼으로 고른 값이 남는다
    const near = at('가까운 데만', 'HIGH').intent!;
    expect(near.energyLevel).toBe('HIGH');
    expect(near.maxTravelMinutes).toBe(15);
    // 말했으면 그쪽이 이긴다
    expect(at('너무 피곤해', 'HIGH').intent!.energyLevel).toBe('LOW');
  });

  it('못 알아들으면 알아들은 척하지 않는다', () => {
    const echo = at('asdfgh 뭐라고 쓴 건지', 'LOW').intent!;
    expect(echo.understood).toBe(false);
    expect(echo.reasons).toEqual([]);
    expect(echo.energyLevel, '못 알아들었다고 고른 컨디션을 버리지 않는다').toBe('LOW');
    // 문장은 그대로 돌려준다 — 화면이 "이 문장을 못 알아들었다"고 말할 수 있어야 한다
    expect(echo.text).toBe('asdfgh 뭐라고 쓴 건지');
  });

  it('좁히지 않은 이동 상한은 null이다 — 0과 섞지 않는다', () => {
    const echo = at('배고파').intent!;
    expect(echo.mealFocus).toBe(true);
    expect(echo.maxTravelMinutes).toBeNull();
    expect(echo.walkAverse).toBe(false);
    expect(echo.wantRest).toBe(false);
  });

  /// 잠금화면·위젯 압축본은 사람이 쓴 문장을 들고 다니면 안 된다(§잠긴 화면에 계속 떠 있는 정보다).
  it('문장이 잠금화면 압축본으로 새지 않는다', () => {
    const said = '오늘 좀 피곤해서 많이 걷기 싫어';
    const res = at(said);
    expect(JSON.stringify(res.activityState)).not.toContain('피곤');
  });
});
