// 예약 목록 — iOS는 읽기 중심이다(§45). 여행 당일 필요한 것만 빠르게: 시간·장소·상태·번호·링크.
//
// 가격 판정도 웹과 같은 엔진(price.js)을 그대로 쓴다. 서버가 가진 관측은 hotel_price_snapshots
// (사용자 본인 행, RLS)뿐이라 기기 로컬 기록과 합쳐진 웹의 상태보다 관측 수가 적을 수 있다 —
// 그래서 관측 시각(observedAt)을 함께 보내 클라이언트가 '언제 확인한 값인지'를 그대로 말하게 한다.
import price from '@legacy/price.js';

import type { BookingSummary, PriceState, PriceStatus } from './contract';
import type { TripDoc } from './todayView';

export interface PriceObservation {
  booking_id: string;
  seller: string | null;
  price: number | null;
  currency: string | null;
  quality: string | null;
  verified: boolean;
  offers: unknown[] | null;
  observed_at: string;
}

/** 환율은 서버에 없다 — 웹이 네트워크 실패 시 쓰는 것과 **같은 근사값**을 쓴다(판정이 갈라지지 않게). */
const KRW_RATE: Record<string, number> = { KRW: 1, USD: 1380, EUR: 1500, JPY: 9.1, CNY: 192 };

interface TrackState {
  state: string;
  confirmed: { offer: { seller?: string }; saving: number } | null;
  potential: { offer: { seller?: string }; delta: number } | null;
  fee: number;
  at: string | null;
  err: unknown;
}

const NOTE: Record<PriceState, string> = {
  SAVING_AVAILABLE: '같은 조건이 더 싼 곳이 있어요.',
  CHEAPER_UNVERIFIED: '더 싼 곳이 보이지만 조건이 같은지 확인이 필요해요.',
  GOOD_PRICE: '지금까지 본 값 중 좋은 편이에요 — 유지해도 괜찮습니다.',
  WATCHING: '가격을 계속 보고 있어요.',
  ERROR: '가격을 확인하지 못했어요.',
  UNTRACKED: '가격 추적을 꺼 두었어요.'
};

function statusOf(booking: Record<string, unknown>, obs: PriceObservation[], today: string): PriceStatus | null {
  if (booking.track === false) {
    return { state: 'UNTRACKED', currentPrice: null, savingAmount: null, currency: String(booking.cur ?? 'KRW'), seller: null, observedAt: null, note: NOTE.UNTRACKED };
  }
  if (!obs.length) return null;   // 첫 확인 전 — 가짜 상태를 만들지 않는다
  const ordered = [...obs].sort((a, b) => a.observed_at.localeCompare(b.observed_at));
  const latest = ordered[ordered.length - 1];
  const rec = {
    obs: ordered.map((o) => ({ price: Number(o.price ?? 0), at: o.observed_at, cur: o.currency ?? undefined, seller: o.seller ?? undefined, quality: o.quality ?? undefined, verified: o.verified })),
    offers: (latest.offers ?? []) as unknown[],
    at: latest.observed_at,
    err: null
  };
  const cur = String(booking.cur ?? 'KRW');
  const track = price.hotelTrackState(booking, rec, { today, krwRate: KRW_RATE[cur] ?? 1 }) as TrackState | null;
  if (!track) return null;
  const state = (['SAVING_AVAILABLE', 'CHEAPER_UNVERIFIED', 'GOOD_PRICE', 'WATCHING', 'ERROR'].includes(track.state)
    ? track.state : 'WATCHING') as PriceState;
  const saving = track.confirmed ? track.confirmed.saving : (track.potential ? track.potential.delta : null);
  const seller = track.confirmed?.offer?.seller ?? track.potential?.offer?.seller ?? latest.seller ?? null;
  return {
    state,
    currentPrice: Number(latest.price ?? 0) || null,
    savingAmount: saving == null ? null : Math.round(saving),
    currency: cur,
    seller: seller ? String(seller) : null,
    observedAt: track.at,
    note: NOTE[state]
  };
}

const TYPES = new Set(['hotel', 'car', 'flight']);

/** 예약 문서 + 가격 관측 → iOS가 그대로 그릴 수 있는 목록. 시작 시각 순. */
export function buildBookings(trip: TripDoc, observations: PriceObservation[], today: string): BookingSummary[] {
  const byBooking = new Map<string, PriceObservation[]>();
  observations.forEach((o) => {
    const list = byBooking.get(o.booking_id) ?? [];
    list.push(o);
    byBooking.set(o.booking_id, list);
  });
  const raw = (trip.bookings ?? []) as Record<string, unknown>[];
  return raw
    .filter((b) => b && typeof b === 'object' && typeof b.id === 'string')
    .map((b) => {
      const type = TYPES.has(String(b.type)) ? String(b.type) as BookingSummary['type'] : 'hotel';
      // 예약번호는 아직 웹 편집 UI가 없다 — 있으면 그대로 보여주고, 없으면 null(빈 칸을 지어내지 않는다).
      const confirmation = [b.confirmation, b.confirmationNumber, b.code].find((v) => typeof v === 'string' && v) as string | undefined;
      return {
        id: String(b.id),
        type,
        title: String(b.title ?? '예약'),
        provider: String(b.provider ?? ''),
        url: typeof b.url === 'string' ? b.url : null,
        price: Number(b.price ?? 0),
        currency: String(b.cur ?? 'KRW'),
        start: typeof b.start === 'string' ? b.start : null,
        end: typeof b.end === 'string' ? b.end : null,
        refundable: typeof b.refundable === 'boolean' ? b.refundable : null,
        freeCancelUntil: typeof b.freeCancelUntil === 'string' ? b.freeCancelUntil : null,
        confirmation: confirmation ?? null,
        place: [b.carPickup, b.roomName].find((v) => typeof v === 'string' && v) as string ?? null,
        startTime: typeof b.carPickupTime === 'string' ? b.carPickupTime : null,
        endTime: typeof b.carReturnTime === 'string' ? b.carReturnTime : null,
        priceStatus: statusOf(b, byBooking.get(String(b.id)) ?? [], today)
      };
    })
    .sort((a, b) => (a.start ?? '9999').localeCompare(b.start ?? '9999') || a.title.localeCompare(b.title));
}
