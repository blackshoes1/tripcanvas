// 여행·일자 관리 규칙 검증 — 특히 '날짜는 저장되지 않고 trip.start + 인덱스로 계산된다'는 계약.
import { describe, expect, it } from 'vitest';

import type { Day, Spot, Trip } from './types';
import {
  addDay, duplicateDay, emptyDay, isoDateOf, MIN_DAYS, newTrip, newTripId,
  removeDay, shiftStartForDay, updateDay, updateTripMeta
} from './tripEditor';

const spot = (name: string): Spot => ({ name, city: '제주', desc: '', lat: 33.5, lng: 126.5 });
const day = (extra: Partial<Day> = {}): Day => ({ ...emptyDay(), ...extra });
const trip = (days: Day[], extra: Partial<Trip> = {}): Trip =>
  ({ id: 't1', name: 'T', start: '2026-10-01', days, ...extra });

const BASE = () => trip([day({ title: 'D1' }), day({ title: 'D2' }), day({ title: 'D3' })]);
const PATCH = {
  title: '', drive: '', note: '', mode: 'car' as const,
  startAt: '09:00', timeZone: '', carry: true, isoDate: ''
};

describe('newTrip — 새 여행', () => {
  it('오늘 시작, 빈 일자 하나', () => {
    const t = newTrip('제주 여행', '2026-10-01', 'tX');
    expect(t).toMatchObject({ id: 'tX', name: '제주 여행', start: '2026-10-01' });
    expect(t.days).toHaveLength(1);
    expect(t.days[0].spots).toEqual([]);
  });

  it('이름을 비우면 기본 이름', () => {
    expect(newTrip('   ', '2026-10-01', 'tX').name).toBe('새 여행');
  });

  it('id는 정규화가 받아들이는 모양이다', () => {
    expect(newTripId()).toMatch(/^t[a-z0-9]+$/);
    expect(newTripId()).not.toBe(newTripId());
  });
});

describe('날짜는 계산된다 — trip.start + 인덱스', () => {
  it('isoDateOf는 시작일에서 며칠 뒤', () => {
    const t = BASE();
    expect(isoDateOf(t, 0)).toBe('2026-10-01');
    expect(isoDateOf(t, 2)).toBe('2026-10-03');
  });

  it('시작일이 없으면 날짜도 없다', () => {
    expect(isoDateOf(trip([day()], { start: '' }), 0)).toBe('');
  });

  it('월을 넘어가도 맞는다', () => {
    expect(isoDateOf(trip([day()], { start: '2026-10-30' }), 3)).toBe('2026-11-02');
  });

  it('어떤 날의 날짜를 바꾸면 여행 시작일이 통째로 움직인다', () => {
    const t = BASE();
    // Day 3을 10/10으로 → 시작일은 10/8이 된다
    const moved = shiftStartForDay(t, 2, '2026-10-10');
    expect(moved.start).toBe('2026-10-08');
    expect(isoDateOf(moved, 2)).toBe('2026-10-10');
    expect(isoDateOf(moved, 0)).toBe('2026-10-08');
  });

  it('날짜를 비우면 시작일 자체를 지운다 (날짜 미지정 여행)', () => {
    expect(shiftStartForDay(BASE(), 1, '').start).toBe('');
  });

  it('말이 안 되는 날짜는 무시한다', () => {
    const t = BASE();
    expect(shiftStartForDay(t, 0, '아무거나')).toBe(t);
  });
});

describe('updateTripMeta — 여행 정보', () => {
  it('이름·시작일·시간대를 바꾼다', () => {
    const r = updateTripMeta(BASE(), { name: '제주', start: '2026-11-01', timeZone: 'Asia/Seoul' });
    expect(r.ok && r.trip).toMatchObject({ name: '제주', start: '2026-11-01', timeZone: 'Asia/Seoul' });
  });

  it('시간대를 비우면 키를 지운다', () => {
    const withTz = trip([day()], { timeZone: 'Asia/Seoul' });
    const r = updateTripMeta(withTz, { name: 'T', start: '2026-10-01', timeZone: '  ' });
    expect(r.ok && 'timeZone' in r.trip).toBe(false);
  });

  it('IANA 형식이 아니면 저장 자체를 막는다', () => {
    expect(updateTripMeta(BASE(), { name: 'T', start: '2026-10-01', timeZone: '서울' }))
      .toEqual({ ok: false, error: 'BAD_TIMEZONE' });
  });

  it('이름을 비우면 기본 이름', () => {
    const r = updateTripMeta(BASE(), { name: '  ', start: '2026-10-01', timeZone: '' });
    expect(r.ok && r.trip.name).toBe('이름 없는 여행');
  });
});

