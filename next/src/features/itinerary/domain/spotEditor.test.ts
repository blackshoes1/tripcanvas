// 장소 편집 규칙 검증 — 레거시 spotSave/moveSpot/deleteSpot과 같은 판정을 지키는지.
// 특히 편집이 '값만 고치는 일'이라는 계약: 좌표·예약 연결은 폼을 거치지 않고 원본에서 물려받는다.
import { describe, expect, it } from 'vitest';

import type { Day, Spot, Trip } from '@/features/trip/domain/types';
import { applySpotEdit, formFromSpot, moveSpot, removeSpot, spotFromForm } from './spotEditor';

const spot = (name: string, extra: Partial<Spot> = {}): Spot =>
  ({ name, city: '제주', desc: '', lat: 33.5, lng: 126.5, ...extra });
const day = (spots: Spot[], extra: Partial<Day> = {}): Day =>
  ({ title: '', drive: '', note: '', mode: 'car', spots, ...extra });
const trip = (days: Day[]): Trip => ({ id: 't1', name: 'T', start: '2026-10-01', days });

/** 폼을 열어 일부만 바꿔 저장하는 흐름 — 실제 편집기와 같은 경로를 탄다 */
const edit = (s: Spot, patch: Partial<ReturnType<typeof formFromSpot>> = {}, di = 0) => {
  const res = spotFromForm({ ...formFromSpot(s, di), ...patch }, s);
  if (!res.ok) throw new Error(`저장 실패: ${res.error}`);
  return res.spot;
};

describe('formFromSpot / spotFromForm — 값 왕복', () => {
  it('손대지 않고 저장하면 의미가 그대로다 (기본값은 키를 만들지 않는다)', () => {
    const before = spot('성산일출봉', { at: '09:30', stayMin: 90, cost: 5000 });
    const after = edit(before);
    expect(after).toMatchObject({ name: '성산일출봉', city: '제주', at: '09:30', stayMin: 90, cost: 5000 });
    // KRW·1박은 기본값이라 저장하지 않는다 (공유 링크 크기 — 레거시 하위호환)
    expect('cur' in after).toBe(false);
    expect('nights' in after).toBe(false);
    expect('legMode' in after).toBe(false);
  });

  it('이름이 비면 저장하지 않는다', () => {
    const res = spotFromForm({ ...formFromSpot(spot('A'), 0), name: '  ' }, spot('A'));
    expect(res).toEqual({ ok: false, error: 'NAME_REQUIRED' });
  });

  it('도시를 비우면 기타로 떨어진다', () => {
    expect(edit(spot('A'), { city: '' }).city).toBe('기타');
  });

  it('시각은 숫자만 쳐도 받는다 — 범위 밖이면 미지정', () => {
    expect(edit(spot('A'), { at: '930' }).at).toBe('09:30');
    expect('at' in edit(spot('A', { at: '09:30' }), { at: '' })).toBe(false);
    expect('at' in edit(spot('A'), { at: '25:00' })).toBe(false);
    expect(edit(spot('A'), { bookAt: '1830' }).bookAt).toBe('18:30');
  });

  it('비용은 쉼표를 허용하고, 비우면 키를 지운다', () => {
    expect(edit(spot('A'), { cost: '12,000' }).cost).toBe(12000);
    expect('cost' in edit(spot('A', { cost: 5000 }), { cost: '' })).toBe(false);
    expect(edit(spot('A'), { cost: '9000', cur: 'USD' }).cur).toBe('USD');
  });

  it('연박은 숙소일 때만, 2박부터 저장한다', () => {
    expect(edit(spot('A'), { stay: true, nights: '3' }).nights).toBe(3);
    expect('nights' in edit(spot('A'), { stay: true, nights: '1' })).toBe(false);
    expect('nights' in edit(spot('A'), { stay: false, nights: '3' })).toBe(false);
  });
});

describe('편집은 값만 고친다 — 폼 밖의 것은 원본에서 물려받는다', () => {
  it('예약·렌터카 연결은 살아남는다 (메모만 고쳐도 픽업이 풀리면 안 된다)', () => {
    const before = spot('팔마공항', { bookingId: 'h1', carPickupId: 'c1', carReturnId: 'c1' });
    const after = edit(before, { desc: '터미널 2' });
    expect(after.desc).toBe('터미널 2');
    expect(after).toMatchObject({ bookingId: 'h1', carPickupId: 'c1', carReturnId: 'c1' });
  });

  it('좌표·placeId·영업시간도 원본 그대로', () => {
    const hours = [{ d: 1, o: 540, c: 1080 }];
    const after = edit(spot('A', { placeId: 'ChIJ_x', hours }), { name: 'A2' });
    expect(after).toMatchObject({ lat: 33.5, lng: 126.5, placeId: 'ChIJ_x' });
    expect(after.hours).toEqual(hours);
  });

  it('위치 없는 장소는 편집해도 (0,0)으로 둔갑하지 않는다', () => {
    const after = edit({ name: '미정', city: '제주', desc: '', lat: null, lng: null }, { desc: '나중에 정함' });
    expect(after.lat).toBe(null);
    expect(after.lng).toBe(null);
  });
});

