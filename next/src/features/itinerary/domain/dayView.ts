// 일자 뷰 빌더 — 레거시 renderSidebar/dayContext의 배선을 순수 함수로 재현한다.
// 순수 계산(앵커·타임라인·렌터카 파생·비용 배분)은 lib.js 단일 소스를 그대로 쓰고,
// 여기는 app.js에만 있던 '표시 배선'(캐시 조회·라벨·경고 판정)을 담는다.
// ⚠️ anchor/carry 구분: ETA·종료시각은 anchor(전날 숙소 또는 마지막 장소), 🏠 표시는 carry(숙소일 때만).
import legacyLib from '@legacy/lib.js';

import type { Booking, CarBooking } from '@/features/booking/domain/types';
import type { Day, Spot, TransportMode, Trip } from '@/features/trip/domain/types';
import { costLabel, currencySymbol, fmtMoney, type FxRates, fxRates, toKRW } from '@/lib/currency/format';
import type {
  CachedLeg, CarChipView, CarEventRowView, DayCostPart, DayView, LegCache, LegView, SpotView, TripCostView
} from './types';

const {
  bookingShareOn, carEventsOn, carSpotLinks, computeTimeline, dayReturnStay, dayStartAnchor,
  haversine, hm, isOpenAt, legKey, localMode, parseHM, spotCatOf, stayNights, toISO
} = legacyLib;

// ── 수단 상수 (app.js와 동일 값 — Phase 6에서 단일 소스로 합칠 표시·추정용 글루) ──
export const MODE_ICON: Record<TransportMode, string> =
  { car: '🚗', taxi: '🚕', transit: '🚌', train: '🚆', walk: '🚶', bike: '🚴', flight: '✈️' };
export const MODE_NAME: Record<TransportMode, string> =
  { car: '자차', taxi: '택시', transit: '대중교통', train: '기차', walk: '도보', bike: '자전거', flight: '비행기' };
/** km/h — 미캐시 구간 추정용 (택시=도로 기준, 기차=고속철 평균) */
const MODE_SPEED: Record<TransportMode, number> =
  { car: 40, taxi: 40, transit: 25, train: 160, walk: 4.5, bike: 15, flight: 700 };

export type LatLng = { lat: number; lng: number };
export type LocatedSpot = Spot & LatLng;

export function hasCoord(s: Spot | null | undefined): s is LocatedSpot {
  return !!s && s.lat != null && s.lng != null && isFinite(+s.lat) && isFinite(+s.lng);
}

export function dayModeOf(day: Day): TransportMode {
  return MODE_ICON[day.mode] ? day.mode : 'car';
}
export function legModeOf(day: Day, spot?: Spot): TransportMode {
  const m = spot?.legMode;
  return m && MODE_ICON[m] ? m : dayModeOf(day);
}

export function isoDateOf(trip: Trip, di: number): string {
  if (!trip.start) return '';
  const d = new Date(trip.start + 'T00:00:00');
  d.setDate(d.getDate() + di);
  return toISO(d);
}
export function dateLabelOf(trip: Trip, di: number): string {
  if (!trip.start) return '';
  const d = new Date(trip.start + 'T00:00:00');
  d.setDate(d.getDate() + di);
  return `${d.getMonth() + 1}/${d.getDate()} (${'일월화수목금토'[d.getDay()]})`;
}

// ── 구간 캐시 조회 (읽기 전용) ──
// 레거시는 대중교통을 출발시각별 키(base@tz@when)로도 캐시하지만 모든 결과를 base 키에도 쓴다.
// Next 읽기 뷰는 base 키만 본다 — 없으면 레거시와 같은 속도 기반 직선 추정으로 폴백.
function cachedLeg(legCache: LegCache, a: LatLng, b: LatLng, mode: TransportMode): CachedLeg | null {
  const c = legCache[legKey(a, b, mode)];
  return c && c.sec ? c : null;
}
function failedLeg(legCache: LegCache, a: LatLng, b: LatLng, mode: TransportMode): boolean {
  const c = legCache[legKey(a, b, mode)];
  return !!(c && !c.sec && c.fail);
}

/** 구간 이동시간(분) — app.js legMinutes와 동일: 캐시 우선(자차 2km 미만은 도보 대안), 없으면 직선 추정 */
export function legMinutes(legCache: LegCache, a: LatLng, b: LatLng, mode: TransportMode): number {
  const m: TransportMode = MODE_ICON[mode] ? mode : 'car';
  const c = cachedLeg(legCache, a, b, m);
  if (c && c.sec) return m === 'car' && (c.m ?? 0) < 2000 ? (c.m ?? 0) / 75 : c.sec / 60;
  return (haversine(a, b) / MODE_SPEED[m]) * 60;
}

