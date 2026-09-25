import { expect, it } from 'vitest';

import { computeToday, summarizeTrip, type TripDoc } from './todayView';

it('여행 목록과 상세는 같은 도시 요약을 반환한다', () => {
  const trip: TripDoc = {
    name: '스페인', start: '2026-10-25',
    days: [{ spots: ['Madrid', '마드리드', 'Sevilla', 'Seville', '세비야', 'Sóller', 'Port de Sóller']
      .map(city => ({ name: city, city })) }]
  };
  const summary = summarizeTrip({ client_id: 'cities', data: trip, revision: 1, updated_at: '' }, '2026-09-25');
  const today = computeToday({
    tripId: 'cities', trip, revision: 1, updatedAt: '', todayISO: '2026-09-25',
    nowMinutes: 600, generatedAt: '2026-09-25T01:00:00Z'
  }).response;
  expect(summary.cities).toEqual(['마드리드', '세비야', '소예르']);
  expect(today.trip.cities).toEqual(summary.cities);
});
