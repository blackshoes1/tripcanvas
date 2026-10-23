import type { SavedDailyMoment } from '../../features/trip-state/domain/dailyMoments';

export interface DailyMomentRepository {
  list(tripId: string, dayKey: string): Promise<SavedDailyMoment[]>;
  /** Re-check trip revision and active membership under locks. Only this user/day is written. */
  save(input: { tripId: string; userId: string; expectedRevision: number; dayKey: string; spotKey: string | null; spotName: string | null }): Promise<void>;
}