export function fmtDur(sec: number): string {
  const m = Math.round(sec / 60);
  return m < 60 ? `${m}분` : `${Math.floor(m / 60)}시간${m % 60 ? ' ' + (m % 60) + '분' : ''}`;
}

function legViewOf(legCache: LegCache, a: LatLng, b: LatLng, mode: TransportMode): LegView {
  const c = cachedLeg(legCache, a, b, mode);
  if (c && c.sec) {
    const dist = c.m ?? 0;
    const km = (dist / 1000).toFixed(1);
    const label = mode === 'car' && dist < 2000
      ? `↳${km}km · 🚶${Math.max(1, Math.round(dist / 75))}분`
      : `↳${km}km · ${fmtDur(c.sec)}`;
    let title = c.est
      ? (mode === 'flight' || mode === 'train' ? '직선거리 기반 추정' : '자동차 경로 거리 기반 추정')
      : '실제 도로 기준';
    if (c.snapped) title += ' · 인근 지점에서 출발/도착 (원 지점이 도로·정류장에서 멀어 보정 — 공항 부지 중심 좌표 등)';
    if ((mode === 'car' || mode === 'taxi') && c.taxi) title += ` · 택시 약 ${c.taxi.toLocaleString('en-US')}원`;
    return { mode, modeIcon: MODE_ICON[mode], label, title, cached: true, failed: false };
  }
  const failed = failedLeg(legCache, a, b, mode);
  return {
    mode, modeIcon: MODE_ICON[mode],
    label: `↳${haversine(a, b).toFixed(1)}km${failed ? ' ⚠️' : ''}`,
    title: failed
      ? '경로를 찾을 수 없어 직선거리로 표시 — 인근 도로 탐색(최대 2.4km)까지 실패했습니다. 장소 편집에서 위치를 다시 잡아 보세요'
      : '경로 미조회 — 직선거리',
    cached: false, failed
  };
}

// ── 타임라인 · 앵커 ──
export interface TimelineEntry { eta: number; fixed: boolean; conflict: boolean; natural: number; wait: number }

function startAnchorOf(trip: Trip, di: number): Spot | null {
  return dayStartAnchor(trip.days as unknown[], di) as Spot | null;
}

export function dayTimelineOf(trip: Trip, legCache: LegCache, di: number): TimelineEntry[] {
  const day = trip.days[di];
  return computeTimeline(day, {
    legMin: (a, b) => legMinutes(legCache, a as LatLng, b as LatLng, legModeOf(day, b as Spot)),
    startAnchor: startAnchorOf(trip, di)
  });
}

/** 숙소 복귀 자동 구간 — 합성 구간이라 '일자 기본 수단'을 근거리 보정(localMode)해 쓴다 */
export function backLegOf(day: Day, back: Spot | null): { from: LocatedSpot; to: LocatedSpot; mode: TransportMode } | null {
  const loc = day.spots.filter(hasCoord);
  if (!back || !hasCoord(back) || !loc.length) return null;
  return { from: loc[loc.length - 1], to: back, mode: localMode(dayModeOf(day)) as TransportMode };
}

/** 일정 예상 종료(분) — 마지막 장소의 (예약 대기 반영) 활동 시작 + 체류 + 숙소 복귀 이동 */
export function dayEndMinOf(trip: Trip, legCache: LegCache, di: number): number | null {
  const day = trip.days[di];
  if (!day.spots.length) return null;
  const tl = dayTimelineOf(trip, legCache, di);
  const last = day.spots.length - 1;
  const s = day.spots[last];
  const base = s.bookAt ? Math.max(tl[last].eta, parseHM(s.bookAt)) : tl[last].eta;
  const end = base + (s.stayMin != null ? +s.stayMin : 60);
  const bl = backLegOf(day, dayReturnStay(trip.days as unknown[], di) as Spot | null);
  return bl ? end + legMinutes(legCache, bl.from, bl.to, bl.mode) : end;
}