describe('updateDay — 일자 편집', () => {
  it('제목·메모·수단·출발시각을 바꾼다 (시각은 숫자만 쳐도 받는다)', () => {
    const r = updateDay(BASE(), 1, { ...PATCH, title: '둘째날', note: '메모', mode: 'walk', startAt: '830' });
    expect(r.ok && r.trip.days[1]).toMatchObject({ title: '둘째날', note: '메모', mode: 'walk', startAt: '08:30' });
  });

  it('출발시각이 비면 09:00', () => {
    const r = updateDay(BASE(), 0, { ...PATCH, startAt: '' });
    expect(r.ok && r.trip.days[0].startAt).toBe('09:00');
  });

  it('이월을 끄면 startPolicy를 남기고, 켜면 지운다', () => {
    const off = updateDay(BASE(), 1, { ...PATCH, carry: false });
    expect(off.ok && off.trip.days[1].startPolicy).toBe('none');
    const on = updateDay(off.ok ? off.trip : BASE(), 1, { ...PATCH, carry: true });
    expect(on.ok && 'startPolicy' in on.trip.days[1]).toBe(false);
  });

  it('항공 정보는 비행기이고 편명이 있을 때만 남는다', () => {
    const f = { code: 'KE1234', dep: 'ICN', arr: 'CJU' };
    const kept = updateDay(BASE(), 0, { ...PATCH, mode: 'flight', flight: f });
    expect(kept.ok && kept.trip.days[0].flight).toEqual(f);

    const notFlight = updateDay(BASE(), 0, { ...PATCH, mode: 'car', flight: f });
    expect(notFlight.ok && 'flight' in notFlight.trip.days[0]).toBe(false);

    const noCode = updateDay(BASE(), 0, { ...PATCH, mode: 'flight', flight: { ...f, code: '  ' } });
    expect(noCode.ok && 'flight' in noCode.trip.days[0]).toBe(false);
  });

  it('시간대는 IANA 형식만', () => {
    expect(updateDay(BASE(), 0, { ...PATCH, timeZone: '도쿄' })).toEqual({ ok: false, error: 'BAD_TIMEZONE' });
    const ok = updateDay(BASE(), 0, { ...PATCH, timeZone: 'Asia/Tokyo' });
    expect(ok.ok && ok.trip.days[0].timeZone).toBe('Asia/Tokyo');
  });

  it('날짜를 바꾸면 여행 시작일이 따라 움직인다', () => {
    const r = updateDay(BASE(), 1, { ...PATCH, isoDate: '2026-12-25' });
    expect(r.ok && r.trip.start).toBe('2026-12-24');
    expect(r.ok && isoDateOf(r.trip, 1)).toBe('2026-12-25');
  });

  it('장소는 건드리지 않는다', () => {
    const t = trip([day({ spots: [spot('A'), spot('B')] })]);
    const r = updateDay(t, 0, { ...PATCH, title: '바뀜' });
    expect(r.ok && r.trip.days[0].spots.map(s => s.name)).toEqual(['A', 'B']);
  });

  it('없는 일자는 거부한다', () => {
    expect(updateDay(BASE(), 9, PATCH)).toEqual({ ok: false, error: 'NO_SUCH_DAY' });
  });

  it('원본 trip을 변형하지 않는다', () => {
    const t = BASE();
    const snapshot = JSON.stringify(t);
    updateDay(t, 0, { ...PATCH, title: '바뀜', isoDate: '2026-12-25' });
    expect(JSON.stringify(t)).toBe(snapshot);
  });
});

describe('addDay / duplicateDay / removeDay', () => {
  it('일자를 맨 뒤에 더한다', () => {
    const r = addDay(BASE());
    expect(r.trip.days).toHaveLength(4);
    expect(r.di).toBe(3);
    expect(r.trip.days[3].spots).toEqual([]);
  });

  it('복사본은 바로 뒤에, 제목에 표시가 붙는다', () => {
    const t = trip([day({ title: '첫날', spots: [spot('A')] }), day({ title: '둘째' })]);
    const next = duplicateDay(t, 0)!;
    expect(next.days.map(d => d.title)).toEqual(['첫날', '첫날 복사본', '둘째']);
    expect(next.days[1].spots.map(s => s.name)).toEqual(['A']);
  });

  it('복사본은 원본과 장소를 공유하지 않는다 (깊은 복사)', () => {
    const t = trip([day({ spots: [spot('A')] })]);
    const next = duplicateDay(t, 0)!;
    expect(next.days[1].spots[0]).not.toBe(next.days[0].spots[0]);
  });

  it('제목이 없으면 Day 번호로 이름을 만든다', () => {
    expect(duplicateDay(trip([day()]), 0)!.days[1].title).toBe('Day 1 복사본');
  });

  it('일자를 지운다 — 마지막 하나는 못 지운다', () => {
    const r = removeDay(BASE(), 1);
    expect(r.ok && r.trip.days.map(d => d.title)).toEqual(['D1', 'D3']);
    expect(removeDay(trip([day()]), 0)).toEqual({ ok: false, error: 'LAST_DAY' });
    expect(MIN_DAYS).toBe(1);
  });

  it('없는 일자는 거부한다', () => {
    expect(removeDay(BASE(), 9)).toEqual({ ok: false, error: 'NO_SUCH_DAY' });
    expect(duplicateDay(BASE(), 9)).toBe(null);
  });

  it('원본 trip을 변형하지 않는다', () => {
    const t = BASE();
    const snapshot = JSON.stringify(t);
    addDay(t); duplicateDay(t, 0); removeDay(t, 0);
    expect(JSON.stringify(t)).toBe(snapshot);
  });
});
