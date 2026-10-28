import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LiveActivityClaim, LiveActivityDelivery, LiveActivityRepository, LiveActivitySender } from './types';
import { runLiveActivityBatch, nextLiveActivityBoundary } from './worker';
import { buildTravelState } from '@/features/trip-state/domain/travelState';
import { legRequestsFor, toLegCache } from '../routing/legFiller';
import type { Trip } from '@/features/trip/domain/types';

const at = (time: string) => new Date(`2026-10-27T${time}:00Z`);
const claim: LiveActivityClaim = { userId: 'u', deviceId: 'd', activityId: 'a', leaseId: 'lease',
  expiresAt: at('17:00'), failures: 0, lastStateVersion: null };
const delivery: LiveActivityDelivery = { tripId: 'trip', document: { name: '여행', start: '2026-10-27', timeZone: 'UTC',
  days: [{ startAt: '09:00', mode: 'walk', spots: [{ name: '오전', at: '09:00', stayMin: 60 },
    { name: '점심', at: '11:00', stayMin: 60 }] }] }, revision: 1, updatedAt: at('08:00').toISOString(),
  jTone: 'FRIENDLY', environment: 'sandbox', pushToken: 'ab'.repeat(32) };
let repo: LiveActivityRepository;
let send: LiveActivitySender;
beforeEach(() => {
  repo = { register: vi.fn(), stop: vi.fn(), claimDue: vi.fn().mockResolvedValue([claim]),
    delivery: vi.fn().mockResolvedValue(delivery), complete: vi.fn(), retry: vi.fn(), discard: vi.fn() };
  send = vi.fn().mockResolvedValue({ ok: true });
});

