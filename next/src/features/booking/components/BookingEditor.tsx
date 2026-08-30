'use client';
// 예약 편집 폼 — 검증은 domain(validateBookingDraft)이 판단하고 폼은 표현만 한다.
// 레거시 모달과 같은 규칙: 당일 렌터카 허용(시각 필요), 숙박 당일 체크아웃 거부.
import { useState } from 'react';

import type { Booking, BookingType } from '../domain/types';
import { newBookingId, validateBookingDraft, type DraftError } from '../domain/operations';

const ERR_MSG: Record<DraftError, string> = {
  TITLE_REQUIRED: '예약 이름을 입력하세요',
  PRICE_REQUIRED: '예약 가격을 입력하세요',
  TRACK_NEEDS_DATES: '가격 추적에는 체크인·체크아웃 날짜가 필요해요',
  RETURN_BEFORE_PICKUP: '반납일이 픽업일보다 앞설 수 없어요',
  SAME_DAY_NEEDS_TIMES: '당일 대여는 픽업 시각과 그보다 늦은 반납 시각이 필요해요',
  CHECKOUT_NOT_AFTER_CHECKIN: '체크아웃은 체크인보다 뒤여야 해요'
};

// 폼 초안 — union을 펼친 평면 타입 (type 전환 시 입력값 보존). 저장 직전에 Booking으로 좁힌다.
interface Draft {
  id: string; type: BookingType; title: string; price: number; track: boolean;
  provider?: string; cur?: 'KRW' | 'USD' | 'EUR' | 'JPY' | 'CNY'; start?: string; end?: string;
  adults?: number; rooms?: number;
  carPickup?: string; carReturn?: string; carPickupTime?: string; carReturnTime?: string;
}

function toDraft(b: Booking | null): Draft {
  if (b) return { ...b } as Draft;
  return { id: newBookingId(), type: 'hotel', title: '', price: 0, track: true };
}

export function BookingEditor({ booking, onSave, onCancel }: {
  booking: Booking | null;
  onSave: (b: Booking) => void;
  onCancel: () => void;
}) {
  const [d, setD] = useState<Draft>(() => toDraft(booking));
  const [error, setError] = useState<string | null>(null);
  const set = (patch: Partial<Draft>) => setD(prev => ({ ...prev, ...patch }));

  const submit = () => {
    const candidate = { ...d, title: d.title.trim() } as Booking;
    const v = validateBookingDraft(candidate);
    if (!v.ok) { setError(ERR_MSG[v.error]); return; }
    onSave(candidate);
  };

  const dateLabels = d.type === 'car' ? ['픽업일', '반납일'] : d.type === 'flight' ? ['출발일', '도착일'] : ['체크인', '체크아웃'];

  return (
    <div className="bookingEditor">
      <h2>{booking ? '예약 수정' : '예약 추가'}</h2>
      <label>종류
        <select value={d.type} onChange={e => set({ type: e.target.value as BookingType })}>
          <option value="hotel">🏨 숙박</option>
          <option value="car">🚗 렌터카</option>
          <option value="flight">✈️ 항공</option>
        </select>
      </label>
      <label>예약 이름
        <input value={d.title} onChange={e => set({ title: e.target.value })} placeholder="호텔·업체·편명" />
      </label>
      <label>예약처
        <input value={d.provider ?? ''} onChange={e => set({ provider: e.target.value })} />
      </label>
      <label>총액
        <input inputMode="numeric" value={d.price ? String(d.price) : ''}
          onChange={e => set({ price: parseInt(e.target.value.replace(/[^\d]/g, ''), 10) || 0 })} />
      </label>
      <label>통화
        <select value={d.cur ?? 'KRW'} onChange={e => set({ cur: e.target.value === 'KRW' ? undefined : (e.target.value as Draft['cur']) })}>
          {['KRW', 'USD', 'EUR', 'JPY', 'CNY'].map(c => <option key={c} value={c}>{c}</option>)}
        </select>
      </label>
      <div className="row2">
        <label>{dateLabels[0]}<input type="date" value={d.start ?? ''} onChange={e => set({ start: e.target.value || undefined })} /></label>
        <label>{dateLabels[1]}<input type="date" value={d.end ?? ''} onChange={e => set({ end: e.target.value || undefined })} /></label>
      </div>
      {d.type === 'hotel' && (
        <div className="row2">
          <label>인원<input inputMode="numeric" value={d.adults ?? 2} onChange={e => set({ adults: parseInt(e.target.value, 10) || 2 })} /></label>
          <label>객실 수<input inputMode="numeric" value={d.rooms ?? 1} onChange={e => set({ rooms: parseInt(e.target.value, 10) || 1 })} /></label>
        </div>
      )}
      {d.type === 'car' && (
        <>
          <div className="row2">
            <label>픽업 장소<input value={d.carPickup ?? ''} onChange={e => set({ carPickup: e.target.value || undefined })} /></label>
            <label>픽업 시각<input placeholder="10:00" value={d.carPickupTime ?? ''} onChange={e => set({ carPickupTime: e.target.value || undefined })} /></label>
          </div>
          <div className="row2">
            <label>반납 장소 <span className="opt">(비우면 픽업과 동일)</span>
              <input value={d.carReturn ?? ''} onChange={e => set({ carReturn: e.target.value || undefined })} /></label>
            <label>반납 시각<input placeholder="10:00" value={d.carReturnTime ?? ''} onChange={e => set({ carReturnTime: e.target.value || undefined })} /></label>
          </div>
        </>
      )}
      <label className="rowCheck">
        <input type="checkbox" checked={d.track} onChange={e => set({ track: e.target.checked })} /> 가격 추적
      </label>
      {error && <div className="formError" role="alert">{error}</div>}
      <div className="pxActions">
        <button type="button" className="btn primary" onClick={submit}>저장</button>
        <button type="button" className="btn" onClick={onCancel}>취소</button>
      </div>
    </div>
  );
}
