'use client';
// 일자 카드 — buildDayView 결과를 그대로 그린다 (판정·배선은 전부 domain/dayView).
// 읽기 뷰: 편집·드래그·지도 연동은 레거시가 담당한다 (Phase 5·6에서 이관).
import type { CarEventRowView, DayView, SpotView } from '@/features/itinerary/domain/types';
import { safeUrl } from '@/lib/url/safeUrl';

function CarEventRow({ ev }: { ev: CarEventRowView }) {
  return (
    <div className="itSpot itCarbk" title={ev.title}>
      <div className="itSpotMain">
        <span className="itEta" aria-hidden="true">🚗</span>
        <span className="itSpotName">{ev.placeLabel}</span>
      </div>
      <div className="itMeta"><span className="itMetaItem itOpt">{ev.subLabel}</span></div>
    </div>
  );
}

/** 장소 행 조작 — 편집기를 열거나 위아래로 한 칸 옮긴다 (레거시 사이드바 버튼과 같은 역할) */
interface SpotActions {
  onEdit: (si: number) => void;
  onMove: (si: number, delta: number) => void;
  /** 끝에서 비활성화하려면 필요 */
  count: number;
}

function SpotRow({ s, dayIndex, selected, actions }: {
  s: SpotView; dayIndex: number; selected: boolean; actions?: SpotActions;
}) {
  const bookHref = safeUrl(s.bookUrl);
  return (
    <div id={`it-d${dayIndex}-s${s.si}`} className={`itSpot${selected ? ' sel' : ''}`}>
      {s.leg && (
        <div className="itLeg" title={s.leg.title}>
          <span className="itLegMode" aria-hidden="true">{s.leg.modeIcon}</span> {s.leg.label}
        </div>
      )}
      <div className="itSpotMain">
        <span className={`itEta${s.fixed ? ' fixed' : ''}`} title={s.etaTitle}>
          {s.fixed ? '📌' : ''}{s.etaText}{s.conflict ? '⚠️' : ''}
        </span>
        <span className="itSpotName">
          <span className="itOrder">{s.order}.</span>
          {s.catIcon && <span className="itCat" title={s.catName ?? undefined} aria-hidden="true">{s.catIcon}</span>}
          {s.name}
        </span>
        {actions && (
          <span className="itSpotActs">
            <button type="button" title="위로" aria-label={`${s.name} 위로`}
              disabled={s.si === 0} onClick={() => actions.onMove(s.si, -1)}>↑</button>
            <button type="button" title="아래로" aria-label={`${s.name} 아래로`}
              disabled={s.si === actions.count - 1} onClick={() => actions.onMove(s.si, 1)}>↓</button>
            <button type="button" title="편집" aria-label={`${s.name} 편집`}
              onClick={() => actions.onEdit(s.si)}>✏️</button>
          </span>
        )}
      </div>
      {(s.stayLabel || s.optional || s.noLoc || s.cost || s.book || bookHref || s.carChips.length > 0 || s.hoursWarn) && (
        <div className="itMeta">
          {s.stayLabel && <span className="itMetaItem itStay">{s.stayLabel}</span>}
          {s.optional && <span className="itMetaItem itOpt">선택 코스</span>}
          {s.noLoc && <span className="itMetaItem itNoloc">📍 위치 미지정</span>}
          {s.cost && (
            <>
              <span className="itMetaItem itCost" title={s.cost.title ?? undefined}>{s.cost.label}</span>
              {s.cost.converted && <span className="itMetaItem itCost itCostConv">{s.cost.converted}</span>}
            </>
          )}
          {s.book && (
            <>
              <span className={`itMetaItem itBook${s.book.warn ? ' warn' : ''}`} title={s.book.title}>
                🎫 {s.book.at}{s.book.warn ? ' ⚠️' : ''}
              </span>
              {s.book.waitMin > 0 && (
                <span className="itMetaItem itBook"
                  title={`도착 예상 ${s.etaText} → 예약 ${s.book.at}까지 대기. 다음 장소 도착 예상에 이 대기가 반영됩니다`}>
                  ⏳ {s.book.waitMin}분 대기
                </span>
              )}
            </>
          )}
          {bookHref && (
            <a className="itMetaItem itBook" href={bookHref} target="_blank" rel="noopener noreferrer">🔗 예약 링크</a>
          )}
          {s.carChips.map(c => (
            <span key={c.kind} className="itMetaItem itCarChip" title={c.title}>{c.label}</span>
          ))}
          {s.hoursWarn && <span className="itMetaItem itClosed" title={s.hoursWarn}>🚫 영업시간 확인</span>}
        </div>
      )}
      {s.desc && <div className="itDesc">{s.desc}</div>}
    </div>
  );
}

