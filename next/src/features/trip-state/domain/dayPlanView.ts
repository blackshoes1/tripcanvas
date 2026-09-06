// 일자 계획을 계약 모양으로(§엔진은 하나다).
//
// **판정은 여기서 하지 않는다.** 앵커·타임라인·숙소 복귀·렌터카 파생·비용 배분은 전부
// `features/itinerary/domain/dayView.ts`가 이미 조립해 두었고, 그 안은 `lib.js` 단일 소스다.
// 이 파일은 그 결과를 **값으로** 옮긴다 — `todayView.ts`가 `adaptive.js`에 대해 하는 일과 같다.
//
// ⚠️ 웹 `DayView`를 그대로 보내지 않는 이유: 그쪽은 `"📏 하루 동선 약 12.4km · 🚗25분"` 같은
// 완성된 문장을 들고 있다. 그걸 보내면 앱이 서버가 만든 한국어를 그리게 되고, 거리와 시간을
// 따로 배치할 수도 없다. 계약의 나머지(NextAction·DaySummary)와 같은 규칙을 지킨다.
//
// ⚠️ 서버에는 구간 캐시가 없다 — 이동시간이 **직선거리 추정**이다. `travelTimeSource`로 그 사실을
// 실어 보내고, 화면이 "예상"이라고 표기한다.
import legacyLib from '@legacy/lib.js';

import {
  backLegOf, buildDayView, dayEndMinOf, dayModeOf, dayTimelineOf, hasCoord, isoDateOf, type LocatedSpot,
  legMinutes, legModeOf
} from '@/features/itinerary/domain/dayView';
import type { LegCache } from '@/features/itinerary/domain/types';
import type { Day, Spot, TransportMode, Trip } from '@/features/trip/domain/types';

import type { TripDoc } from './todayView';

import { CONTRACT_SCHEMA_VERSION } from './contract';
import type {
  DayPlanCarEvent, DayPlanDay, DayPlanLeg, DayPlanResponse, DayPlanSpot, DayPlanStripEntry, TripSummary
} from './contract';

const { carEventsOn, carSpotLinks, dayReturnStay, dayStartAnchor, haversine, parseHM, spotCatOf } = legacyLib;

/** 서버에는 구간 캐시가 없다 — 비어 있는 캐시를 넘기면 lib이 직선거리 추정으로 떨어진다. */
const NO_CACHE: LegCache = Object.freeze({});

/** ⚠️ lib의 haversine은 **km**를 돌려준다(R=6371km). 미터로 오해하면 거리가 1000배 어긋난다. */
function km(kilometers: number): number {
  return Math.round(kilometers * 10) / 10;
}

function pointOf(spot: Spot | null | undefined): { lat: number; lng: number } | null {
  return hasCoord(spot) ? { lat: spot.lat, lng: spot.lng } : null;
}

function legOf(from: LocatedSpot, to: LocatedSpot, mode: TransportMode): DayPlanLeg {
  return {
    mode,
    minutes: Math.round(legMinutes(NO_CACHE, from, to, mode)),
    distanceKm: km(haversine(from, to)),
    // 캐시가 비어 있으므로 항상 추정이다. 캐시를 서버에 들이면 이 값이 구간마다 갈린다.
    source: 'STRAIGHT_LINE_ESTIMATE'
  };
}

/** `carEventsOn`이 준 시각 문자열을 분으로. 시각이 없으면 null이다(있는 척하지 않는다). */
function minutesOf(value: unknown): number | null {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!/^\d{1,2}:\d{2}$/.test(text)) return null;
  const m = parseHM(text);
  return Number.isFinite(m) ? m : null;
}

function carEventsFor(trip: Trip, di: number, iso: string): { pickups: DayPlanCarEvent[]; returns: DayPlanCarEvent[] } {
  const out: { pickups: DayPlanCarEvent[]; returns: DayPlanCarEvent[] } = { pickups: [], returns: [] };
  if (!iso) return out;
  // 일정의 장소와 연결된 이벤트는 그 장소 행에 붙으므로 독립 행에서 뺀다(웹과 같은 규칙).
  const links = carSpotLinks(trip.days as unknown[]);
  for (const raw of carEventsOn(trip.bookings ?? [], iso) as Array<Record<string, unknown>>) {
    const kind = String(raw.kind ?? '');
    if (kind !== 'pickup' && kind !== 'return') continue;
    const id = String(raw.id ?? '');
    if (links[kind]?.[id]) continue;
    const event: DayPlanCarEvent = {
      kind: kind === 'pickup' ? 'PICKUP' : 'RETURN',
      bookingId: id,
      // "제주공항점 (CJU)" — 장소도 코드도 없으면 예약 제목으로 대체한다
      place: [String(raw.place ?? '').trim(), String(raw.code ?? '').trim() && `(${String(raw.code).trim()})`]
        .filter(Boolean).join(' ') || String(raw.title ?? '').trim(),
      atMinutes: minutesOf(raw.time)
    };
    (kind === 'pickup' ? out.pickups : out.returns).push(event);
  }
  return out;
}

export interface DayPlanInput {
  /** 저장된 여행 문서 원문. 계약 계층은 느슨한 `TripDoc`으로 받는다(`todayView`와 같다). */
  trip: TripDoc;
  di: number;
  summary: TripSummary;
  generatedAt: string;
}

/**
 * 그 날 하나를 계약 모양으로. 일자 번호가 범위를 벗어나면 **null** — 없는 날을 지어내지 않는다.
 */
