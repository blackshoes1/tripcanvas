// 오류 계약(§29·§30) — HTTP 상태와 도메인 오류를 구분하고, 본문은 웹·iOS가 같은 모양으로 읽는다.
import { describe, expect, it } from 'vitest';

import { ApiError, errorResponse } from './errors';

describe('ApiError', () => {
  it('코드마다 HTTP 상태가 정해져 있다', () => {
    expect(new ApiError('UNAUTHORIZED').status).toBe(401);
    expect(new ApiError('FORBIDDEN').status).toBe(403);
    expect(new ApiError('NOT_FOUND').status).toBe(404);
    expect(new ApiError('VALIDATION_ERROR').status).toBe(400);
    expect(new ApiError('CONFLICT').status).toBe(409);
    expect(new ApiError('STALE_VERSION').status).toBe(409);
    expect(new ApiError('RATE_LIMITED').status).toBe(429);
    expect(new ApiError('INTERNAL_ERROR').status).toBe(500);
  });

  it('본문은 code·message에 더해 구버전 iOS가 읽는 error 필드를 같은 값으로 싣는다', async () => {
    const res = errorResponse(new ApiError('STALE_VERSION', { details: { revision: 7 } }));
    expect(res.status).toBe(409);
    expect(res.headers.get('content-type')).toMatch(/application\/json/);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const body = await res.json();
    expect(body.code).toBe('STALE_VERSION');
    expect(body.error).toBe('STALE_VERSION');
    expect(typeof body.message).toBe('string');
    expect(body.message.length).toBeGreaterThan(0);
    expect(body.details).toEqual({ revision: 7 });
    // revision은 기존 계약(ApiError.revision)이 최상위에서 읽는다 — 그대로 둔다
    expect(body.revision).toBe(7);
  });

  it('메시지를 주면 기본 문구 대신 그것을 쓴다', async () => {
    const body = await errorResponse(new ApiError('VALIDATION_ERROR', { message: 'trip.days가 비어 있습니다.' })).json();
    expect(body.message).toBe('trip.days가 비어 있습니다.');
  });

  it('ApiError가 아닌 예외는 INTERNAL_ERROR 500이고 내부 메시지를 밖으로 내보내지 않는다', async () => {
    const res = errorResponse(new Error('connect ECONNREFUSED 10.0.0.5:5432'));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.code).toBe('INTERNAL_ERROR');
    expect(body.message).not.toMatch(/ECONNREFUSED/);
  });
});
