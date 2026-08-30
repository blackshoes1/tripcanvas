// 여행·일자 관리 도메인 — 순수(§9). 레거시 createNewTrip/tripSave/openDayModal 저장/copyDay/deleteDay와
// 같은 판정을 유지한다(동작 변경 금지 — §28). 저장은 services가 맡는다.
//
// ⚠️ 날짜는 저장되지 않는다. `trip.start` + 일자 인덱스로 계산된다 —
// 그래서 어떤 날의 날짜를 바꾸면 그 날이 그 날짜가 되도록 **여행 시작일 전체가 움직인다**.
// (일자별 날짜를 따로 들고 있으면 일자 순서를 바꿀 때마다 날짜를 다시 매겨야 한다)
import legacyLib from '@legacy/lib.js';

import type { Day, DayFlight, TransportMode, Trip } from './types';

const { toISO, validTimeZone } = legacyLib;

/** 여행에는 일자가 하나 이상 필요하다 */
export const MIN_DAYS = 1;

export type TripEditError = 'BAD_TIMEZONE' | 'LAST_DAY' | 'NO_SUCH_DAY';

/** 빈 일자 하나 — 레거시가 여행을 만들 때·일자를 더할 때 쓰는 모양 그대로 */
export function emptyDay(): Day {
  return { title: '', drive: '', note: '', mode: 'car', spots: [] };
}

/** 새 여행 — 오늘 시작, 빈 일자 하나 */
export function newTrip(name: string, today: string, id: string): Trip {
  return { id, name: name.trim() || '새 여행', start: today, days: [emptyDay()] };
}

/** 클라이언트 생성 id — 레거시 uid()와 같은 강도(정규화 _ID_RE 통과) */
export function newTripId(): string {
  return 't' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

/** di번째 날의 ISO 날짜 (시작일 미설정이면 빈 문자열) */
export function isoDateOf(trip: Trip, di: number): string {
  if (!trip.start) return '';
  const d = new Date(trip.start + 'T00:00:00');
  d.setDate(d.getDate() + di);
  return toISO(d);
}

/**
 * di번째 날이 그 날짜가 되도록 여행 시작일을 옮긴다 (레거시 dayModal 저장 규칙).
 * 빈 날짜를 주면 시작일 자체를 지운다 — '날짜 미지정' 여행.
 */
export function shiftStartForDay(trip: Trip, di: number, isoDate: string): Trip {
  if (!isoDate) return { ...trip, start: '' };
  const d = new Date(isoDate + 'T00:00:00');
  if (isNaN(d.getTime())) return trip;
  d.setDate(d.getDate() - di);
  return { ...trip, start: toISO(d) };
}

export interface TripMeta {
  name: string;
  start: string;
  timeZone: string;
}

/** 여행 이름·시작일·시간대 — 시간대는 IANA 형식만 받는다(잘못된 값은 저장 자체를 막는다) */
export function updateTripMeta(trip: Trip, meta: TripMeta): { ok: true; trip: Trip } | { ok: false; error: TripEditError } {
  const timeZone = meta.timeZone.trim();
  if (timeZone && !validTimeZone(timeZone)) return { ok: false, error: 'BAD_TIMEZONE' };
  const next: Trip = { ...trip, name: meta.name.trim() || '이름 없는 여행', start: meta.start };
  if (timeZone) next.timeZone = timeZone; else delete next.timeZone;
  return { ok: true, trip: next };
}

export interface DayPatch {
  title: string;
  drive: string;
  note: string;
  mode: TransportMode;
  startAt: string;
  timeZone: string;
  /** 전날 위치를 이월받을지 — 끄면 startPolicy:'none' (공항 이동일·야간열차) */
  carry: boolean;
  /** 이 날의 날짜 — 바꾸면 여행 시작일이 통째로 움직인다 */
  isoDate: string;
  flight?: DayFlight | null;
}

/** 일자 편집 — 시간대는 IANA 형식만. 날짜는 여행 시작일을 옮겨 반영한다 */
export function updateDay(
  trip: Trip, di: number, patch: DayPatch
): { ok: true; trip: Trip } | { ok: false; error: TripEditError } {
  if (!trip.days[di]) return { ok: false, error: 'NO_SUCH_DAY' };
  const tz = patch.timeZone.trim();
  if (tz && !validTimeZone(tz)) return { ok: false, error: 'BAD_TIMEZONE' };

  const day: Day = {
    ...trip.days[di],
    title: patch.title.trim(),
    drive: patch.drive.trim(),
    note: patch.note.trim(),
    mode: patch.mode,
    startAt: legacyLib.normHM(patch.startAt) || '09:00'
  };
  if (tz) day.timeZone = tz; else delete day.timeZone;
  // 이월은 켜진 게 기본이라, 껐을 때만 정책을 남긴다
  if (patch.carry) delete day.startPolicy; else day.startPolicy = 'none';
  // 항공 정보는 비행기일 때만 의미가 있다
  if (patch.mode === 'flight' && patch.flight?.code?.trim()) day.flight = patch.flight;
  else delete day.flight;

  const withDay: Trip = { ...trip, days: trip.days.map((d, i) => (i === di ? day : d)) };
  return { ok: true, trip: shiftStartForDay(withDay, di, patch.isoDate) };
}

/** 일자 추가 — 맨 뒤에 빈 날 하나 */
export function addDay(trip: Trip): { trip: Trip; di: number } {
  const days = [...trip.days, emptyDay()];
  return { trip: { ...trip, days }, di: days.length - 1 };
}

/** 일자 복사 — 바로 뒤에 (레거시 copyDay: 제목에 '복사본'을 붙인다) */
export function duplicateDay(trip: Trip, di: number): Trip | null {
  const src = trip.days[di];
  if (!src) return null;
  const copy: Day = JSON.parse(JSON.stringify(src));
  copy.title = `${src.title || `Day ${di + 1}`} 복사본`;
  const days = [...trip.days];
  days.splice(di + 1, 0, copy);
  return { ...trip, days };
}

/** 일자 삭제 — 마지막 하나는 지울 수 없다 */
export function removeDay(trip: Trip, di: number): { ok: true; trip: Trip } | { ok: false; error: TripEditError } {
  if (!trip.days[di]) return { ok: false, error: 'NO_SUCH_DAY' };
  if (trip.days.length <= MIN_DAYS) return { ok: false, error: 'LAST_DAY' };
  return { ok: true, trip: { ...trip, days: trip.days.filter((_, i) => i !== di) } };
}
