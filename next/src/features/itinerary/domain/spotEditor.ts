// 장소 편집 도메인 — 순수(§9). 판단 규칙은 레거시 openSpotModal/spotSave/moveSpot/deleteSpot과
// 동일하게 유지하고(동작 변경 금지 — §28), 저장은 hooks/services가 맡는다.
//
// 좌표·검색은 이 단계에서 다루지 않는다: 편집은 이미 있는 장소의 값을 고치는 일이라
// 원본의 lat/lng를 그대로 물려준다. 위치 없는 장소(lat:null)를 (0,0)으로 둔갑시키지 않기 위해서도
// 좌표는 폼을 거치지 않는다.
import legacyLib from '@legacy/lib.js';

import type { PlaceResult } from '@/features/search/domain/types';
import type { CurrencyCode, Day, Spot, SpotCategory, TransportMode, Trip } from '@/features/trip/domain/types';

/** 편집 폼 상태 — 입력 중에는 사람이 친 문자열 그대로 들고 있다가 저장할 때 정규화한다 */
export interface SpotForm {
  name: string;
  city: string;
  desc: string;
  cat: SpotCategory | '';
  /** 도착 고정 시각 — 사람이 친 그대로("930"도 받는다) */
  at: string;
  stayMin: string;
  /** 쉼표 포함 가능 */
  cost: string;
  cur: CurrencyCode;
  legMode: TransportMode | '';
  bookAt: string;
  bookUrl: string;
  opt: boolean;
  stay: boolean;
  nights: string;
  /** 옮길 일자 index (그대로면 제자리 편집) */
  targetDi: number;
}

export type SpotFormError = 'NAME_REQUIRED' | 'LOCATION_REQUIRED';

/** 예약 편집기 소관이라 이 폼이 만들지도 지우지도 않는 연결 — 편집 시 원본에서 그대로 물려준다 */
const LINK_KEYS = ['bookingId', 'carPickupId', 'carReturnId'] as const;

/** 장소 → 폼. 레거시 openSpotModal의 프리필과 같은 기본값(체류 60분·1박·KRW) */
export function formFromSpot(spot: Spot, di: number): SpotForm {
  return {
    name: spot.name ?? '',
    city: spot.city ?? '',
    desc: spot.desc ?? '',
    cat: spot.cat ?? '',
    at: spot.at ?? '',
    stayMin: String(spot.stayMin != null ? spot.stayMin : 60),
    cost: spot.cost != null ? String(spot.cost) : '',
    cur: spot.cur ?? 'KRW',
    legMode: spot.legMode ?? '',
    bookAt: spot.bookAt ?? '',
    bookUrl: spot.bookUrl ?? '',
    opt: !!spot.opt,
    stay: !!spot.stay,
    nights: String(legacyLib.stayNights(spot)),
    targetDi: di
  };
}

/**
 * 폼 → 장소. 좌표·placeId·영업시간·예약 연결은 원본에서 물려받는다 —
 * 새 객체로 갈아끼우며 떨어뜨리면 메모만 고쳐도 렌터카 픽업이 연결에서 풀린다.
 * 기본값(KRW·1박)은 저장에서 생략해 공유 링크를 줄인다(레거시 하위호환).
 */
export function spotFromForm(
  form: SpotForm,
  original: Spot,
  opts: { requireLocation?: boolean } = {}
): { ok: true; spot: Spot } | { ok: false; error: SpotFormError } {
  const name = form.name.trim();
  if (!name) return { ok: false, error: 'NAME_REQUIRED' };
  // 새 장소는 좌표가 있어야 한다(레거시와 동일) — 동선·ETA·지도에 들어갈 자리를 만드는 일이라서.
  // 반대로 이미 있는 장소는 좌표 없이도 고칠 수 있게 둔다: 이름·메모만 고치려는데 검색을 강요하지 않는다.
  if (opts.requireLocation && (original.lat == null || original.lng == null))
    return { ok: false, error: 'LOCATION_REQUIRED' };

  const nights = legacyLib.stayNights({ nights: form.nights });
  const costDigits = form.cost.replace(/[^\d]/g, '');

  const spot: Spot = {
    name,
    city: form.city.trim() || '기타',
    desc: form.desc.trim(),
    opt: form.opt,
    stay: form.stay,
    stayMin: Math.max(0, parseInt(form.stayMin, 10) || 60),
    bookAt: legacyLib.normHM(form.bookAt) || '',
    bookUrl: form.bookUrl.trim(),
    lat: original.lat,
    lng: original.lng
  };
  // 값이 없거나 기본값이면 키 자체를 넣지 않는다 — 공유 링크를 줄이고,
  // normalizeTrip은 '비용 키 없음'과 '비용 null'을 똑같이 비용 없음으로 본다.
  if (costDigits) spot.cost = Math.max(0, parseInt(costDigits, 10));
  if (form.stay && nights > 1) spot.nights = nights;
  const at = legacyLib.normHM(form.at);
  if (at) spot.at = at;
  if (form.legMode) spot.legMode = form.legMode;
  if (form.cur && form.cur !== 'KRW') spot.cur = form.cur;
  if (form.cat) spot.cat = form.cat;
  if (original.placeId) spot.placeId = original.placeId;
  if (original.kakaoId) spot.kakaoId = original.kakaoId;
  if (original.hours) spot.hours = original.hours;
  for (const k of LINK_KEYS) if (original[k]) spot[k] = original[k];

  return { ok: true, spot };
}

