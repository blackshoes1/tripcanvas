// 여행 모드 도메인 — 순수(§9). '지금 여행 중'인 화면: 현재 장소·다음 장소·오늘의 남은 일정.
// 값은 전부 buildDayView가 만든 화면 뷰에서 뽑는다 — ETA·구간·숙소 복귀 기준이
// 사이드바·이미지·재생과 어긋나면, 정작 현장에서 보는 화면만 틀린 시각을 말하게 된다.
import legacyLib from '@legacy/lib.js';

import type { DayView, SpotView } from '@/features/itinerary/domain/types';
import type { Spot, Trip } from '@/features/trip/domain/types';

const { parseHM, extMapLink } = legacyLib;

export interface MapLink {
  href: string;
  label: string;
}

export interface TravelStop {
  si: number;
  name: string;
  catIcon: string | null;
  eta: string;
  desc: string;
  facts: string[];
  /** 좌표가 있을 때만 — 없으면 길찾기를 걸 수 없다 */
  mapLink: MapLink | null;
  bookUrl: string | null;
  /** 이 장소로 오는 구간 안내 ("🚗 25분 · 12.4km") */
  leg: string | null;
}

export interface TravelView {
  di: number;
  title: string;
  subtitle: string;
  /** 오늘이면 시각으로 현재 위치를 짚고, 아니면 그 날의 시작 장소 */
  isToday: boolean;
  current: TravelStop | null;
  /** 다음 장소 — 숙소 복귀이거나, 오늘 일정이 끝났으면 null */
  next: { name: string; eta: string; note: string; isBackToStay: boolean } | null;
  /** 전날 숙소 이월 (표시 전용) */
  carry: { name: string; startAt: string; mapLink: MapLink | null } | null;
  stops: TravelStop[];
  empty: boolean;
}

/** 좌표가 있을 때만 외부 지도 링크 (찾는 기준은 이름 — 좌표는 어느 지도를 열지만 정한다) */
function linkOf(s: { name: string; city?: string; lat: number | null; lng: number | null }): MapLink | null {
  const { lat, lng } = s;
  if (lat == null || lng == null || !isFinite(lat) || !isFinite(lng)) return null;
  return extMapLink({ name: s.name, city: s.city, lat, lng });
}

/**
 * 지금 어디쯤인가 — 도착 예상 시각이 지금보다 이르거나 같은 **마지막** 장소.
 * 오늘이 아니면 그 날의 첫 장소를 짚는다(내일 일정을 미리 볼 때 마지막 장소를 짚으면 이상하다).
 */
export function currentIndexAt(etaMinutes: number[], nowMin: number, isToday: boolean): number {
  if (!isToday) return 0;
  let at = 0;
  for (let i = 0; i < etaMinutes.length; i++) if (etaMinutes[i] <= nowMin) at = i;
  return at;
}

function stopOf(v: SpotView, day: { spots: Spot[] }): TravelStop {
  const s = day.spots[v.si];
  const facts = [
    `${v.etaText} 도착 예상`,
    v.book ? `예약 ${v.book.at}` : '예약 없음',
    s?.stayMin != null ? `체류 ${s.stayMin}분` : null
  ].filter((x): x is string => !!x);
  return {
    si: v.si, name: v.name, catIcon: v.catIcon, eta: v.etaText, desc: v.desc,
    facts, mapLink: s ? linkOf(s) : null, bookUrl: v.bookUrl,
    leg: v.leg ? `${v.leg.modeIcon} ${v.leg.label}` : null
  };
}

/** 그 날의 여행 모드 화면 — nowMin은 그 날 기준 분(0–1439) */
export function buildTravelView(
  trip: Trip, view: DayView, nowMin: number, todayISO: string
): TravelView {
  const day = trip.days[view.di];
  const isToday = !!view.iso && view.iso === todayISO;
  const subtitle = [view.dateLabel, view.drive, view.note].filter(Boolean).join('  ·  ');

  if (!view.spots.length) {
    return {
      di: view.di, title: `Day ${view.dayNo}${view.title ? ` · ${view.title}` : ''}`,
      subtitle, isToday, current: null, next: null, carry: null, stops: [], empty: true
    };
  }

  const stops = view.spots.map(v => stopOf(v, day));
  const etas = view.spots.map(v => parseHM(v.etaText));
  const at = currentIndexAt(etas, nowMin, isToday);

  const after = view.spots[at + 1];
  const next = after
    ? {
      name: after.name, eta: after.etaText,
      note: after.leg ? `${after.leg.modeIcon} ${after.leg.label}` : '이동 정보 계산 중',
      isBackToStay: false
    }
    : view.back
      ? {
        name: view.back.name, eta: '',
        note: `숙소 복귀 · ${view.back.leg.modeIcon} ${view.back.leg.label}`, isBackToStay: true
      }
      : null;

  return {
    di: view.di, title: `Day ${view.dayNo}${view.title ? ` · ${view.title}` : ''}`,
    subtitle, isToday,
    current: stops[at] ?? null,
    next,
    carry: view.carry
      ? { name: view.carry.name, startAt: view.carry.startAt, mapLink: null }
      : null,
    stops,
    empty: false
  };
}

/** 오늘이 여행의 며칠째인가 — 여행 밖이면 가장 가까운 끝으로 (레거시 travelBtn과 같은 규칙) */
export function todayDayIndex(trip: Trip, todayISO: string): number {
  if (!trip.start) return 0;
  const diff = Math.floor(
    (new Date(todayISO + 'T00:00:00').getTime() - new Date(trip.start + 'T00:00:00').getTime()) / 86400000
  );
  return Math.min(Math.max(diff, 0), trip.days.length - 1);
}