describe('applySpotEdit — 배치 규칙', () => {
  it('같은 날 편집은 제자리 교체 — 맨 뒤로 밀지 않는다', () => {
    const t = trip([day([spot('A'), spot('B'), spot('C')])]);
    const { trip: next } = applySpotEdit(t, { di: 0, si: 1 }, spot('B2'), 0);
    expect(next.days[0].spots.map(s => s.name)).toEqual(['A', 'B2', 'C']);
  });

  it('일자를 바꾸면 원래 날에서 빠지고 대상 날 맨 뒤에 붙는다', () => {
    const t = trip([day([spot('A'), spot('B')]), day([spot('X')])]);
    const { trip: next } = applySpotEdit(t, { di: 0, si: 0 }, spot('A2'), 1);
    expect(next.days[0].spots.map(s => s.name)).toEqual(['B']);
    expect(next.days[1].spots.map(s => s.name)).toEqual(['X', 'A2']);
  });

  it('고정 시각을 넣으면 그 날이 시간순으로 정렬된다', () => {
    const t = trip([day([spot('A', { at: '13:00' }), spot('B'), spot('C')], { startAt: '09:00' })]);
    const { trip: next, sorted } = applySpotEdit(t, { di: 0, si: 2 }, spot('C2', { at: '10:00' }), 0);
    expect(sorted).toBe(true);
    expect(next.days[0].spots.map(s => s.name)).toEqual(['C2', 'A', 'B']);
  });

  it('고정 시각이 없는 날은 순서를 건드리지 않는다', () => {
    const t = trip([day([spot('A'), spot('B')])]);
    const { trip: next, sorted } = applySpotEdit(t, { di: 0, si: 0 }, spot('A2'), 0);
    expect(sorted).toBe(false);
    expect(next.days[0].spots.map(s => s.name)).toEqual(['A2', 'B']);
  });

  it('원본 trip을 변형하지 않는다 (불변 갱신)', () => {
    const t = trip([day([spot('A', { at: '13:00' }), spot('B')], { startAt: '09:00' })]);
    const snapshot = JSON.stringify(t);
    applySpotEdit(t, { di: 0, si: 1 }, spot('B2', { at: '10:00' }), 0);
    expect(JSON.stringify(t)).toBe(snapshot);
  });

  it('없는 위치를 가리키면 아무것도 하지 않는다', () => {
    const t = trip([day([spot('A')])]);
    expect(applySpotEdit(t, { di: 0, si: 9 }, spot('X'), 0).trip).toBe(t);
    expect(applySpotEdit(t, { di: 0, si: 0 }, spot('X'), 5).trip).toBe(t);
  });
});

describe('removeSpot / moveSpot', () => {
  it('삭제는 그 장소만 뺀다', () => {
    const t = trip([day([spot('A'), spot('B'), spot('C')])]);
    expect(removeSpot(t, 0, 1).days[0].spots.map(s => s.name)).toEqual(['A', 'C']);
    expect(removeSpot(t, 0, 9)).toBe(t);
  });

  it('순서 변경은 이웃과 맞바꾼다 — 끝에서는 null', () => {
    const t = trip([day([spot('A'), spot('B'), spot('C')])]);
    expect(moveSpot(t, 0, 1, -1)?.days[0].spots.map(s => s.name)).toEqual(['B', 'A', 'C']);
    expect(moveSpot(t, 0, 1, 1)?.days[0].spots.map(s => s.name)).toEqual(['A', 'C', 'B']);
    expect(moveSpot(t, 0, 0, -1)).toBe(null);
    expect(moveSpot(t, 0, 2, 1)).toBe(null);
  });

  it('손으로 옮긴 순서를 시간순 정렬이 되돌리지 않는다', () => {
    const t = trip([day([spot('A', { at: '09:00' }), spot('B', { at: '11:00' })], { startAt: '09:00' })]);
    expect(moveSpot(t, 0, 0, 1)?.days[0].spots.map(s => s.name)).toEqual(['B', 'A']);
  });
});