// ── 하루 동선 합계 ──
/** 모든 구간(숙소 복귀 포함)이 캐시됐을 때만 실도로 합계 — 부분 합계로 오해하지 않게 */
function dayRouteOf(legCache: LegCache, day: Day, back: Spot | null): { sec: number; m: number; taxi: number } | null {
  const loc = day.spots.filter(hasCoord);
  if (loc.length < 2) return null;
  let sec = 0, m = 0, taxi = 0;
  const add = (a: LatLng, b: LatLng, mode: TransportMode): boolean => {
    const c = cachedLeg(legCache, a, b, mode);
    if (!c || !c.sec) return false;
    sec += c.sec; m += c.m ?? 0; taxi += c.taxi ?? 0;
    return true;
  };
  for (let i = 1; i < loc.length; i++) if (!add(loc[i - 1], loc[i], legModeOf(day, loc[i]))) return null;
  const bl = backLegOf(day, back);
  if (bl && !add(bl.from, bl.to, bl.mode)) return null;
  return { sec, m, taxi };
}
/** 직선거리 합(km) — 실도로 합계가 안 될 때의 동선 감각용 */
function dayDistanceOf(day: Day, back: Spot | null): number {
  const loc = day.spots.filter(hasCoord);
  let sum = 0;
  for (let i = 1; i < loc.length; i++) sum += haversine(loc[i - 1], loc[i]);
  if (hasCoord(back) && loc.length) sum += haversine(loc[loc.length - 1], back);
  return sum;
}

// ── 비용 ──
function tripBookings(trip: Trip): Booking[] {
  return trip.bookings ?? [];
}
function daySpotCost(day: Day, fx: FxRates): number {
  return day.spots.reduce((a, s) => a + (s.cost ? toKRW(s.cost, s.cur, fx) : 0), 0);
}
function dayBookingCost(trip: Trip, iso: string, fx: FxRates): number {
  if (!iso) return 0;
  return bookingShareOn(tripBookings(trip), iso).reduce((a, x) => a + toKRW(x.amount, x.cur, fx), 0);
}
function dayCostPartsOf(
  trip: Trip, legCache: LegCache, di: number, fx: FxRates
): { total: number; parts: DayCostPart[] } {
  const day = trip.days[di];
  const dm = dayModeOf(day);
  const road = dm === 'car' || dm === 'taxi';
  const rt = road ? dayRouteOf(legCache, day, dayReturnStay(trip.days as unknown[], di) as Spot | null) : null;
  const parts = ([
    { label: '장소', amount: daySpotCost(day, fx) },
    { label: '택시', amount: rt?.taxi ?? 0 },
    { label: '예약', amount: dayBookingCost(trip, isoDateOf(trip, di), fx) }
  ] as DayCostPart[]).filter(p => p.amount > 0);
  return { total: parts.reduce((a, p) => a + p.amount, 0), parts };
}

/** 필터바 '전체 비용'과 같은 규칙 — 장소 + (자차·택시일) 택시 + 예약 전액 */
export function tripCostBreakdownOf(trip: Trip, legCache: LegCache, fx: FxRates = fxRates()): TripCostView {
  const out: TripCostView = { spots: 0, taxi: 0, hotel: 0, car: 0, flight: 0, total: 0 };
  trip.days.forEach((d, i) => {
    out.spots += daySpotCost(d, fx);
    const dm = dayModeOf(d);
    if (dm === 'car' || dm === 'taxi')
      out.taxi += dayRouteOf(legCache, d, dayReturnStay(trip.days as unknown[], i) as Spot | null)?.taxi ?? 0;
  });
  tripBookings(trip).forEach(b => {
    const k = b.type === 'car' || b.type === 'flight' ? b.type : 'hotel';
    out[k] += toKRW(+b.price || 0, b.cur, fx);
  });
  out.total = out.spots + out.taxi + out.hotel + out.car + out.flight;
  return out;
}

// ── 렌터카 표시 파생 ──
function carBookingOf(trip: Trip, id: string | undefined): CarBooking | null {
  if (!id) return null;
  const b = tripBookings(trip).find(x => x.id === id);
  return b && b.type === 'car' ? b : null;
}
function carEventPlaceLabel(e: { place: string; code: string; title: string }, fallback: string): string {
  if (e.place && e.code) return `${e.place} (${e.code})`;
  return e.place || e.code || e.title || fallback;
}
function carEventRowOf(e: ReturnType<typeof carEventsOn>[number]): CarEventRowView {
  const label = e.kind === 'pickup' ? '렌터카 픽업' : '렌터카 반납';
  const place = carEventPlaceLabel(e, label);
  const noPlace = !(e.place || e.code);
  return {
    kind: e.kind, bookingId: e.id, placeLabel: place,
    subLabel: [label, e.time, noPlace ? '장소 미입력' : ''].filter(Boolean).join(' · ') + ' · 예약',
    title: `${label}${e.time ? ` ${e.time}` : ''} · ${place}` +
      `${noPlace ? ' — 예약에 픽업·반납 장소를 넣으면 여기 표시됩니다' : ''}` +
      ' · 예약에 입력한 정보라 동선·도착 예상 계산에는 들어가지 않습니다'
  };
}