describe('앱이 닫힌 동안 현재 일정으로 전환하는 서버 worker', () => {
  it('방문 표시를 바꾸지 않고 현재 시각에 해당하는 장소를 발송한다', async () => {
    await runLiveActivityBatch({ repo, send, now: () => at('11:30') });
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ pushToken: delivery.pushToken }),
      expect.objectContaining({ state: expect.objectContaining({ nextTitle: '점심', status: 'IN_PROGRESS' }), event: 'update' }));
    expect(delivery.document.days![0].spots!.every(spot => !spot.status)).toBe(true);
    expect(repo.complete).toHaveBeenCalled();
  });
  it('로그아웃·권한 회수·만료된 lease는 보내지 않고 제거한다', async () => {
    vi.mocked(repo.delivery).mockResolvedValue(null);
    await runLiveActivityBatch({ repo, send, now: () => at('11:30') });
    expect(send).not.toHaveBeenCalled();
    expect(repo.discard).toHaveBeenCalledWith(claim, at('11:30'));
  });
  it('8시간이 지난 활동에는 보내지 않는다', async () => {
    await runLiveActivityBatch({ repo, send, now: () => at('17:00') });
    expect(repo.delivery).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
    expect(repo.discard).toHaveBeenCalled();
  });
  it('동일한 상태는 push를 반복하지 않되 다음 경계 예약을 보존한다', async () => {
    await runLiveActivityBatch({ repo, send, now: () => at('11:30') });
    const stateVersion = vi.mocked(send).mock.calls[0][1].state.stateVersion;
    vi.mocked(repo.claimDue).mockResolvedValue([{ ...claim, lastStateVersion: stateVersion }]);
    vi.mocked(send).mockClear();
    await runLiveActivityBatch({ repo, send, now: () => at('11:31') });
    expect(send).not.toHaveBeenCalled();
    expect(repo.complete).toHaveBeenLastCalledWith(expect.anything(), at('11:32'), stateVersion);
  });
  it('전부 지난 미방문 일정도 end를 보내고 등록을 종료한다', async () => {
    await runLiveActivityBatch({ repo, send, now: () => at('13:00') });
    expect(vi.mocked(send).mock.calls[0][1]).toMatchObject({ event: 'end', staleAt: null,
      state: { shouldEnd: true, status: 'COMPLETED', nextTitle: '일정 안내 종료', nextStartISO: null } });
    expect(repo.discard).toHaveBeenCalledWith(claim, at('13:00'));
    expect(delivery.document.days![0].spots!.every(spot => !spot.status)).toBe(true);
  });
  it.each(['11:59', '12:00'])('마지막 일정의 종료 경계를 지킨다: %s', async time => {
    await runLiveActivityBatch({ repo, send, now: () => at(time) });
    const ended = time === '12:00';
    expect(vi.mocked(send).mock.calls[0][1].event).toBe(ended ? 'end' : 'update');
    expect(vi.mocked(repo.discard).mock.calls).toHaveLength(ended ? 1 : 0);
  });
  it('현재 일정이 없어도 뒤에 미래 일정이 남은 공백에는 종료하지 않는다', async () => {
    await runLiveActivityBatch({ repo, send, now: () => at('10:30') });
    expect(vi.mocked(send).mock.calls[0][1]).toMatchObject({ event: 'update', state: { nextTitle: '점심' } });
    expect(repo.discard).not.toHaveBeenCalled();
  });
  it.each([['COMPLETED', 'COMPLETED'], ['SKIPPED', 'SKIPPED'], ['COMPLETED', 'SKIPPED']])(
    '종료 시각 전에도 모두 처리한 날은 종료한다: %s/%s', async (first, second) => {
      const copy = structuredClone(delivery);
      copy.document.days![0].spots![0].status = first;
      copy.document.days![0].spots![1].status = second;
      vi.mocked(repo.delivery).mockResolvedValue(copy);
      await runLiveActivityBatch({ repo, send, now: () => at('09:30') });
      expect(vi.mocked(send).mock.calls[0][1].event).toBe('end');
      expect(repo.discard).toHaveBeenCalledWith(claim, at('09:30'));
    });
  it('이미 같은 종료 지문을 갱신했어도 end 발송을 생략하지 않는다', async () => {
    const state = buildTravelState({ tripId: delivery.tripId, trip: delivery.document, revision: 1,
      updatedAt: delivery.updatedAt, todayISO: '2026-10-27', nowMinutes: 780, travelMode: true });
    vi.mocked(repo.claimDue).mockResolvedValue([{ ...claim, lastStateVersion: state.stateVersion }]);
    await runLiveActivityBatch({ repo, send, now: () => at('13:00') });
    expect(send).toHaveBeenCalledOnce();
    expect(vi.mocked(send).mock.calls[0][1].event).toBe('end');
    expect(repo.discard).toHaveBeenCalled();
  });
  it('end 전송이 일시 실패하면 등록을 남겨 재시도하고 수락 후에 종료한다', async () => {
    vi.mocked(send).mockResolvedValueOnce({ ok: false, permanent: false, reason: 'ServiceUnavailable' });
    await runLiveActivityBatch({ repo, send, now: () => at('13:00') });
    expect(repo.retry).toHaveBeenCalled();
    expect(repo.discard).not.toHaveBeenCalled();
    await runLiveActivityBatch({ repo, send, now: () => at('13:01') });
    expect(vi.mocked(send).mock.calls.every(call => call[1].event === 'end')).toBe(true);
    expect(repo.discard).toHaveBeenCalledWith(claim, at('13:01'));
  });
  it('APNs가 지정한 지연을 존중하고 토큰 오류만 등록을 폐기한다', async () => {
    vi.mocked(send).mockResolvedValue({ ok: false, permanent: false, retryAfterMs: 900_000, reason: 'ServiceUnavailable' });
    await runLiveActivityBatch({ repo, send, now: () => at('11:30') });
    expect(repo.retry).toHaveBeenCalledWith(claim, at('11:45'), 'ServiceUnavailable');
    vi.mocked(send).mockResolvedValue({ ok: false, permanent: true, invalidToken: true, reason: 'Unregistered' });
    await runLiveActivityBatch({ repo, send, now: () => at('11:30') });
    expect(repo.discard).toHaveBeenCalled();
  });
  it('잘못된 payload는 토큰을 지우지 않고 자동 재발송을 중단한다', async () => {
    vi.mocked(send).mockResolvedValue({ ok: false, permanent: true, reason: 'PayloadTooLarge' });
    await runLiveActivityBatch({ repo, send, now: () => at('11:30') });
    expect(repo.discard).not.toHaveBeenCalled();
    expect(repo.complete).toHaveBeenCalledWith(claim, claim.expiresAt, null, 'PayloadTooLarge');
  });
  it('예외에 토큰이 들어 있어도 저장할 진단에는 고정 오류 이름만 쓴다', async () => {
    vi.mocked(send).mockRejectedValue(new Error(delivery.pushToken));
    await runLiveActivityBatch({ repo, send, now: () => at('11:30') });
    expect(repo.retry).toHaveBeenCalledWith(claim, expect.any(Date), 'WorkerError');
  });
});

