'use client';
// 이미지로 찍을 카드. 화면 밖에 그려 두고 html2canvas가 그대로 캡처한다.
// ⚠️ 레거시는 innerHTML로 문자열을 조립하느라 값마다 esc()를 불러야 했다 —
// 여기서는 React가 기본으로 이스케이프하므로 그 실수 자체가 불가능하다.
import type { TripCard as CardModel } from '../domain/tripCard';

const BG = '#141b33';
const PANEL = '#1f2b4d';
const FG = '#e8e8f0';
const DIM = '#9aa5c4';
const ACCENT = '#f6bd60';

export const CARD_WIDTH = 520;

export function TripCard({ card, innerRef }: {
  card: CardModel;
  innerRef?: React.Ref<HTMLDivElement>;
}) {
  return (
    <div
      ref={innerRef}
      style={{
        width: CARD_WIDTH, background: BG, color: FG, padding: 24, boxSizing: 'border-box',
        fontFamily: "'Apple SD Gothic Neo','Malgun Gothic',sans-serif"
      }}
    >
      <div style={{ fontSize: 20, fontWeight: 800, marginBottom: 2 }}>🗺 {card.name}</div>
      {card.subtitle && <div style={{ fontSize: 12, color: DIM, marginBottom: 14 }}>{card.subtitle}</div>}
      {card.days.map(d => (
        <div key={d.no} style={{
          borderLeft: `4px solid ${d.color}`, background: PANEL, borderRadius: 10,
          padding: '10px 14px', marginBottom: 10
        }}>
          <div style={{ fontSize: 13.5, fontWeight: 700 }}>
            Day {d.no}{d.title ? ` · ${d.title}` : ''}
            {d.date && <span style={{ color: DIM, fontWeight: 400, fontSize: 11 }}> {d.date}</span>}
          </div>
          {d.drive && <div style={{ fontSize: 11, color: ACCENT, marginTop: 3 }}>{d.drive}</div>}
          {d.lines.map((l, i) => (
            <div key={i} style={{ fontSize: 12, marginTop: 5, color: l.dim ? DIM : FG }}>
              {l.time && <span style={{ color: ACCENT, fontWeight: 700, fontSize: 10.5 }}>{l.time} </span>}
              {l.text}
            </div>
          ))}
          {d.note && (
            <div style={{ fontSize: 10.5, color: DIM, marginTop: 6, whiteSpace: 'pre-wrap' }}>📝 {d.note}</div>
          )}
        </div>
      ))}
      <div style={{ fontSize: 10, color: '#5a6690', textAlign: 'right' }}>made with From J</div>
    </div>
  );
}