/** 고정 시각이 있는 날이면 시간순 재정렬 — 레거시와 같은 조건·같은 함수(lib.sortDayByTime) */
function resortIfTimed(day: Day): { day: Day; sorted: boolean } {
  if (!day.spots.some(s => s.at)) return { day, sorted: false };
  const draft: Day = { ...day, spots: [...day.spots] };
  const sorted = legacyLib.sortDayByTime(draft);
  return { day: draft, sorted };
}

/**
 * 편집 저장 — 불변 갱신. 같은 날이면 제자리 교체(맨 뒤로 밀지 않음),
 * 일자를 바꿨으면 원래 날에서 빼고 대상 날 맨 뒤에 붙인다(레거시 spotSave와 동일).
 * 그 뒤 대상 날에 고정 시각이 있으면 시간순 정렬.
 */
export function applySpotEdit(
  trip: Trip,
  from: { di: number; si: number },
  spot: Spot,
  targetDi: number
): { trip: Trip; sorted: boolean } {
  if (!trip.days[from.di]?.spots[from.si] || !trip.days[targetDi]) return { trip, sorted: false };

  const days = trip.days.map((d, i) => {
    if (i === from.di && i === targetDi) return { ...d, spots: d.spots.map((s, k) => (k === from.si ? spot : s)) };
    if (i === from.di) return { ...d, spots: d.spots.filter((_, k) => k !== from.si) };
    if (i === targetDi) return { ...d, spots: [...d.spots, spot] };
    return d;
  });
  const { day, sorted } = resortIfTimed(days[targetDi]);
  days[targetDi] = day;
  return { trip: { ...trip, days }, sorted };
}

/**
 * 새 장소를 넣을 자리 — 레거시 spotSave의 삽입 규칙 그대로.
 * 모달을 **열 때** 선택돼 있던 장소 바로 뒤. 저장하며 일자를 바꿨거나 선택이 없었으면 맨 뒤.
 * @param openedDi 모달을 연 일자 · targetDi 저장할 일자 · after 열 때 선택돼 있던 인덱스
 */
export function insertIndexOf(
  spots: Spot[],
  { openedDi, targetDi, after }: { openedDi: number; targetDi: number; after: number | null }
): number {
  if (after == null || targetDi !== openedDi) return spots.length;
  return Math.min(after + 1, spots.length);
}

/**
 * 새 장소 추가 — 불변 갱신. 넣은 뒤 그 날에 고정 시각이 있으면 시간순 정렬한다.
 * 넣은 장소의 최종 인덱스를 함께 돌려준다 — 호출측이 그걸 선택해 두면
 * 연달아 추가할 때 계속 그 뒤로 붙는다 (레거시와 같은 흐름).
 */
export function applySpotAdd(
  trip: Trip,
  spot: Spot,
  at: { openedDi: number; targetDi: number; after: number | null }
): { trip: Trip; sorted: boolean; si: number } {
  if (!trip.days[at.targetDi]) return { trip, sorted: false, si: -1 };

  const target = trip.days[at.targetDi];
  const idx = insertIndexOf(target.spots, at);
  const spots = [...target.spots];
  spots.splice(idx, 0, spot);

  const days = trip.days.map((d, i) => (i === at.targetDi ? { ...d, spots } : d));
  const { day, sorted } = resortIfTimed(days[at.targetDi]);
  days[at.targetDi] = day;
  return { trip: { ...trip, days }, sorted, si: day.spots.indexOf(spot) };
}

/** 검색 결과가 없는 상태의 새 장소 초안 — 도시는 그 날 첫 장소를 따라간다 (레거시 프리필) */
export function newSpotDraft(day: Day | undefined): Spot {
  return { name: '', city: day?.spots[0]?.city ?? '', desc: '', lat: null, lng: null };
}

