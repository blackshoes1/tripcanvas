// 지도 탭 게이팅과 '가장 가까운 상호' 판정 — 레거시가 실제로 겪은 오작동을 시나리오로 고정한다.
import { describe, expect, it, vi } from 'vitest';

import {
  createTapGate, nearestPlaceName, shouldShowPoi, NEAR_POI_RADIUS_M, TAP_ADD_DELAY_MS
} from './mapPick';

/** 수동으로 흘려보내는 가짜 타이머 */
function fakeTimers() {
  const jobs = new Map<number, { fn: () => void; at: number }>();
  let now = 0, seq = 0;
  return {
    setTimer: (fn: () => void, ms: number) => { const id = ++seq; jobs.set(id, { fn, at: now + ms }); return id; },
    clearTimer: (id: number) => { jobs.delete(id); },
    advance(ms: number) {
      now += ms;
      for (const [id, j] of [...jobs]) if (j.at <= now) { jobs.delete(id); j.fn(); }
    },
    get count() { return jobs.size; }
  };
}

describe('탭 게이트 — 더블탭 확대·패닝을 장소 추가로 오인하지 않는다', () => {
  const setup = () => {
    const onAdd = vi.fn();
    const t = fakeTimers();
    const gate = createTapGate({ onAdd, setTimer: t.setTimer, clearTimer: t.clearTimer });
    return { onAdd, t, gate };
  };

  it('탭은 바로 추가하지 않고 기다렸다가 확정한다', () => {
    const { onAdd, t, gate } = setup();
    gate.tap({ lat: 1, lng: 2 });
    expect(onAdd).not.toHaveBeenCalled();
    expect(gate.isPending).toBe(true);

    t.advance(TAP_ADD_DELAY_MS);
    expect(onAdd).toHaveBeenCalledWith({ lat: 1, lng: 2 });
    expect(gate.isPending).toBe(false);
  });

  it('대기 중 취소되면 추가하지 않는다 (더블탭 확대·드래그)', () => {
    const { onAdd, t, gate } = setup();
    gate.tap({ lat: 1, lng: 2 });
    gate.cancel();
    t.advance(1000);
    expect(onAdd).not.toHaveBeenCalled();
    expect(t.count).toBe(0);   // 타이머를 남겨두지 않는다
  });

  it('연타해도 하나만 들어간다 — 이전 대기는 버린다', () => {
    const { onAdd, t, gate } = setup();
    gate.tap({ lat: 1, lng: 2 });
    gate.tap({ lat: 3, lng: 4 });
    gate.tap({ lat: 5, lng: 6 });
    t.advance(1000);
    expect(onAdd).toHaveBeenCalledTimes(1);
    expect(onAdd).toHaveBeenCalledWith({ lat: 5, lng: 6 });   // 마지막 탭이 이긴다
  });

  it('POI 칩처럼 확실한 경로는 기다리지 않고 바로 추가한다', () => {
    const { onAdd, t, gate } = setup();
    gate.now({ lat: 1, lng: 2, placeId: 'ChIJ_x' });
    expect(onAdd).toHaveBeenCalledWith({ lat: 1, lng: 2, placeId: 'ChIJ_x' });
    expect(t.count).toBe(0);
  });

  it('확실한 경로는 대기 중이던 탭을 밀어낸다 (지도 탭과 겹쳐 두 개가 들어가지 않게)', () => {
    const { onAdd, t, gate } = setup();
    gate.tap({ lat: 1, lng: 2 });
    gate.now({ lat: 9, lng: 9, placeId: 'p' });
    t.advance(1000);
    expect(onAdd).toHaveBeenCalledTimes(1);
    expect(onAdd).toHaveBeenCalledWith({ lat: 9, lng: 9, placeId: 'p' });
  });

  it('placeId는 그대로 실려 간다 — 탭한 그 장소를 특정하는 유일한 근거', () => {
    const { onAdd, t, gate } = setup();
    gate.tap({ lat: 41.4, lng: 2.17, placeId: 'ChIJ_guell' });
    t.advance(TAP_ADD_DELAY_MS);
    expect(onAdd.mock.calls[0][0].placeId).toBe('ChIJ_guell');
  });
});

describe('nearestPlaceName — 엉뚱한 상호보다 빈 칸이 낫다', () => {
  it('가장 가까운 후보를 고른다', () => {
    expect(nearestPlaceName([
      { name: '먼 카페', distance: 35 },
      { name: '가까운 식당', distance: 8 },
      { name: '중간 상점', distance: 20 }
    ])).toBe('가까운 식당');
  });

  it('거리 문자열도 숫자로 본다 (SDK가 문자열로 준다)', () => {
    expect(nearestPlaceName([{ name: 'A', distance: '30' }, { name: 'B', distance: '5' }])).toBe('B');
  });

  it('거리를 모르는 후보는 반경 끝으로 쳐서, 아는 후보에게 자리를 내준다', () => {
    expect(nearestPlaceName([{ name: '모름' }, { name: '아는 곳', distance: 39 }])).toBe('아는 곳');
    // 거리를 아는 후보가 없으면 모르는 후보라도 쓴다
    expect(nearestPlaceName([{ name: '모름' }])).toBe('모름');
    expect(nearestPlaceName([{ name: 'A', distance: 'NaN' }])).toBe('A');
  });

  it('후보가 없거나 이름이 없으면 null — 이름을 지어내지 않는다', () => {
    expect(nearestPlaceName([])).toBe(null);
    expect(nearestPlaceName([{ name: '' }])).toBe(null);
    expect(nearestPlaceName([{ name: '', distance: 1 }, { name: '', distance: 2 }])).toBe(null);
  });

  it('반경 기본값은 레거시와 같다 (40m)', () => {
    expect(NEAR_POI_RADIUS_M).toBe(40);
    // 반경을 좁히면 '거리 모름' 후보의 가중치도 함께 좁아진다
    expect(nearestPlaceName([{ name: '모름' }, { name: '20m', distance: 20 }], 10)).toBe('모름');
  });
});

describe('shouldShowPoi — 넓게 볼 때는 라벨을 깔지 않는다', () => {
  it('카카오 level은 작을수록 확대 — 기준 이하일 때만 표시', () => {
    expect(shouldShowPoi(1)).toBe(true);
    expect(shouldShowPoi(4)).toBe(true);
    expect(shouldShowPoi(5)).toBe(false);
    expect(shouldShowPoi(12)).toBe(false);
  });

  it('level을 모르면 깔지 않는다', () => {
    expect(shouldShowPoi(NaN)).toBe(false);
  });
});
