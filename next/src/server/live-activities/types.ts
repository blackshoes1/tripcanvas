import type { LiveActivityState } from '@/features/trip-state/domain/contract';
import type { TripDoc } from '@/features/trip-state/domain/todayView';

export const LIVE_ACTIVITY_LEASE_MS = 30_000;

export type ApnsEnvironment = 'sandbox' | 'production';
export interface LiveActivityTarget { pushToken: string; environment: ApnsEnvironment }
export interface LiveActivityUpdate {
  state: LiveActivityState;
  event: 'update' | 'end';
  at: Date;
  staleAt: Date | null;
  expiresAt: Date;
}
export type LiveActivitySendResult = { ok: true } | {
  ok: false; permanent: boolean; invalidToken?: boolean; retryAfterMs?: number; reason: string;
};
export type LiveActivitySender = (target: LiveActivityTarget, update: LiveActivityUpdate) => Promise<LiveActivitySendResult>;

export interface LiveActivityRegistration extends LiveActivityTarget {
  deviceId: string; activityId: string; tripId: string; startedAtISO: string; tokenRevision: number;
}
/** 기기 OS의 영역 진입/이탈 근거. 실제 기기 좌표는 보관하지 않는다. */
export interface LiveActivityArrivalEvidence {
  target: { dayIndex: number; activityId: string; revision: number };
  arrived: boolean;
  observedAtISO: string;
}
export interface LiveActivityArrival extends LiveActivityArrivalEvidence {
  deviceId: string; activityId: string; tripId: string; eventRevision: number;
}
export interface LiveActivityKey { userId: string; deviceId: string; activityId: string }
export interface LiveActivityClaim extends LiveActivityKey {
  leaseId: string; expiresAt: Date; failures: number; lastStateVersion: string | null;
}
export interface LiveActivityDelivery extends LiveActivityTarget {
  tripId: string; document: TripDoc; revision: number; updatedAt: string;
  jTone: 'FRIENDLY' | 'CASUAL' | 'POLITE';
  arrival?: LiveActivityArrivalEvidence | null;
}
export interface LiveActivityRepository {
  register(input: LiveActivityKey & LiveActivityTarget & {
    sessionId: string; tripId: string; startedAt: Date; expiresAt: Date; now: Date; tokenRevision: number;
  }): Promise<'registered' | 'ended' | 'limit' | 'unauthorized' | 'stale'>;
  stop(input: LiveActivityKey & { sessionId: string; now: Date }): Promise<void>;
  recordArrival(input: LiveActivityKey & {
    sessionId: string; tripId: string; arrival: LiveActivityArrivalEvidence; eventRevision: number; now: Date;
  }): Promise<'recorded' | 'missing' | 'ended' | 'unauthorized' | 'stale'>;
  readArrival(userId: string, deviceId: string, tripClientId: string, now: Date, sessionId: string): Promise<LiveActivityArrivalEvidence | null>;
  claimDue(now: Date, limit: number): Promise<LiveActivityClaim[]>;
  delivery(claim: LiveActivityClaim, now: Date): Promise<LiveActivityDelivery | null>;
  complete(claim: LiveActivityClaim, nextAt: Date, stateVersion: string | null, error?: string): Promise<void>;
  retry(claim: LiveActivityClaim, nextAt: Date, reason: string): Promise<void>;
  discard(claim: LiveActivityClaim, now: Date): Promise<void>;
}
