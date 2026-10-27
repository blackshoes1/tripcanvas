import lib from '@legacy/lib.js';
import type { TravelStateResponse } from '@/features/trip-state/domain/contract';
import { buildTravelState } from '@/features/trip-state/domain/travelState';
import { resolveClock } from '@/features/trip-state/services/handlerKit';
import { LIVE_ACTIVITY_LEASE_MS, type LiveActivityRepository, type LiveActivitySender } from './types';

/** 활동 시작·종료와 현지 자정만 일정 선택의 경계다. 일자 계산에 24시간을 더하지 않는다(DST). */
export function nextLiveActivityBoundary(state: TravelStateResponse, now: Date): Date | null {
  const day = state.today.day;
  const times: number[] = [];
  const add = (minutes: number) => {
    const iso = lib.zonedMinutesToISOString(day.date, Math.round(minutes), day.timeZone || 'UTC');
    const time = iso ? Date.parse(iso) : NaN;
    if (Number.isFinite(time) && time > now.getTime()) times.push(time);
  };
  for (const activity of state.today.activities) {
    if (activity.status === 'COMPLETED' || activity.status === 'SKIPPED') continue;
    add(activity.startMinutes);
    add(activity.endMinutes);
  }
  if (state.departure) add(state.departure.leaveMinutes);
  add(1440);
  return times.length ? new Date(Math.min(...times)) : null;
}

/** 호출당 bounded batch. HTTP2 재시도는 여기서 예약하며 sleep하지 않는다. */
export async function runLiveActivityBatch(deps: {
  repo: LiveActivityRepository; send: LiveActivitySender; now?: () => Date;
}): Promise<{ sent: number; failed: number }> {
  const stats = { sent: 0, failed: 0 };
  const claimedAt = deps.now?.() ?? new Date();
  const leaseDeadline = claimedAt.getTime() + LIVE_ACTIVITY_LEASE_MS;
  const claims = await deps.repo.claimDue(claimedAt, 10);
  // 전송 timeout(10초)보다 긴 30초 lease 안에 끝내도록 최대 10건을 함께 처리한다.
  const results = await Promise.allSettled(claims.map(async claim => {
    let now = deps.now?.() ?? new Date();
    try {
      if (claim.expiresAt <= now) { await deps.repo.discard(claim, now); return; }
      if (now.getTime() >= leaseDeadline) {
        await deps.repo.retry(claim, now, 'LeaseExpired'); return;
      }
      const delivery = await deps.repo.delivery(claim, now);
      if (!delivery) { await deps.repo.discard(claim, now); return; }
      now = deps.now?.() ?? new Date();
      if (now.getTime() >= leaseDeadline) {
        await deps.repo.retry(claim, now, 'LeaseExpired'); return;
      }
      const clock = resolveClock(delivery.document, null, new URL('http://worker.invalid'), now);
      const state = buildTravelState({ tripId: delivery.tripId, trip: delivery.document, revision: delivery.revision,
        updatedAt: delivery.updatedAt, ...clock, generatedAt: now.toISOString(), jTone: delivery.jTone, travelMode: true });
      const outsideTravel = !state.today.currentState.live;
      const boundary = outsideTravel ? null : nextLiveActivityBoundary(state, now);
      // 시간 경계에는 즉시, 다른 기기의 일정 수정은 최대 1분 뒤 확인한다. 외부 경로 제공자는 호출하지 않는다.
      const nextAt = new Date(Math.min(claim.expiresAt.getTime(), now.getTime() + 60_000, boundary?.getTime() ?? Infinity));
      if (!outsideTravel && state.stateVersion === claim.lastStateVersion) {
        await deps.repo.complete(claim, nextAt, state.stateVersion); return;
      }
      const content = outsideTravel ? { ...state.liveActivity, status: 'COMPLETED' as const,
        nextTitle: '일정 안내 종료', nextStartISO: null, travelMinutes: null, departureText: null,
        fixedTitle: null, fixedStartISO: null, scheduleElapsed: false } : state.liveActivity;
      const result = await deps.send(delivery, { state: content, event: outsideTravel ? 'end' : 'update', at: now,
        staleAt: boundary, expiresAt: claim.expiresAt });
      if (result.ok) {
        stats.sent++;
        if (outsideTravel) await deps.repo.discard(claim, now);
        else await deps.repo.complete(claim, nextAt, state.stateVersion);
      }
      else if (result.invalidToken) await deps.repo.discard(claim, now);
      else {
        stats.failed++;
        if (result.permanent) await deps.repo.complete(claim, claim.expiresAt, claim.lastStateVersion, result.reason);
        else await deps.repo.retry(claim, new Date(Math.min(claim.expiresAt.getTime(), now.getTime()
          + Math.max(5_000, result.retryAfterMs ?? Math.min(300_000, 30_000 * 2 ** Math.min(4, claim.failures))))), result.reason);
      }
    } catch {
      stats.failed++;
      // DB·전송 예외는 토큰·문서를 포함할 수 있다. 고정 코드만 저장한다.
      await deps.repo.retry(claim, new Date(Math.min(claim.expiresAt.getTime(), now.getTime() + 30_000)), 'WorkerError');
    }
  }));
  if (results.some(result => result.status === 'rejected')) throw new Error('WorkerError');
  return stats;
}
