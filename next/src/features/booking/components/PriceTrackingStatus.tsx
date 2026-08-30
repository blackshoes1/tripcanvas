'use client';
// 가격 추적 상태 — 레거시 renderBookingStatusBox와 같은 판정·문구.
// 매칭(같은 상품)과 검증(판매처 확인)은 다른 축(P0-3), 기준 불일치는 판단 제외를 설명(P0-1).
// 시세 '갱신'은 레거시 앱·cron이 수행한다 — API 이관(Phase 3) 전에 조회를 중복 구현하지 않는다.
import { useState } from 'react';

import { getTrackingState, offerPrice, verificationStatus } from '@/features/pricing/domain/engine';
import type { MarketOffer, PriceRecord } from '@/features/pricing/domain/types';
import { PRICE_CFG } from '@/features/pricing/domain/engine';
import { costLabel, krwRateOf } from '@/lib/currency/format';
import { todayISO } from '@/lib/date/today';
import type { Booking } from '../domain/types';

function QualityLabel({ offer }: { offer: MarketOffer }) {
  const q = offer.quality;
  if (q === 'EXACT' || q === 'EQUIVALENT') {
    return verificationStatus(offer) === 'VERIFIED'
      ? <span className="pxQ pxQok">✓ 동일 조건 · 판매처 확인됨</span>
      : <span className="pxQ pxQok">조건 일치로 보임 · 검증 필요</span>;
  }
  if (q === 'UNSUPPORTED_BASIS') return <span className="pxQ pxQask">1실 기준 · 참고용</span>;
  if (q === 'SIMILAR') return <span className="pxQ pxQask">조건 확인 필요</span>;
  return <span className="pxQ">비교 불가</span>;
}

function fmtDT(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(+d)) return '';
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

