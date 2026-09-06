// 장소 편집 규칙 검증 — 레거시 spotSave/moveSpot/deleteSpot과 같은 판정을 지키는지.
// 특히 편집이 '값만 고치는 일'이라는 계약: 좌표·예약 연결은 폼을 거치지 않고 원본에서 물려받는다.
import { describe, expect, it } from 'vitest';

import type { PlaceResult } from '@/features/search/domain/types';
import type { Day, Spot, Trip } from '@/features/trip/domain/types';
import {
  applyPlaceToForm, applySpotAdd, applySpotEdit, formFromSpot, insertIndexOf,
  moveDay, moveSpot, moveSpotTo, newSpotDraft, removeSpot, spotFromForm
} from './spotEditor';

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

  it('좌표·placeId·kakaoId·영업시간도 원본 그대로', () => {
    const hours = [{ d: 1, o: 540, c: 1080 }];
    const after = edit(spot('A', { placeId: 'ChIJ_x', kakaoId: '13525626', hours }), { name: 'A2' });
    expect(after).toMatchObject({ lat: 33.5, lng: 126.5, placeId: 'ChIJ_x', kakaoId: '13525626' });
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

describe('applySpotAdd — 새 장소가 들어갈 자리', () => {
  const NEW = (): Spot => spot('새 장소');

  it('선택한 장소 바로 뒤에 들어간다', () => {
    const t = trip([day([spot('A'), spot('B'), spot('C')])]);
    const r = applySpotAdd(t, NEW(), { openedDi: 0, targetDi: 0, after: 0 });
    expect(r.trip.days[0].spots.map(s => s.name)).toEqual(['A', '새 장소', 'B', 'C']);
    expect(r.si).toBe(1);   // 방금 넣은 자리를 알려준다 — 연달아 추가하면 그 뒤로 붙게
  });

  it('선택이 없으면 맨 뒤', () => {
    const t = trip([day([spot('A'), spot('B')])]);
    const r = applySpotAdd(t, NEW(), { openedDi: 0, targetDi: 0, after: null });
    expect(r.trip.days[0].spots.map(s => s.name)).toEqual(['A', 'B', '새 장소']);
  });

  it('저장하며 일자를 바꿨으면 선택 위치를 버리고 대상 날 맨 뒤로', () => {
    const t = trip([day([spot('A'), spot('B')]), day([spot('X')])]);
    const r = applySpotAdd(t, NEW(), { openedDi: 0, targetDi: 1, after: 0 });
    expect(r.trip.days[0].spots.map(s => s.name)).toEqual(['A', 'B']);
    expect(r.trip.days[1].spots.map(s => s.name)).toEqual(['X', '새 장소']);
  });

  it('고정 시각이 있으면 넣은 뒤 시간순으로 정렬한다', () => {
    const t = trip([day([spot('A', { at: '13:00' }), spot('B')], { startAt: '09:00' })]);
    const r = applySpotAdd(t, spot('아침', { at: '08:00' }), { openedDi: 0, targetDi: 0, after: 1 });
    expect(r.sorted).toBe(true);
    expect(r.trip.days[0].spots.map(s => s.name)).toEqual(['아침', 'A', 'B']);
    expect(r.trip.days[0].spots[r.si].name).toBe('아침');   // 정렬 뒤 자리를 가리킨다
  });

  it('원본 trip을 변형하지 않고, 없는 일자는 아무것도 하지 않는다', () => {
    const t = trip([day([spot('A')])]);
    const snapshot = JSON.stringify(t);
    applySpotAdd(t, NEW(), { openedDi: 0, targetDi: 0, after: null });
    expect(JSON.stringify(t)).toBe(snapshot);
    expect(applySpotAdd(t, NEW(), { openedDi: 0, targetDi: 9, after: null }).trip).toBe(t);
  });

  it('insertIndexOf — 선택 인덱스가 범위를 넘어도 맨 뒤로 클램프된다', () => {
    const spots = [spot('A'), spot('B')];
    expect(insertIndexOf(spots, { openedDi: 0, targetDi: 0, after: 5 })).toBe(2);
    expect(insertIndexOf(spots, { openedDi: 0, targetDi: 0, after: 0 })).toBe(1);
    expect(insertIndexOf(spots, { openedDi: 0, targetDi: 1, after: 0 })).toBe(2);
  });
});

describe('newSpotDraft / applyPlaceToForm — 검색 결과 반영', () => {
  const place: PlaceResult = {
    name: 'Park Güell', addr: 'Carrer d\'Olot', city: 'Barcelona',
    lat: 41.4145, lng: 2.1527, cat: 'sight', hours: [{ d: 1, o: 540, c: 1080 }], placeId: 'ChIJ_pk'
  };

  it('초안의 도시는 그 날 첫 장소를 따라간다', () => {
    expect(newSpotDraft(day([spot('A')])).city).toBe('제주');
    expect(newSpotDraft(day([])).city).toBe('');
    expect(newSpotDraft(undefined).city).toBe('');
    expect(newSpotDraft(day([])).lat).toBe(null);
  });

  it('결과를 고르면 이름·도시·분류는 폼에, 좌표·placeId·영업시간은 초안에 담긴다', () => {
    const draft = newSpotDraft(undefined);
    const r = applyPlaceToForm(formFromSpot(draft, 0), draft, place);
    expect(r.form).toMatchObject({ name: 'Park Güell', city: 'Barcelona', cat: 'sight' });
    expect(r.draft).toMatchObject({ lat: 41.4145, lng: 2.1527, placeId: 'ChIJ_pk' });
    expect(r.draft.hours).toEqual([{ d: 1, o: 540, c: 1080 }]);
    // 그대로 저장하면 초안의 값이 장소로 넘어간다
    const saved = spotFromForm(r.form, r.draft, { requireLocation: true });
    expect(saved.ok && saved.spot).toMatchObject({ name: 'Park Güell', lat: 41.4145, placeId: 'ChIJ_pk', cat: 'sight' });
  });

  it('국내 결과를 고르면 kakaoId가 초안에 담기고, 다른 결과를 고르면 지워진다', () => {
    const kakao: PlaceResult = {
      name: '성산일출봉', addr: '제주 서귀포시 성산읍', city: '서귀포',
      lat: 33.458, lng: 126.9425, kakaoId: '13525626'
    };
    const draft = newSpotDraft(undefined);
    const picked = applyPlaceToForm(formFromSpot(draft, 0), draft, kakao);
    expect(picked.draft.kakaoId).toBe('13525626');
    const saved = spotFromForm(picked.form, picked.draft, { requireLocation: true });
    expect(saved.ok && saved.spot.kakaoId).toBe('13525626');

    // 해외 결과로 갈아타면 국내 신원은 그 장소가 아니다
    const again = applyPlaceToForm(picked.form, picked.draft, place);
    expect(again.draft.kakaoId).toBeUndefined();
  });

  it('결과가 도시를 모르면 기존 도시를 지우지 않는다', () => {
    const draft = newSpotDraft(day([spot('A')]));   // city: '제주'
    const r = applyPlaceToForm(formFromSpot(draft, 0), draft, { ...place, city: '' });
    expect(r.form.city).toBe('제주');
  });

  it('다른 결과를 다시 고르면 이전 결과의 placeId·영업시간이 남지 않는다', () => {
    const draft = newSpotDraft(undefined);
    const first = applyPlaceToForm(formFromSpot(draft, 0), draft, place);
    const second = applyPlaceToForm(first.form, first.draft,
      { name: '이름만', addr: '', city: '', lat: 1, lng: 2 });
    expect('placeId' in second.draft).toBe(false);
    expect('hours' in second.draft).toBe(false);
    expect(second.draft).toMatchObject({ lat: 1, lng: 2 });
  });

  it('새 장소는 위치 없이 저장되지 않는다 — 기존 장소는 위치 없이도 고칠 수 있다', () => {
    const draft = newSpotDraft(undefined);
    const form = { ...formFromSpot(draft, 0), name: '어딘가' };
    expect(spotFromForm(form, draft, { requireLocation: true }))
      .toEqual({ ok: false, error: 'LOCATION_REQUIRED' });
    const kept = spotFromForm(form, draft);
    expect(kept.ok && kept.spot.lat).toBe(null);
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

describe('moveSpotTo — 드래그 드롭', () => {
  it('같은 날 안에서 원하는 자리로 옮긴다', () => {
    const t = trip([day([spot('A'), spot('B'), spot('C')])]);
    const r = moveSpotTo(t, { di: 0, si: 2 }, { di: 0, index: 0 })!;
    expect(r.trip.days[0].spots.map(s => s.name)).toEqual(['C', 'A', 'B']);
    expect(r.si).toBe(0);
  });

  it('다른 날로 끌어다 놓으면 원래 날에서 빠진다', () => {
    const t = trip([day([spot('A'), spot('B')]), day([spot('X'), spot('Y')])]);
    const r = moveSpotTo(t, { di: 0, si: 0 }, { di: 1, index: 1 })!;
    expect(r.trip.days[0].spots.map(s => s.name)).toEqual(['B']);
    expect(r.trip.days[1].spots.map(s => s.name)).toEqual(['X', 'A', 'Y']);
  });

  it('고정 시각이 있는 날에 놓으면 시간순으로 재정렬된다 (시각이 순서를 이긴다)', () => {
    const t = trip([
      day([spot('늦은밤', { at: '22:00' })]),
      day([spot('아침', { at: '08:00' }), spot('점심', { at: '12:00' })], { startAt: '08:00' })
    ]);
    const r = moveSpotTo(t, { di: 0, si: 0 }, { di: 1, index: 0 })!;
    expect(r.sorted).toBe(true);
    expect(r.trip.days[1].spots.map(s => s.name)).toEqual(['아침', '점심', '늦은밤']);
    expect(r.trip.days[1].spots[r.si].name).toBe('늦은밤');   // 정렬 뒤 자리를 가리킨다
  });

  it('고정 시각이 없으면 놓은 자리를 그대로 지킨다', () => {
    const t = trip([day([spot('A'), spot('B'), spot('C')])]);
    const r = moveSpotTo(t, { di: 0, si: 0 }, { di: 0, index: 2 })!;
    expect(r.sorted).toBe(false);
    expect(r.trip.days[0].spots.map(s => s.name)).toEqual(['B', 'C', 'A']);
  });

  it('제자리에 놓거나 없는 것을 옮기면 null (아무 일도 없었음)', () => {
    const t = trip([day([spot('A'), spot('B')])]);
    expect(moveSpotTo(t, { di: 0, si: 0 }, { di: 0, index: 0 })).toBe(null);
    expect(moveSpotTo(t, { di: 0, si: 9 }, { di: 0, index: 0 })).toBe(null);
    expect(moveSpotTo(t, { di: 0, si: 0 }, { di: 5, index: 0 })).toBe(null);
  });

  it('범위를 넘는 위치는 맨 뒤로 클램프된다', () => {
    const t = trip([day([spot('A'), spot('B')])]);
    expect(moveSpotTo(t, { di: 0, si: 0 }, { di: 0, index: 99 })!.trip.days[0].spots.map(s => s.name))
      .toEqual(['B', 'A']);
  });

  it('원본 trip을 변형하지 않는다', () => {
    const t = trip([day([spot('A'), spot('B')]), day([spot('X')])]);
    const snapshot = JSON.stringify(t);
    moveSpotTo(t, { di: 0, si: 0 }, { di: 1, index: 0 });
    expect(JSON.stringify(t)).toBe(snapshot);
  });
});

describe('moveDay — 일자 순서 변경', () => {
  const named = (title: string) => day([], { title });

  it('일자를 옮기면 나머지가 밀린다 (날짜는 인덱스를 따라간다)', () => {
    const t = trip([named('1일'), named('2일'), named('3일')]);
    expect(moveDay(t, 2, 0)!.days.map(d => d.title)).toEqual(['3일', '1일', '2일']);
    expect(moveDay(t, 0, 2)!.days.map(d => d.title)).toEqual(['2일', '3일', '1일']);
  });

  it('장소는 그 일자를 따라 함께 움직인다', () => {
    const t = trip([day([spot('A')]), day([spot('B')])]);
    expect(moveDay(t, 1, 0)!.days.map(d => d.spots[0].name)).toEqual(['B', 'A']);
  });

  it('제자리·범위 밖이면 null', () => {
    const t = trip([named('1일'), named('2일')]);
    expect(moveDay(t, 0, 0)).toBe(null);
    expect(moveDay(t, 0, 5)).toBe(null);
    expect(moveDay(t, 9, 0)).toBe(null);
    expect(moveDay(t, 0, -1)).toBe(null);
  });

  it('원본 trip을 변형하지 않는다', () => {
    const t = trip([named('1일'), named('2일')]);
    const snapshot = JSON.stringify(t);
    moveDay(t, 0, 1);
    expect(JSON.stringify(t)).toBe(snapshot);
  });
});
