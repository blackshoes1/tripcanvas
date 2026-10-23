import type { TodayInput } from './todayView';
import type { TomorrowBrief, TripSummary } from './contract';
import { buildDayPlanView } from './dayPlanView';
import { buildBookings } from './bookingsView';
import lib from '@legacy/lib.js';

/** Projects the next day's existing timeline and booking source; never invents a route or reservation. */
export function buildTomorrowBrief(input: TodayInput, dayIndex: number, summary: TripSummary): TomorrowBrief | null {
  const plan = buildDayPlanView({ trip: input.trip, di: dayIndex, summary,
    generatedAt: input.generatedAt ?? new Date().toISOString(), todayISO: input.todayISO });
  if (!plan) return null;
  const first = plan.day.spots.find(row => !['COMPLETED', 'SKIPPED', 'CANCELLED'].includes(row.status));
  const bookings = buildBookings(input.trip, [], input.todayISO);
  return {
    dayIndex, date: plan.day.date, firstPlace: first?.name ?? null,
    departureMinutes: first ? first.etaMinutes - (first.incomingLeg?.minutes ?? 0) : null,
    travelTimeSource: plan.travelTimeSource,
    checkouts: [...new Set([...bookings.filter(row => row.type === 'hotel' && row.end === plan.day.date).map(row => row.title),
      ...lib.dayLodgings(input.trip, dayIndex).filter(row => row.state === 'CHECK_OUT').map(row => row.name)])],
    reservations: [...bookings.filter(row => row.start === plan.day.date)
      .map(row => `${row.startTime ? `${row.startTime} · ` : ''}${row.title}`),
    ...plan.day.flights.map(row => `항공편 ${row.code} · ${row.dep} → ${row.arr}${row.depMinutes == null ? '' : ` · ${lib.hm(row.depMinutes)}`}`)]
  };
}