describe('다음 경계 시각', () => {
  const response = () => buildTravelState({ tripId: delivery.tripId, trip: delivery.document, revision: 1,
    updatedAt: delivery.updatedAt, todayISO: '2026-10-27', nowMinutes: 9 * 60, travelMode: true });
  it('현재 장소의 종료 경계에서 깨어나며 완료된 장소의 경계는 쓰지 않는다', () => {
    expect(nextLiveActivityBoundary(response(), at('09:59'))).toEqual(at('10:00'));
    const completed = response();
    completed.today.activities[0].status = 'COMPLETED';
    expect(nextLiveActivityBoundary(completed, at('09:59'))).toEqual(at('11:00'));
  });
  it('활동 중에는 현지 자정을 다음 날 계산의 경계로 둔다', () => {
    const result = response();
    expect(nextLiveActivityBoundary(result, at('23:59'))).toEqual(new Date('2026-10-28T00:00:00Z'));
  });
  it('DST 자정은 하루 24시간 가산 대신 현지 시간대로 계산한다', () => {
    const result = response();
    result.today.day.date = '2026-10-25';
    result.today.day.timeZone = 'Europe/Madrid';
    expect(nextLiveActivityBoundary(result, new Date('2026-10-25T22:30:00Z'))).toEqual(new Date('2026-10-25T23:00:00Z'));
  });
});

describe('worker의 실제 발송 시각·여행기간·병렬 lease', () => {
  it('claim 뒤에도 현재 시각을 다시 읽어 경계를 지난 일정으로 보낸다', async () => {
    const clock = vi.fn().mockReturnValueOnce(new Date('2026-10-27T10:59:59Z')).mockReturnValue(at('11:00'));
    await runLiveActivityBatch({ repo, send, now: clock });
    expect(repo.delivery).toHaveBeenCalledWith(claim, at('11:00'));
    expect(vi.mocked(send).mock.calls[0][1]).toMatchObject({ at: at('11:00'), state: { nextTitle: '점심', status: 'IN_PROGRESS' } });
  });
  it('claim 응답 자체가 lease보다 늦으면 유효한 등록을 종료하지 않고 재예약한다', async () => {
    const late = new Date('2026-10-27T11:30:31Z');
    const clock = vi.fn().mockReturnValueOnce(at('11:30')).mockReturnValue(late);
    await runLiveActivityBatch({ repo, send, now: clock });
    expect(repo.delivery).not.toHaveBeenCalled();
    expect(repo.discard).not.toHaveBeenCalled();
    expect(repo.retry).toHaveBeenCalledWith(claim, late, 'LeaseExpired');
  });
  it('권한 조회가 lease 기한을 넘겨 반환되면 발송하지 않고 재예약한다', async () => {
    const late = new Date('2026-10-27T11:30:31Z');
    const clock = vi.fn().mockReturnValueOnce(at('11:30')).mockReturnValueOnce(at('11:30')).mockReturnValue(late);
    await runLiveActivityBatch({ repo, send, now: clock });
    expect(send).not.toHaveBeenCalled();
    expect(repo.retry).toHaveBeenCalledWith(claim, late, 'LeaseExpired');
  });
  it('느린 첫 전송이 뒤 claim을 lease 만료까지 가로막지 않는다', async () => {
    vi.mocked(repo.claimDue).mockResolvedValue([claim, { ...claim, activityId: 'b' }]);
    let release: () => void = () => {};
    const pending = new Promise<void>(resolve => { release = resolve; });
    vi.mocked(send).mockImplementationOnce(async () => { await pending; return { ok: true }; });
    const batch = runLiveActivityBatch({ repo, send, now: () => at('11:30') });
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(2));
    release(); await batch;
  });
  it.each(['2026-10-28T00:00:00Z', '2026-10-26T23:00:00Z'])('여행 기간 밖에서는 Day1 미리보기로 돌아가지 않고 종료한다: %s', async iso => {
    const instant = new Date(iso);
    vi.mocked(repo.claimDue).mockResolvedValue([{ ...claim, expiresAt: new Date(instant.getTime() + 3_600_000) }]);
    await runLiveActivityBatch({ repo, send, now: () => instant });
    expect(vi.mocked(send).mock.calls[0][1]).toMatchObject({ event: 'end', state: { nextTitle: '일정 안내 종료', nextStartISO: null } });
    expect(repo.discard).toHaveBeenCalled();
  });
  it('여행 중 자정에는 다음 날 일정과 Day2를 발송한다', async () => {
    vi.mocked(repo.delivery).mockResolvedValue({ ...delivery, document: { ...delivery.document,
      days: [...delivery.document.days!, { startAt: '09:00', spots: [{ name: '다음 날 장소', at: '09:00', stayMin: 60 }] }] } });
    const instant = new Date('2026-10-28T00:00:00Z');
    vi.mocked(repo.claimDue).mockResolvedValue([{ ...claim, expiresAt: new Date(instant.getTime() + 3_600_000) }]);
    await runLiveActivityBatch({ repo, send, now: () => instant });
    expect(vi.mocked(send).mock.calls[0][1]).toMatchObject({ event: 'update', state: { nextTitle: '다음 날 장소', dayLabel: 'Day 2' } });
  });
});

