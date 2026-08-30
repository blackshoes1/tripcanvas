'use client';
// 상태 배지 — 레거시 bookingBadgeHtml과 같은 판정·문구.
// 🔴 확정 절약 > 🟠 미검증 저가 > 🟢 유지 권장 > 🟡 추적 중 / 🔌 소스 미연결 / ⚠️ 실패
import { getTrackingState, offerPrice } from '@/features/pricing/domain/engine';
import type { PriceRecord } from '@/features/pricing/domain/types';
import { costLabel, fmtMoney, krwRateOf, toKRW } from '@/lib/currency/format';
import { todayISO } from '@/lib/date/today';
import type { Booking } from '../domain/types';

export function BookingBadge({ booking, rec }: { booking: Booking; rec: PriceRecord | null }) {
  if (booking.type === 'flight') {
    return booking.track
      ? <span className="pxBadge pxWatch" title="항공 가격 소스는 준비 중 — 지금은 예약 기록용">🟡 추적 예정</span>
      : <span className="pxBadge pxOff">추적 꺼짐</span>;
  }
  const st = getTrackingState(booking, rec, { today: todayISO(), krwRate: krwRateOf(booking.cur) });
  if (st?.state === 'SAVING_AVAILABLE' && st.confirmed) {
    const o = st.confirmed.offer;
    const vf = o.verified ? '✓ 동일 조건 · 판매처 확인됨' : '조건상 동일해 보임 · 판매처 검증 필요';
    return (
      <span className="pxBadge pxSave" title={`${o.seller} ${costLabel(offerPrice(o), booking.cur)} · ${vf}${st.fee ? ' · 취소 수수료 반영' : ''}`}>
        🔴 ₩{fmtMoney(toKRW(st.confirmed.saving, booking.cur))} 절약 가능
      </span>
    );
  }
  if (st?.state === 'CHEAPER_UNVERIFIED' && st.potential) {
    const o = st.potential.offer;
    return (
      <span className="pxBadge pxWarn" title={`${o.seller}에서 최대 ${costLabel(st.potential.delta, booking.cur)} 저렴 — 조건이 다르거나 확인되지 않았어요`}>
        🟠 더 저렴한 옵션 발견
      </span>
    );
  }
  if (st?.state === 'GOOD_PRICE') return <span className="pxBadge pxGood" title="현재가가 관측 최저 수준 — 지금 예약 유지 권장">🟢 좋은 가격</span>;
  if (st?.state === 'ERROR' && st.err?.code === 'AUTH_REQUIRED')
    return <span className="pxBadge pxWatch" title="자동 가격 소스가 아직 연결되지 않았어요 — 직접 가격 확인은 가능합니다">🔌 자동 소스 미연결</span>;
  if (st?.state === 'ERROR') return <span className="pxBadge pxWarn" title="가격 확인 실패">⚠️ 확인 실패</span>;
  if (booking.track) return <span className="pxBadge pxWatch" title="시세를 계속 확인 중 — 아직 의미 있는 하락이 없어요">🟡 가격 추적 중</span>;
  return <span className="pxBadge pxOff">추적 꺼짐</span>;
}