/**
 * 검색 결과를 고른 결과를 폼과 초안에 반영한다 (레거시 검색 결과 클릭 핸들러와 동일).
 * 결과 선택은 명시적 조작이라 이름·도시를 덮어쓴다. 좌표·placeId·영업시간은 폼이 아니라
 * 초안(원본)에 담긴다 — spotFromForm이 폼 밖의 값을 원본에서 물려받기 때문.
 * 결과가 도시를 모르면 기존 도시를 지우지 않는다(빈 값으로 덮어쓰면 '기타'로 떨어진다).
 */
export function applyPlaceToForm(
  form: SpotForm,
  draft: Spot,
  place: PlaceResult
): { form: SpotForm; draft: Spot } {
  const next: Spot = { ...draft, lat: place.lat, lng: place.lng };
  if (place.placeId) next.placeId = place.placeId; else delete next.placeId;
  if (place.kakaoId) next.kakaoId = place.kakaoId; else delete next.kakaoId;
  if (place.hours) next.hours = place.hours; else delete next.hours;
  return {
    form: {
      ...form,
      name: place.name || form.name,
      city: place.city || form.city,
      cat: place.cat ?? form.cat
    },
    draft: next
  };
}

/** 장소 삭제 — 불변 갱신 (레거시 deleteSpot) */
export function removeSpot(trip: Trip, di: number, si: number): Trip {
  if (!trip.days[di]?.spots[si]) return trip;
  return { ...trip, days: trip.days.map((d, i) => (i === di ? { ...d, spots: d.spots.filter((_, k) => k !== si) } : d)) };
}

/**
 * 드래그 드롭 — 장소를 (일자, 위치)로 옮긴다. 레거시 onSpotDrop과 같다:
 * 원래 자리에서 빼고 대상 자리에 끼운 뒤, 그 날에 고정 시각이 있으면 시간순으로 재정렬한다.
 * (버튼 이동과 달리 정렬을 하는 이유: 드래그는 '여기 놓고 싶다'는 뜻이지만 고정 시각은
 *  '이 시각에 간다'는 더 강한 선언이라, 레거시가 시각을 우선하기로 정해 뒀다.)
 * 옮길 것이 없거나 제자리면 null — 호출측이 '아무 일도 없었음'으로 다룬다.
 */
export function moveSpotTo(
  trip: Trip,
  from: { di: number; si: number },
  to: { di: number; index: number }
): { trip: Trip; sorted: boolean; si: number } | null {
  const src = trip.days[from.di]?.spots[from.si];
  if (!src || !trip.days[to.di]) return null;
  if (from.di === to.di && from.si === to.index) return null;

  const days = trip.days.map(d => ({ ...d, spots: [...d.spots] }));
  days[from.di].spots.splice(from.si, 1);
  days[to.di].spots.splice(Math.max(0, Math.min(to.index, days[to.di].spots.length)), 0, src);

  const { day, sorted } = resortIfTimed(days[to.di]);
  days[to.di] = day;
  return { trip: { ...trip, days }, sorted, si: day.spots.indexOf(src) };
}

/**
 * 일자 순서 변경 (레거시 onDayDrop). 인덱스 기반이라 날짜는 자동으로 따라붙는다 —
 * days 배열의 자리가 곧 Day N이고, 날짜는 trip.start + 인덱스로 계산되기 때문.
 */
export function moveDay(trip: Trip, from: number, to: number): Trip | null {
  if (!trip.days[from] || to < 0 || to >= trip.days.length || from === to) return null;
  const days = [...trip.days];
  const [moved] = days.splice(from, 1);
  days.splice(to, 0, moved);
  return { ...trip, days };
}

/**
 * 순서 변경 — 이웃과 자리를 맞바꾼다(레거시 moveSpot). 시간순 재정렬은 하지 않는다:
 * 손으로 옮긴 순서를 저장 직후 되돌려버리면 조작이 먹히지 않는 것처럼 보인다.
 * 범위를 벗어나면 null (호출측이 '움직일 곳 없음'으로 다룬다).
 */
export function moveSpot(trip: Trip, di: number, si: number, delta: number): Trip | null {
  const spots = trip.days[di]?.spots;
  const ni = si + delta;
  if (!spots || !spots[si] || ni < 0 || ni >= spots.length) return null;
  const next = [...spots];
  [next[si], next[ni]] = [next[ni], next[si]];
  return { ...trip, days: trip.days.map((d, i) => (i === di ? { ...d, spots: next } : d)) };
}
