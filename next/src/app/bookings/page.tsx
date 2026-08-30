'use client';
// 예약 목록·상세·편집 — 레거시 예약 모달과 같은 데이터(tripcanvas_v1·tripcanvas_prices_v1)를 쓰는
// 병행 화면. business rule은 전부 domain/engine에 있고 이 페이지는 배선만 한다 (§27).
import { useState } from 'react';

import { BookingDetail } from '@/features/booking/components/BookingDetail';
import { BookingEditor } from '@/features/booking/components/BookingEditor';
import { BookingList } from '@/features/booking/components/BookingList';
import { deleteBooking, upsertBooking } from '@/features/booking/domain/operations';
import type { Booking } from '@/features/booking/domain/types';
import { useFxRates } from '@/features/currency/hooks/useFxRates';
import { usePriceStore } from '@/features/pricing/hooks/usePriceStore';
import { deletePriceRecord } from '@/features/pricing/services/localPriceStore';
import { useTripStore } from '@/features/trip/hooks/useTripStore';
import './bookings.css';

type View = { mode: 'list' } | { mode: 'detail'; id: string } | { mode: 'edit'; id: string | null };

export default function BookingsPage() {
  const { activeTrip, updateActiveTrip } = useTripStore();
  const { prices } = usePriceStore();
  useFxRates();                    // 환율을 하루 한 번 갱신하고, 바뀌면 다시 그린다
  const [view, setView] = useState<View>({ mode: 'list' });
  const [notice, setNotice] = useState<string | null>(null);

  if (!activeTrip) {
    return (
      <main className="bkPage">
        <h1>예약 · 가격 추적</h1>
        <p className="hint">
          이 브라우저에 저장된 여행이 없어요. 기존 앱에서 여행을 만들면 같은 데이터를 여기서 관리할 수 있습니다.
        </p>
      </main>
    );
  }

  const bookings: Booking[] = activeTrip.bookings ?? [];
  const bookingOf = (id: string) => bookings.find(b => b.id === id) ?? null;

  const save = (b: Booking) => {
    const ok = updateActiveTrip(trip => upsertBooking(trip, b));
    setNotice(ok ? '예약 저장됨' : '저장에 실패했어요 — 저장 공간을 확인해주세요');
    if (ok) setView({ mode: 'detail', id: b.id });
  };
  const remove = (id: string) => {
    const b = bookingOf(id);
    if (!b) return;
    if (!window.confirm(`"${b.title}" 예약 추적을 삭제할까요? (실제 예약이 취소되지는 않아요)`)) return;
    const ok = updateActiveTrip(trip => deleteBooking(trip, id));
    if (ok) { deletePriceRecord(id); setNotice('예약 추적 삭제됨'); setView({ mode: 'list' }); }
  };

  return (
    <main className="bkPage">
      <h1>예약 · 가격 추적 <span className="opt">{activeTrip.name}</span></h1>
      {notice && <div className="hint" role="status">{notice}</div>}
      {view.mode === 'list' && (
        <BookingList bookings={bookings} prices={prices}
          onSelect={id => setView({ mode: 'detail', id })}
          onAdd={() => setView({ mode: 'edit', id: null })} />
      )}
      {view.mode === 'detail' && (() => {
        const b = bookingOf(view.id);
        if (!b) { setView({ mode: 'list' }); return null; }
        return (
          <BookingDetail booking={b} rec={prices[b.id] ?? null}
            onEdit={() => setView({ mode: 'edit', id: b.id })}
            onDelete={() => remove(b.id)}
            onBack={() => setView({ mode: 'list' })} />
        );
      })()}
      {view.mode === 'edit' && (
        <BookingEditor booking={view.id ? bookingOf(view.id) : null}
          onSave={save}
          onCancel={() => setView(view.id ? { mode: 'detail', id: view.id } : { mode: 'list' })} />
      )}
    </main>
  );
}