export function buildDayPlanView(input: DayPlanInput): DayPlanResponse | null {
  // itinerary 도메인은 정규화된 `Trip`을 받는다. 유입은 `normalizeTrip`을 이미 지났으므로
  // 여기서 한 번만 좁힌다 — 호출부마다 캐스팅을 흩뿌리지 않는다.
  const trip = input.trip as unknown as Trip;
  const { di } = input;
  const days = trip.days ?? [];
  if (!Number.isInteger(di) || di < 0 || di >= days.length) return null;

  const day: Day = days[di];
  const spots = day.spots ?? [];
  const timeline = dayTimelineOf(trip, NO_CACHE, di);
  const dayMode = dayModeOf(day);

  // ⚠️ anchor와 carry는 다르다: ETA는 anchor(숙소가 아니어도 전날 마지막 장소)에서 출발하고,
  // 🏠 표시는 carry(숙소일 때만)다. 둘을 섞으면 화면과 시각이 어긋난다.
  const anchor = dayStartAnchor(days as unknown[], di) as Spot | null;
  const carry = anchor && (anchor as { stay?: boolean }).stay ? anchor : null;

  let incoming: LocatedSpot | null = hasCoord(anchor) ? anchor : null;
  let travelMinutes = 0;
  let distanceKm = 0;

  const planSpots: DayPlanSpot[] = spots.map((spot, si) => {
    const entry = timeline[si] ?? { eta: 0, fixed: false, conflict: false, wait: 0 };
    let leg: DayPlanLeg | null = null;
    if (hasCoord(spot) && incoming) {
      const mode = legModeOf(day, spot);
      leg = legOf(incoming, spot, mode);
      travelMinutes += leg.minutes;
      distanceKm += haversine(incoming, spot);
    }
    if (hasCoord(spot)) incoming = spot;

    return {
      index: si,
      name: String(spot.name ?? ''),
      city: String(spot.city ?? ''),
      category: (spotCatOf(spot) as { id?: string } | null)?.id ?? null,
      location: pointOf(spot),
      etaMinutes: Math.round(entry.eta),
      fixed: entry.fixed,
      conflict: entry.conflict,
      bookedAtMinutes: minutesOf(spot.bookAt),
      waitMinutes: Math.max(0, Math.round(entry.wait ?? 0)),
      stayMinutes: spot.stayMin != null ? Number(spot.stayMin) : null,
      status: String((spot as { status?: unknown }).status ?? 'PLANNED'),
      incomingLeg: leg
    };
  });

  // 숙소 복귀는 합성 구간이다 — 데이터에 없고 표시·계산에만 얹힌다.
  // ⚠️ 마지막 날에는 붙지 않는다(dayReturnStay가 그렇게 정한다 — 떠나는 날이라서).
  const backSpot = dayReturnStay(days as unknown[], di) as Spot | null;
  const backLeg = backLegOf(day, backSpot);
  let back: DayPlanDay['back'] = null;
  if (backLeg) {
    const leg = legOf(backLeg.from, backLeg.to, backLeg.mode);
    travelMinutes += leg.minutes;
    distanceKm += haversine(backLeg.from, backLeg.to);
    back = { name: String(backLeg.to.name ?? ''), location: pointOf(backLeg.to), leg };
  }

  const iso = isoDateOf(trip, di);
  const cars = carEventsFor(trip, di, iso);
  // ⚠️ 타임라인은 분을 소수로 들고 있다(이동시간이 실수라서). 계약의 '분'은 정수다 —
  // 소수를 그대로 보내면 Swift가 Int로 디코딩하다 죽는다. 표시도 분 단위라 잃는 것이 없다.
  const rawEnd = dayEndMinOf(trip, NO_CACHE, di);
  const endMinutes = rawEnd == null ? null : Math.round(rawEnd);

  const planDay: DayPlanDay = {
    index: di,
    date: iso,
    title: String(day.title ?? ''),
    note: String(day.note ?? ''),
    mode: dayMode,
    startMinutes: parseHM(day.startAt || '09:00'),
    timeZone: String(day.timeZone ?? trip.timeZone ?? ''),
    carriedStay: carry ? { name: String(carry.name ?? ''), location: pointOf(carry) } : null,
    spots: planSpots,
    carPickups: cars.pickups,
    carReturns: cars.returns,
    back,
    spotsWithoutLocation: spots.filter((s) => !hasCoord(s)).length,
    totals: {
      distanceKm: km(distanceKm),
      travelMinutes,
      endMinutes,
      // 자정을 넘기면 과밀이다 — 웹의 '⚠️ 일정 과밀'과 같은 기준.
      overloaded: endMinutes != null && endMinutes > 24 * 60,
      cost: dayCostOf(trip, di)
    }
  };

  return {
    schemaVersion: CONTRACT_SCHEMA_VERSION,
    generatedAt: input.generatedAt,
    travelTimeSource: 'STRAIGHT_LINE_ESTIMATE',
    trip: input.summary,
    dayCount: days.length,
    days: days.map((d, i): DayPlanStripEntry => ({
      index: i,
      date: isoDateOf(trip, i),
      title: String(d.title ?? ''),
      spotCount: (d.spots ?? []).length
    })),
    day: planDay
  };
}

/**
 * 하루 비용은 웹 일자 카드와 같은 규칙 — 장소 + (자차·택시일 때) 택시 + 예약 하루치.
 * `buildDayView`가 이미 이 계산을 들고 있어 값만 꺼내 쓴다. 규칙을 두 곳에 두지 않는다.
 * (라벨까지 함께 만들지만 그 비용은 무시할 만하고, 계산을 복제하는 쪽이 훨씬 비싸다)
 */
function dayCostOf(trip: Trip, di: number): DayPlanDay['totals']['cost'] {
  const { cost } = buildDayView(trip, NO_CACHE, di);
  return { total: cost.total, parts: cost.parts.map((p) => ({ label: p.label, amount: p.amount })) };
}
