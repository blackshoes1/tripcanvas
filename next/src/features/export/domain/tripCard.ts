// 이미지 카드 도메인 — 순수(§9). buildDayView가 이미 만든 뷰에서 카드 모델을 뽑는다.
// 화면과 같은 소스를 쓰는 게 요점이다 — ETA·렌터카·숙소 복귀 기준이 화면과 어긋나면
// 남에게 보낸 이미지만 틀린 일정이 된다(레거시가 dayEtas/carEventsOn을 다시 부르는 이유와 같다).
import type { DayView } from '@/features/itinerary/domain/types';
import type { Trip } from '@/features/trip/domain/types';

export interface CardLine {
  /** 도착 예상 시각 (없으면 빈 문자열) */
  time: string;
  text: string;
  kind: 'spot' | 'car' | 'stay';
  dim?: boolean;
}

export interface CardDay {
  no: number;
  title: string;
  date: string;
  drive: string;
  note: string;
  color: string;
  lines: CardLine[];
}

export interface TripCard {
  name: string;
  subtitle: string;
  days: CardDay[];
}

/** 카드 한 장 — 화면 뷰(DayView)에서 그대로 뽑는다 */
export function buildTripCard(trip: Trip, views: DayView[], colorOf: (di: number) => string): TripCard {
  return {
    name: trip.name,
    subtitle: trip.start ? `${trip.start} 출발 · ${trip.days.length}일` : `${trip.days.length}일`,
    days: views.map(v => {
      const lines: CardLine[] = [];
      for (const e of v.carPickups) {
        lines.push({ time: '', kind: 'car', dim: true, text: `🚗 ${e.placeLabel} (${e.subLabel})` });
      }
      for (const s of v.spots) {
        lines.push({
          time: s.etaText, kind: 'spot',
          text: `${s.order}. ${s.catIcon ? `${s.catIcon} ` : ''}${s.name}${s.optional ? ' (선택)' : ''}`
        });
      }
      for (const e of v.carReturns) {
        lines.push({ time: '', kind: 'car', dim: true, text: `🚗 ${e.placeLabel} (${e.subLabel})` });
      }
      if (v.back) lines.push({ time: '', kind: 'stay', dim: true, text: `🏠 ${v.back.name} (숙소 복귀)` });
      return {
        no: v.dayNo, title: v.title, date: v.dateLabel, drive: v.drive, note: v.note,
        color: colorOf(v.di), lines
      };
    })
  };
}
