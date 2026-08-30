'use client';
import type { PriceRecord } from '@/features/pricing/domain/types';
import { costLabel } from '@/lib/currency/format';
import type { Booking } from '../domain/types';
import { BK_TYPE } from './BookingCard';
import { PriceTrackingStatus } from './PriceTrackingStatus';

export function BookingDetail({ booking, rec, onEdit, onDelete, onBack }: {
  booking: Booking;
  rec: PriceRecord | null;
  onEdit: () => void;
  onDelete: () => void;
  onBack: () => void;
}) {
  return (
    <div className="bookingDetail">
      <button type="button" className="btn" onClick={onBack}>← 목록</button>
      <h2>{BK_TYPE[booking.type].icon} {booking.title}</h2>
      <div className="hint">
        {[booking.provider, [booking.start, booking.end].filter(Boolean).join(' ~ '), costLabel(booking.price, booking.cur)]
          .filter(Boolean).join(' · ')}
      </div>
      {booking.type === 'car' && (
        <div className="hint">
          픽업 {booking.carPickup ?? '—'}{booking.carPickupCode ? ` (${booking.carPickupCode})` : ''}
          {booking.carPickupTime ? ` ${booking.carPickupTime}` : ''} · 반납{' '}
          {booking.carReturn || booking.carReturnCode
            ? `${booking.carReturn ?? ''}${booking.carReturnCode ? ` (${booking.carReturnCode})` : ''}`
            : '픽업과 동일'}
          {booking.carReturnTime ? ` ${booking.carReturnTime}` : ''}
        </div>
      )}
      <PriceTrackingStatus booking={booking} rec={rec} />
      <div className="pxActions">
        <button type="button" className="btn" onClick={onEdit}>수정</button>
        <button type="button" className="btn danger" onClick={onDelete}>삭제</button>
      </div>
    </div>
  );
}
