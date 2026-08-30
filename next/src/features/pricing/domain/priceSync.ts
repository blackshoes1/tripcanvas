// 가격 관측 공유 판정 — 순수(§9). 레거시 pullPriceSnapshots의 병합 규칙과 같다.
//
// 관측은 서버 cron과 여러 기기가 각각 남긴다. 그대로 합치면 같은 날 기록이 여러 번 쌓여
// '하루 한 점' 전제가 깨지고 절약 판단이 흔들린다 → **날짜당 하나만** 받아들인다.
import type { PriceObservation, PriceRecord } from './types';

/** 클라우드에 쌓인 관측 한 줄 (hotel_price_snapshots) */
export interface PriceSnapshotRow {
  booking_id: string;
  seller: string | null;
  price: number | string | null;
  currency: string | null;
  quality: string | null;
  verified: boolean | null;
  offers: unknown;
  observed_at: string;
}

const dayOf = (at: string | null | undefined): string => String(at ?? '').slice(0, 10);

/**
 * 클라우드 관측을 로컬 기록에 합친다 — 바꾼 게 없으면 원본을 그대로 돌려준다(불변).
 *
 * · 같은 날 관측이 이미 있으면 넣지 않는다 (하루 한 점)
 * · 오퍼 목록은 **더 최근 관측일 때만** 갈아끼운다 — 오래된 조회 결과가 최신을 덮으면
 *   화면이 이미 지난 가격을 지금 값처럼 보여준다
 */
export function mergePriceSnapshots(
  rec: PriceRecord, rows: PriceSnapshotRow[]
): { rec: PriceRecord; changed: boolean } {
  const obs: PriceObservation[] = [...(rec.obs ?? [])];
  let offers = rec.offers;
  let at = rec.at;
  let err = rec.err;
  let changed = false;

  for (const r of rows ?? []) {
    if (!r || !r.observed_at) continue;
    const day = dayOf(r.observed_at);
    if (!obs.some(o => dayOf(o.at) === day)) {
      obs.push({
        price: +(r.price ?? 0) || 0,
        cur: r.currency || 'KRW',
        seller: r.seller || '',
        quality: r.quality || 'SIMILAR',
        verified: !!r.verified,
        at: r.observed_at
      } as PriceObservation);
      changed = true;
    }
    if (Array.isArray(r.offers) && r.offers.length && (!at || String(r.observed_at) > String(at))) {
      offers = r.offers.slice(0, 12) as PriceRecord['offers'];
      at = r.observed_at;
      err = null;          // 최신 조회가 성공했으니 지난 오류는 지운다
      changed = true;
    }
  }
  if (!changed) return { rec, changed: false };
  obs.sort((a, b) => String(a.at ?? '').localeCompare(String(b.at ?? '')));
  return { rec: { ...rec, obs, offers, at, err }, changed: true };
}

/** 클라우드에서 받아올 대상 — 숙박 예약만 (가격 추적이 붙는 종류) */
export function trackedHotelIds(trips: { bookings?: { id: string; type: string }[] }[]): string[] {
  const out: string[] = [];
  for (const t of trips ?? []) {
    for (const b of t.bookings ?? []) if (b?.type === 'hotel' && b.id) out.push(b.id);
  }
  return out;
}
