'use client';
// 여행 모드 — '지금 여행 중' 화면. 현재 장소를 크게, 다음 장소를 그 아래,
// 오늘의 나머지를 목록으로. 판정은 전부 domain/travelView가 한다 (§27).
import { safeUrl } from '@/lib/url/safeUrl';
import type { TravelStop, TravelView as View } from '../domain/travelView';

function StopRow({ s, current }: { s: TravelStop; current: boolean }) {
  const book = safeUrl(s.bookUrl ?? undefined);
  return (
    <div className={`tvStop${current ? ' on' : ''}`}>
      {s.leg && <div className="tvLeg">{s.leg}</div>}
      <div className="tvStopMain">
        <span className="tvEta">{s.eta}</span>
        <span className="tvName">
          {s.catIcon && <span aria-hidden="true">{s.catIcon} </span>}
          {s.si + 1}. {s.name}
        </span>
      </div>
      {s.desc && <div className="tvDesc">{s.desc}</div>}
      <div className="tvLinks">
        {s.mapLink
          ? <a href={s.mapLink.href} target="_blank" rel="noopener noreferrer">🧭 {s.mapLink.label}</a>
          : <span className="tvNoloc">📍 위치 미지정</span>}
        {book && <a href={book} target="_blank" rel="noopener noreferrer">🔗 예약 정보</a>}
      </div>
    </div>
  );
}

export function TravelView({ view }: { view: View }) {
  if (view.empty) {
    return (
      <section className="tvPage">
        <header className="tvHead">
          <h2>{view.title}</h2>
          {view.subtitle && <p className="tvSub">{view.subtitle}</p>}
        </header>
        <div className="tvFocus">
          <div className="tvKicker">현재 장소</div>
          <div className="tvPlace">자유 일정</div>
        </div>
        <p className="hint">등록된 장소가 없습니다 — 이동일이거나 자유 일정입니다.</p>
      </section>
    );
  }

  const cur = view.current;
  const curBook = safeUrl(cur?.bookUrl ?? undefined);
  return (
    <section className="tvPage">
      <header className="tvHead">
        <h2>{view.title}</h2>
        {view.subtitle && <p className="tvSub">{view.subtitle}</p>}
      </header>

      {cur && (
        <div className="tvFocus">
          <div className="tvKicker">{view.isToday ? '현재 장소' : '선택한 날의 시작 장소'}</div>
          <div className="tvPlace">
            {cur.catIcon && <span aria-hidden="true">{cur.catIcon} </span>}{cur.name}
          </div>
          <div className="tvFacts">{cur.facts.join(' · ')}</div>
          {cur.desc && <div className="tvFacts">{cur.desc}</div>}
          <div className="tvLinks">
            {cur.mapLink && (
              <a href={cur.mapLink.href} target="_blank" rel="noopener noreferrer">🧭 길찾기</a>
            )}
            {curBook && <a href={curBook} target="_blank" rel="noopener noreferrer">🔗 예약 정보</a>}
          </div>
        </div>
      )}

      <div className="tvNext">
        <div>
          <div className="tvKicker">다음 장소</div>
          <strong>{view.next ? `${view.next.isBackToStay ? '🏠 ' : ''}${view.next.name}` : '오늘 일정 완료'}</strong>
          {view.next && (
            <div className="tvFacts">
              {view.next.note}{view.next.eta ? ` · ${view.next.eta} 도착 예상` : ''}
            </div>
          )}
        </div>
        <span aria-hidden="true">{view.next ? '→' : '✓'}</span>
      </div>

      {view.carry && (
        <div className="tvStop tvCarry">
          <div className="tvStopMain">
            <span className="tvEta" aria-hidden="true">🏠</span>
            <span className="tvName">{view.carry.name}</span>
          </div>
          <div className="tvFacts">전날 숙소 · {view.carry.startAt} 출발</div>
        </div>
      )}
      {view.stops.map(s => <StopRow key={s.si} s={s} current={s.si === cur?.si} />)}
    </section>
  );
}