const safeHttps = (url?: string) => (url && /^https:\/\//.test(url) ? url : undefined);

export function PriceTrackingStatus({ booking, rec }: { booking: Booking; rec: PriceRecord | null }) {
  const [now] = useState(() => Date.now());   // 렌더 순수성 — 마운트 시 1회 고정
  const today = todayISO();
  if (booking.type === 'flight')
    return <div className="pxState pxWatch">🟡 항공 가격 소스는 준비 중 — 지금은 예약 기록용으로 저장돼요</div>;
  const missing = !booking.start || !booking.end;
  const st = getTrackingState(booking, rec, { today, krwRate: krwRateOf(booking.cur) });

  let head: React.ReactNode;
  if (missing) head = <div className="pxState pxWatch">체크인·체크아웃 날짜를 입력하면 가격 추적을 시작해요</div>;
  else if (booking.start && booking.start < today) head = <div className="pxState pxOff">체크인이 지나 가격 추적을 마쳤어요</div>;
  else if (!booking.track) head = <div className="pxState pxOff">가격 추적이 꺼져 있어요 — 켜면 시세를 계속 확인합니다</div>;
  else if (st?.state === 'SAVING_AVAILABLE' && st.confirmed) {
    const o = st.confirmed.offer;
    const link = safeHttps(o.link);
    head = (
      <>
        <div className="pxState pxSave">
          🔴 재예약 시 약 {costLabel(st.confirmed.saving, booking.cur)} 절약 — {o.seller}{' '}
          <span className="pxQ pxQok">{o.verified ? '✓ 동일 조건 · 판매처 확인됨' : '조건상 동일해 보임 · 판매처 검증 필요'}</span>
        </div>
        <div className="hint">
          현재 예약 {costLabel(booking.price, booking.cur)} → {o.seller} {costLabel(offerPrice(o), booking.cur)}
          {st.fee ? ` · 취소 수수료 ${costLabel(st.fee, booking.cur)} 반영` : ''} — 재예약·기존 예약 취소는 직접 결정하세요
        </div>
        {link && <div className="pxActions"><a className="btn" href={link} target="_blank" rel="noopener noreferrer">판매처에서 확인 ↗</a></div>}
      </>
    );
  } else if (st?.state === 'CHEAPER_UNVERIFIED' && st.potential) {
    const o = st.potential.offer;
    head = (
      <>
        <div className="pxState pxWarnT">🟠 {o.seller}에서 최대 {costLabel(st.potential.delta, booking.cur)} 저렴한 옵션 발견</div>
        <div className="hint">현재 예약과 일부 조건이 다르거나 확인되지 않았어요 — 확정 절약으로 계산하지 않습니다.</div>
      </>
    );
  } else if (st?.state === 'GOOD_PRICE') {
    head = <><div className="pxState pxGood">🟢 좋은 가격 — 지금 예약을 유지하세요</div><div className="hint">현재 시세가 관측된 가격 중 최저 수준입니다</div></>;
  } else if (st?.state === 'ERROR' && st.err?.code === 'AUTH_REQUIRED') {
    head = (
      <>
        <div className="pxState pxWatch">🔌 자동 가격 소스 미연결 — 직접 가격 확인은 가능합니다</div>
        <div className="hint">가격 기록·시세 갱신은 기존 앱에서 할 수 있어요 (API 이관 전까지)</div>
      </>
    );
  } else if (st?.state === 'ERROR') {
    head = <div className="pxState pxWarnT">⚠️ 현재 가격을 확인하지 못했어요 <span className="opt">({st.err?.code})</span></div>;
  } else {
    head = <div className="pxState pxWatch">🟡 가격 추적 중 — 아직 의미 있는 하락이 없어요</div>;
  }

  const rooms = booking.type === 'hotel' ? (booking.rooms ?? 1) : 1;
  const offers = (rec?.offers ?? []).slice(0, 6);
  const obs = (rec?.obs ?? []).slice(-8).reverse();
  const ageH = rec?.at ? (now - Date.parse(rec.at)) / 3600e3 : null;

  return (
    <div className="pxStatus">
      {head}
      {booking.type === 'hotel' && !missing && booking.track && rooms > 1 && (
        <div className="hint"><b>1객실 기준</b> 시세만 확인 가능해요 — 현재 예약은 {rooms}객실입니다. 기준이 달라 자동 절약 판단에는 쓰지 않아요</div>
      )}
      {booking.freeCancelUntil && (
        <div className="hint">무료 취소 {booking.freeCancelUntil}까지{today <= booking.freeCancelUntil ? '' : ' — 기한이 지나 취소 수수료가 적용됩니다'}</div>
      )}
      {offers.length > 0 && (
        <>
          <label>💱 판매처별 가격 비교</label>
          <div className="pxHist pxOffers">
            {offers.map((o, i) => {
              const link = safeHttps(o.link);
              const carMeta = booking.type === 'car'
                ? [o.vehicleName || o.vehicleClass, o.transmission, o.mileage, o.insurance].filter(Boolean).join(' · ') : '';
              return (
                <div key={i}>
                  <span>{o.seller}{o.roomName ? <span className="opt"> {o.roomName}</span> : null}{carMeta ? <span className="opt"> {carMeta}</span> : null}</span>
                  <span className="pxOfferR">
                    <b>{costLabel(offerPrice(o), booking.cur)}</b> <QualityLabel offer={o} />
                    {link && <a href={link} target="_blank" rel="noopener noreferrer" title="판매처에서 확인"> ↗</a>}
                  </span>
                </div>
              );
            })}
          </div>
        </>
      )}
      {rec?.at && (
        <div className="hint">
          마지막 가격 확인 {fmtDT(rec.at)}
          {ageH != null && ageH > PRICE_CFG.staleNoticeHours ? <> — <b>가격 정보가 오래되었습니다</b></> : null}
          {rec.err ? ' · 최근 재확인 실패 — 마지막 성공 조회 기준으로 표시 중' : ''}
        </div>
      )}
      {obs.length > 0 && (
        <>
          <label>📈 가격 기록 (하루 1점, 최근 {obs.length}회)</label>
          <div className="pxHist">
            {obs.map((o, i) => (
              <div key={i}>
                <span>
                  {(o.at ?? '').slice(5, 10).replace('-', '/')} · {o.seller ?? ''}
                  {o.quality === 'UNSUPPORTED_BASIS' ? <span className="pxQ pxQask"> 1실 기준</span>
                    : o.quality && o.quality !== 'EXACT' && o.quality !== 'EQUIVALENT' ? <span className="pxQ pxQask"> 미확정</span> : null}
                </span>
                <b>{costLabel(o.price, o.cur)}</b>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