it('worker 결과는 실제 APNs 수락과 운영 실패를 빈 batch와 구분한다', async () => {
  expect(await runLiveActivityBatch({ repo, send, now: () => at('11:30') })).toEqual({ sent: 1, failed: 0 });
  vi.mocked(send).mockResolvedValue({ ok: false, permanent: false, reason: 'InvalidProviderToken' });
  expect(await runLiveActivityBatch({ repo, send, now: () => at('11:30') })).toEqual({ sent: 0, failed: 1 });
  vi.mocked(repo.claimDue).mockResolvedValue([]);
  expect(await runLiveActivityBatch({ repo, send, now: () => at('11:30') })).toEqual({ sent: 0, failed: 0 });
});


it('백그라운드도 기존 도로 캐시로 API와 같은 현재 장소·이동시간을 보낸다', async () => {
  const document = { name: '경로 회귀', start: '2026-10-27', timeZone: 'UTC', days: [{ startAt: '09:00', mode: 'walk', spots: [
    { name: '출발 장소', lat: 40, lng: -3, at: '09:00', stayMin: 60, status: 'COMPLETED' },
    { name: '도로 경유 장소', lat: 40.0067, lng: -3, stayMin: 30 },
    { name: '오후 예약', lat: 40.0067, lng: -3, at: '12:00', stayMin: 60 }
  ] }] };
  const key = legRequestsFor(document as unknown as Trip, 0)[0].key;
  const legCache = toLegCache([{ key, sec: 1800, m: 2000, path: null, taxi: null, snapped: false,
    fail: false, provider: 'google', fetchedAt: at('08:00') }]);
  const input = { tripId: delivery.tripId, trip: document, revision: delivery.revision, updatedAt: delivery.updatedAt,
    todayISO: '2026-10-27', nowMinutes: 645, generatedAt: at('10:45').toISOString(), jTone: delivery.jTone, travelMode: true };
  expect(buildTravelState(input).liveActivity.nextTitle).toBe('오후 예약');
  const expected = buildTravelState({ ...input, legCache });
  expect(expected.liveActivity).toMatchObject({ nextTitle: '도로 경유 장소', status: 'IN_PROGRESS' });
  vi.mocked(repo.delivery).mockResolvedValue({ ...delivery, document });
  const cachedLegs = vi.fn().mockResolvedValue(legCache);
  await runLiveActivityBatch({ repo, send, now: () => at('10:45'), cachedLegs });
  expect(cachedLegs).toHaveBeenCalledWith(document, 0);
  expect(vi.mocked(send).mock.calls[0][1].state).toEqual(expected.liveActivity);
});
