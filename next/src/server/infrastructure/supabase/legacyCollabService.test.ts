import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { RequestContext } from '../../auth/types';
import { LegacySupabaseCollabService } from './legacyCollabService';

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('./legacyTripRepository', () => ({ supabaseForToken: () => ({ rpc }) }));

const ctx: RequestContext = {
  userId: 'user', legacySupabaseUserId: 'user', email: null, sessionId: null, tokenSource: 'supabase'
};

beforeEach(() => { rpc.mockReset(); });

describe('레거시 후보 저장 호환', () => {
  it('새 장소 제공자 정보를 저장할 수 없으면 조용히 버리지 않고 거절한다', async () => {
    const service = new LegacySupabaseCollabService('synthetic-token', 'https://example.invalid');
    await expect(service.addCandidate(ctx, 'trip1', { title: '카페', provider: 'kakao', providerId: '12345' }))
      .rejects.toMatchObject({ code: 'UPSTREAM_ERROR' });
    expect(rpc).not.toHaveBeenCalled();
  });

  it('기존 후보는 원래 RPC와 반환 ID를 그대로 사용한다', async () => {
    rpc.mockResolvedValue({ data: '42', error: null });
    const service = new LegacySupabaseCollabService('synthetic-token', 'https://example.invalid');
    expect(await service.addCandidate(ctx, 'trip1', { title: '카페', place_id: 'ChIJ_test_place', lat: 37.5, lng: 127 })).toBe(42);
    expect(rpc).toHaveBeenCalledWith('add_trip_candidate', {
      p_client_id: 'trip1', p_title: '카페', p_place_id: 'ChIJ_test_place', p_lat: 37.5, p_lng: 127,
      p_addr: null, p_note: null, p_url: null
    });
  });

  it('멱등 요청 키도 지원하지 않으면 재시도 중복을 만들지 않고 거절한다', async () => {
    const service = new LegacySupabaseCollabService('synthetic-token', 'https://example.invalid');
    await expect(service.addCandidate(ctx, 'trip1', { title: '직접 입력', clientKey: '11111111-1111-4111-8111-111111111111' }))
      .rejects.toMatchObject({ code: 'UPSTREAM_ERROR' });
    expect(rpc).not.toHaveBeenCalled();
  });
});
