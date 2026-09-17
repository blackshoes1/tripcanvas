// 점검 모드에서 지키는 것: 읽기는 그대로, 쓰기는 503 MAINTENANCE — 404도 200도 아니다(클라이언트가 재생성·덮어쓰기를 한다).
import { describe, expect, it } from 'vitest';

import { blocksWrite, isReadOnly, maintenanceResponse } from './maintenance';

describe('maintenance', () => {
  it('TC_READ_ONLY가 없거나 이상하면 꺼져 있다 — 평소 배포를 바꾸지 않는다', () => {
    expect(isReadOnly({})).toBe(false);
    expect(isReadOnly({ TC_READ_ONLY: '' })).toBe(false);
    expect(isReadOnly({ TC_READ_ONLY: 'yes please' })).toBe(false);
    for (const v of ['1', 'true', 'ON', ' on ']) expect(isReadOnly({ TC_READ_ONLY: v })).toBe(true);
  });

  it('쓰기만 막는다 — 읽기·사전 요청·헬스는 지나간다', () => {
    expect(blocksWrite('PUT', '/api/v1/trips/abc')).toBe(true);
    expect(blocksWrite('POST', '/api/auth/sign-in/email')).toBe(true);
    expect(blocksWrite('DELETE', '/api/v1/trips/abc')).toBe(true);
    expect(blocksWrite('patch', '/api/v1/trips/abc/members/1')).toBe(true);
    expect(blocksWrite('GET', '/api/v1/trips')).toBe(false);
    expect(blocksWrite('GET', '/api/auth/get-session')).toBe(false);
    expect(blocksWrite('OPTIONS', '/api/v1/trips')).toBe(false);
    expect(blocksWrite('POST', '/api/health')).toBe(false);
    expect(blocksWrite('POST', '/api/kakao-directions')).toBe(false);
  });

  it('503 + 계약 본문 + retry-after + CORS. 문장에 편집이 남는다는 말이 있다', async () => {
    const res = maintenanceResponse('https://tripcanvas-ai.vercel.app', ['https://tripcanvas-ai.vercel.app']);
    expect(res.status).toBe(503);
    expect(res.headers.get('retry-after')).toBe('120');
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(res.headers.get('access-control-allow-origin')).toBe('https://tripcanvas-ai.vercel.app');
    const body = await res.json();
    expect(body).toMatchObject({ code: 'MAINTENANCE', error: 'MAINTENANCE' });
    expect(body.message).toMatch(/편집/);
  });

  it('허용되지 않은 출처에는 CORS 헤더를 주지 않는다 — 점검 모드가 출처 규칙을 느슨하게 만들지 않는다', () => {
    const res = maintenanceResponse('https://evil.example', ['https://tripcanvas-ai.vercel.app']);
    expect(res.headers.get('access-control-allow-origin')).toBeNull();
    expect(res.status).toBe(503);
  });
});