// ── 장소 행 ──
function spotCostView(s: Spot, fx: FxRates): SpotView['cost'] {
  if (!s.cost) return null;
  const sym = currencySymbol(s.cur);
  const nonKrw = !!sym && s.cur !== 'KRW';
  return {
    label: nonKrw ? `💳 ${sym}${fmtMoney(s.cost)}` : `💳 ₩${fmtMoney(s.cost)}`,
    converted: nonKrw ? `약 ₩${fmtMoney(toKRW(s.cost, s.cur, fx))}` : null,
    title: nonKrw ? costLabel(s.cost, s.cur, fx) : null
  };
}

function spotViewOf(
  trip: Trip, legCache: LegCache, day: Day, iso: string,
  s: Spot, si: number, tl: TimelineEntry[], incoming: LocatedSpot | null, fx: FxRates
): SpotView {
  const t = tl[si];
  const inMode = legModeOf(day, s);
  const located = hasCoord(s);
  const leg = located && incoming ? legViewOf(legCache, incoming, s, inMode) : null;

  // 기차·비행기는 거리 기반 '추정'이라 시간표대로 넣은 고정 도착에 충돌 경고를 띄우지 않는다
  const bySchedule = !!(incoming && (inMode === 'train' || inMode === 'flight'));
  const conflict = t.conflict && !bySchedule;
  const natTxt = t.natural >= 1440 ? `${Math.floor(t.natural / 1440)}일 뒤 ${hm(t.natural)}` : hm(t.natural);
  const etaTitle = t.fixed
    ? (t.conflict
        ? (bySchedule
            ? `📌 도착 고정 ${s.at} — ${MODE_NAME[inMode]} 시간표 기준. 앱 추정(${natTxt})보다 빠르지만 정상입니다`
            : `📌 도착 고정 ${s.at} — 이동시간상 ${natTxt}에야 도착합니다. 앞 일정을 줄이거나 이 시각을 늦추세요`)
        : '📌 도착 고정 — 직접 정한 시각. 자동 계산 대신 이 시각을 씁니다')
    : '도착 예상 — 시작 시각 + 이동시간 + 머무는 시간으로 자동 계산한 추정값';

  const cat = spotCatOf(s);
  let stayLabel: string | null = null;
  if (s.stay) {
    const nights = stayNights(s) > 1 ? `${stayNights(s)}박` : '';
    const label = cat?.id === 'stay' ? nights : `🏠 숙소${nights ? ` · ${nights}` : ''}`;
    stayLabel = label || null;
  }

  let book: SpotView['book'] = null;
  if (s.bookAt) {
    const bookMin = parseHM(s.bookAt);
    const warn = t.eta - bookMin > 5;
    book = {
      at: s.bookAt, warn, waitMin: Math.round(t.wait || 0),
      title: warn
        ? `예약·입장 ${s.bookAt} · 도착 예상 ${hm(t.eta)} — 약 ${Math.round(t.eta - bookMin)}분 늦어요. 앞 일정을 줄이거나 예약을 옮기세요`
        : `예약·입장 ${s.bookAt} (상대가 정한 약속) — 도착 예상 ${hm(t.eta)}`
    };
  }

  const carChips: CarChipView[] = [];
  ([['carPickupId', '렌터카 픽업', 'carPickupTime'], ['carReturnId', '렌터카 반납', 'carReturnTime']] as const)
    .forEach(([field, label, timeField]) => {
      const bk = carBookingOf(trip, s[field]);
      if (!bk) return;
      const time = bk[timeField] ? ` ${bk[timeField]}` : '';
      carChips.push({
        kind: field === 'carPickupId' ? 'pickup' : 'return', bookingId: bk.id,
        label: `🚗 ${label}${time}`, title: `${label}${time} · ${bk.title}`
      });
    });

  let hoursWarn: string | null = null;
  if (s.hours && iso) {
    const wd = new Date(iso + 'T00:00:00').getDay();
    if (isOpenAt(s.hours, wd, Math.round(t.eta)) === false)
      hoursWarn = `${'일월화수목금토'[wd]}요일 도착 예상 ${hm(t.eta)}에 영업 종료/휴무 — 시간을 확인하세요`;
  }

  return {
    si, order: si + 1, name: s.name, city: s.city, desc: s.desc,
    catIcon: cat?.icon ?? null, catName: cat?.name ?? null,
    etaText: hm(t.eta), fixed: t.fixed, conflict, etaTitle,
    stayLabel, optional: !!s.opt, noLoc: !located,
    cost: spotCostView(s, fx), book, bookUrl: s.bookUrl ?? null, carChips, hoursWarn, leg
  };
}

