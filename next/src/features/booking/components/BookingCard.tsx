'use client';
import type { PriceRecord } from '@/features/pricing/domain/types';
import { costLabel } from '@/lib/currency/format';
import type { Booking } from '../domain/types';
import { BookingBadge } from './BookingBadge';

export const BK_TYPE: Record<Booking['type'], { icon: string; name: string }> = {
  hotel: { icon: '🏨', name: '숙박' },
  car: { icon: '🚗', name: '렌터카' },
  flight: { icon: '✈️', name: '항공' }
};

export function BookingCard({ booking, rec, onClick }: { booking: Booking; rec: PriceRecord | null; onClick: () => void }) {
  const period = [booking.start, booking.end].filter(Boolean).join(' ~ ');
  const sub = [period, booking.provider, costLabel(booking.price, booking.cur)].filter(Boolean).join(' · ');
  return (
    <button type="button" className="pxRow" onClick={onClick} title="탭해서 상세·판매처 비교·가격 기록 보기">
      <span className="tn">{BK_TYPE[booking.type].icon} {booking.title}<span className="opt">{sub}</span></span>
      <BookingBadge booking={booking} rec={rec} />
    </button>
  );
}