export function DayCard({ view, dim = false, selectedSi = null, onHeaderClick, onEditSpot, onMoveSpot }: {
  view: DayView;
  /** 일자 필터 중 다른 날 — 흐리게 (레거시 .dayCard.dim) */
  dim?: boolean;
  /** 지도 핀에서 선택된 장소 강조 */
  selectedSi?: number | null;
  /** 헤더 탭 → 그 일자 필터 토글 + 지도 포커스 */
  onHeaderClick?: () => void;
  /** 편집기 열기 — 없으면 읽기 전용으로 그린다 */
  onEditSpot?: (si: number) => void;
  /** 이웃과 자리 맞바꾸기 */
  onMoveSpot?: (si: number, delta: number) => void;
}) {
  const actions = onEditSpot && onMoveSpot
    ? { onEdit: onEditSpot, onMove: onMoveSpot, count: view.spots.length }
    : undefined;
  return (
    <section className={`itDay${dim ? ' dim' : ''}`} aria-label={`Day ${view.dayNo} ${view.title}`}>
      <header
        className={`itDayHead${onHeaderClick ? ' clickable' : ''}`}
        onClick={onHeaderClick}
        role={onHeaderClick ? 'button' : undefined}
        tabIndex={onHeaderClick ? 0 : undefined}
        onKeyDown={e => {
          if (onHeaderClick && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); onHeaderClick(); }
        }}
        title={onHeaderClick ? '탭하면 이 일자만 지도에 표시' : undefined}
      >
        <div className="itDayTitle">Day {view.dayNo}{view.title ? ` · ${view.title}` : ''}</div>
        <div className="itDayMeta">
          {view.dateLabel || '📅 날짜 미지정'}
          {' · '}{view.timeZone ? `🌐 ${view.timeZone}` : '🌐 시간대 미설정'}
          {' · '}<span title={`이동 수단: ${view.modeName}`}>{view.modeIcon}</span>
        </div>
      </header>
      <div className="itDayBody">
        {view.drive && <div className="itDrive">{view.drive}</div>}
        {view.flightLabel && <div className="itDrive itFlight">{view.flightLabel}</div>}
        {view.interDayLabel && <div className="itDrive itInterDay">{view.interDayLabel}</div>}
        {view.routeLabel && <div className="itDist">{view.routeLabel}</div>}
        {view.overloadLabel && <div className="itOverload">{view.overloadLabel}</div>}
        {view.cost.parts.length > 0 && (
          <div className="itDist" title="여러 날 걸친 예약(숙박·렌터카·항공)은 날수로 나눈 하루치로 넣습니다">
            💳 하루 비용 약 ₩{view.cost.total.toLocaleString('en-US')}
            {view.cost.parts.length > 1 && (
              <span className="itDim">
                {' '}({view.cost.parts.map(p => `${p.label} ₩${p.amount.toLocaleString('en-US')}`).join(' + ')})
              </span>
            )}
          </div>
        )}
        {view.carry && (
          <div className="itSpot itCarry" title="전날 숙소 — 오늘 첫 일정으로 자동 이월">
            <div className="itSpotMain">
              <span className="itEta" aria-hidden="true">🏠</span>
              <span className="itSpotName">{view.carry.name}</span>
              <span className="itDim">전날 숙소 · {view.carry.startAt} 출발</span>
            </div>
          </div>
        )}
        {view.carPickups.map(ev => <CarEventRow key={`p-${ev.bookingId}`} ev={ev} />)}
        {view.spots.map(s => (
          <SpotRow key={s.si} s={s} dayIndex={view.di} selected={selectedSi === s.si} actions={actions} />
        ))}
        {view.carReturns.map(ev => <CarEventRow key={`r-${ev.bookingId}`} ev={ev} />)}
        {view.back && (
          <div className="itSpot itCarry" title="오늘 묵는 숙소 — 동선이 닫히도록 자동으로 이어 붙였습니다">
            <div className="itLeg" title={view.back.leg.title}>
              <span className="itLegMode" aria-hidden="true">{view.back.leg.modeIcon}</span> {view.back.leg.label}
            </div>
            <div className="itSpotMain">
              <span className="itEta" aria-hidden="true">🏠</span>
              <span className="itSpotName">{view.back.name}</span>
              <span className="itDim">{view.back.modeIcon} 숙소 복귀 · 자동</span>
            </div>
          </div>
        )}
        {view.spots.length === 0 && view.carPickups.length === 0 && view.carReturns.length === 0 && (
          <div className="itEmpty">등록된 장소가 없습니다 — 이동일이거나 자유 일정입니다.</div>
        )}
        {view.note && <div className="itNote">📝 {view.note}</div>}
      </div>
    </section>
  );
}