// ── 일자 뷰 ──
export function buildDayView(trip: Trip, legCache: LegCache, di: number, fx: FxRates = fxRates()): DayView {
  const day = trip.days[di];
  const days = trip.days as unknown[];
  const iso = isoDateOf(trip, di);
  const anchor = startAnchorOf(trip, di);
  const carry = anchor && anchor.stay ? anchor : null;          // 🏠 표시는 숙소일 때만 — ETA는 anchor
  const tl = dayTimelineOf(trip, legCache, di);
  const dm = dayModeOf(day);
  const back = dayReturnStay(days, di) as Spot | null;
  const bl = backLegOf(day, back);

  // 렌터카: 장소와 연결된 건 그 행의 칩으로, 나머지만 날짜 파생 독립 행으로
  const links = carSpotLinks(days);
  const carEv = iso ? carEventsOn(tripBookings(trip), iso).filter(e => !links[e.kind][e.id]) : [];

  let incoming: LocatedSpot | null = hasCoord(anchor) ? anchor : null;
  const spots = day.spots.map((s, si) => {
    const v = spotViewOf(trip, legCache, day, iso, s, si, tl, incoming, fx);
    if (hasCoord(s)) incoming = s;
    return v;
  });

  // 일자 간 자동 이동 안내 — 숙소 이월이면 🏠 항목이 대신하고, 아니면 텍스트 한 줄
  let interDayLabel: string | null = null;
  const first = day.spots.find(hasCoord);
  if (!carry && hasCoord(anchor) && first) {
    const im = legModeOf(day, first);
    const c = cachedLeg(legCache, anchor, first, im);
    interDayLabel = c && c.sec
      ? `이전 일정에서 ${((c.m ?? 0) / 1000).toFixed(1)}km · ${fmtDur(c.sec)}`
      : `이전 일정에서 직선 ${haversine(anchor, first).toFixed(1)}km`;
  }

  const rt = dayRouteOf(legCache, day, back);
  const straightKm = dayDistanceOf(day, back);
  const routeLabel = rt
    ? `📏 하루 동선 약 ${(rt.m / 1000).toFixed(1)}km · ${MODE_ICON[dm]}${fmtDur(rt.sec)}` +
      `${(dm === 'car' || dm === 'taxi') && rt.taxi ? ` · 🚕약 ${rt.taxi.toLocaleString('en-US')}원` : ''}` +
      ` (${dm === 'flight' ? '직선' : '도로 기준'})`
    : straightKm > 0 ? `📏 하루 동선 약 ${straightKm.toFixed(1)}km (직선)` : null;

  const end = dayEndMinOf(trip, legCache, di);
  const overloadLabel = end != null && end > 22 * 60
    ? `⚠️ 일정 과밀 — 예상 종료 ${hm(end)}${end >= 24 * 60 ? ' (익일)' : ''}`
    : null;

  const f = day.flight;
  const dep = f ? [f.dep, f.depAt].filter(Boolean).join(' ') : '';
  const arr = f ? [f.arr, f.arrAt].filter(Boolean).join(' ') : '';
  const route = [dep, arr].filter(Boolean).join(' → ');
  const flightBits = f ? [f.code, route].filter(Boolean) : [];

  return {
    di, dayNo: di + 1, title: day.title, iso, dateLabel: dateLabelOf(trip, di),
    timeZone: day.timeZone || trip.timeZone || '', mode: dm, modeIcon: MODE_ICON[dm], modeName: MODE_NAME[dm],
    drive: day.drive, note: day.note,
    flightLabel: flightBits.length ? `✈️ ${flightBits.join(' · ')}` : null,
    carry: carry ? { name: carry.name, startAt: hm(parseHM(day.startAt)) } : null,
    interDayLabel,
    carPickups: carEv.filter(e => e.kind === 'pickup').map(carEventRowOf),
    spots,
    carReturns: carEv.filter(e => e.kind === 'return').map(carEventRowOf),
    back: bl ? { name: bl.to.name, modeIcon: MODE_ICON[bl.mode], leg: legViewOf(legCache, bl.from, bl.to, bl.mode) } : null,
    routeLabel, overloadLabel,
    cost: dayCostPartsOf(trip, legCache, di, fx)
  };
}
