import { createHash } from 'node:crypto';
import adapt from '@legacy/adaptive.js';
import lib from '@legacy/lib.js';
import { legMinutes } from '@/features/itinerary/domain/dayView';
import type { TransportMode } from '@/features/trip/domain/types';
import type { LegCache } from '@/features/itinerary/domain/types';
import { computeToday, estimateLegMinutes, type TodayInput, type TripDoc } from './todayView';

export interface StayExtensionResult {
  activityId: string; currentName: string; extraMinutes: number;
  oldDepartureMinutes: number; newDepartureMinutes: number;
  feasible: boolean; reason: string | null; hasUnknownTravel: boolean;
  changes: { activityId: string; name: string; beforeStayMinutes: number; afterStayMinutes: number }[];
  affectedActivityIds: string[];
  fixedCommitments: { activityId: string; name: string; atMinutes: number; arrivalMinutes: number | null; slackMinutes: number | null; bufferMinutes: number }[];
  dayEndBeforeMinutes: number | null; dayEndAfterMinutes: number | null;
}
export interface StayExtensionPreview extends StayExtensionResult {
  schemaVersion: number; revision: number; generatedAt: string; dayIndex: number;
  travelTimeSource: string; previewKey: string;
}

/** Adapter only: all decisions come from adaptive.js, using the same leg cache as Today. */
export function buildStayExtension(input: TodayInput, activityId: string, extraMinutes: number): StayExtensionPreview | null {
  const computed = computeToday(input);
  const day = input.trip.days?.[computed.dayIndex];
  const cache: LegCache = input.legCache ?? {};
  const result = adapt.previewStayExtension(computed.state, { activityId, extraMinutes,
    legMin: (a: { lat: number; lng: number }, b: { lat: number; lng: number }) => {
      const mode = adapt.moveModeTo(input.trip, day, b) as TransportMode;
      const hit = cache[lib.legKey(a, b, mode)];
      return hit?.sec ? legMinutes(cache, a, b, mode) : estimateLegMinutes(a, b, mode);
    }
  });
  if (!result) return null;
  // Scope to trip/revision and every visible consequence; changed routes/time invalidate consent.
  const previewKey = createHash('sha256').update(JSON.stringify([input.tripId, input.revision, result])).digest('hex');
  return { ...result, schemaVersion: 1, revision: input.revision, generatedAt: input.generatedAt ?? new Date().toISOString(),
    dayIndex: computed.dayIndex, travelTimeSource: computed.response.travelTimeSource, previewKey };
}

export function applyStayExtension(trip: TripDoc, preview: StayExtensionPreview): TripDoc {
  const next = JSON.parse(JSON.stringify(trip)) as TripDoc;
  for (const change of preview.changes) {
    const match = /^d(\d+)s(\d+)$/.exec(change.activityId);
    if (!match) throw new Error('Invalid activity reference');
    const spot = next.days?.[Number(match[1])]?.spots?.[Number(match[2])];
    if (!spot || (spot.stayMin ?? 0) !== change.beforeStayMinutes) throw new Error('Stale stay extension');
    spot.stayMin = change.afterStayMinutes;
  }
  return next;
}
