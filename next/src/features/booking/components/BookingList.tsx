'use client';
import type { PriceStore } from '@/features/pricing/services/localPriceStore';
import type { Booking } from '../domain/types';
import { BookingCard } from './BookingCard';
import { SavingOpportunityCard } from './SavingOpportunityCard';

export function BookingList({ bookings, prices, onSelect, onAdd }: {
  bookings: Booking[];
  prices: PriceStore;
  onSelect: (id: string) => void;
  onAdd: () => void;
}) {
  return (
    <div className="bookingList">
      <SavingOpportunityCard bookings={bookings} prices={prices} />
      {bookings.length
        ? bookings.map(b => <BookingCard key={b.id} booking={b} rec={prices[b.id] ?? null} onClick={() => onSelect(b.id)} />)
        : <p className="hint">아직 예약이 없어요 — 숙박·렌터카·항공 예약을 등록하면 가격을 추적합니다</p>}
      <button type="button" className="btn addBtn" onClick={onAdd}>＋ 예약 추가</button>
    </div>
  );
}
