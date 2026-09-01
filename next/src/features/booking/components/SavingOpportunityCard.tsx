'use client';
// 여행 단위 절감 요약 — 확정·잠재(조건 확인 필요)·실제 절약을 절대 섞지 않는다 (§31)
import { tripSavingSummary } from '@/features/pricing/domain/engine';
import type { PriceStore } from '@/features/pricing/services/localPriceStore';
import { fmtMoney, krwRateOf } from '@/lib/currency/format';
import { todayISO } from '@/lib/date/today';
import type { Booking } from '../domain/types';

export function SavingOpportunityCard({ bookings, prices }: { bookings: Booking[]; prices: PriceStore }) {
  if (!bookings.length) return null;
  const s = tripSavingSummary(bookings, prices, { today: todayISO(), krwRateOf });
  return (
    <div className="pxSummary">
      <div><span>현재 예약 총액</span><b>₩{fmtMoney(s.booked)}</b></div>
      <div className="pxSaveRow"><span>현재 확정 절약 가능</span><b>{s.confirmed > 0 ? `₩${fmtMoney(s.confirmed)}` : '—'}</b></div>
      {s.potential > 0 && <div className="pxPotRow"><span>조건 확인 필요</span><b>최대 ₩{fmtMoney(s.potential)}</b></div>}
      {s.actual > 0 && <div className="pxActualRow"><span>From J로 실제 절약</span><b>₩{fmtMoney(s.actual)}</b></div>}
    </div>
  );
}
