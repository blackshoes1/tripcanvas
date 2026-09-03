// CORS(§72) — 정적 웹(tripcanvas-ai)과 API(tripcanvas-api)가 **다른 출처**라 웹이 API를 부르려면 필요하다.
// `*`를 쓰지 않는다: 허용 목록에 있는 출처만 그대로 되돌려 준다. 모르는 출처에는 헤더를 붙이지 않아 브라우저가 막는다.
import { describe, expect, it } from 'vitest';

import { corsHeadersFor, preflightResponse } from './cors';

const ALLOWED = ['https://tripcanvas-ai.vercel.app', 'http://localhost:8000'];

describe('corsHeadersFor', () => {
  it('허용된 출처는 그대로 되돌려 주고 Vary를 붙인다 — 캐시가 출처를 섞지 않게', () => {
    expect(corsHeadersFor('https://tripcanvas-ai.vercel.app', ALLOWED)).toEqual({
      'access-control-allow-origin': 'https://tripcanvas-ai.vercel.app',
      'vary': 'Origin'
    });
  });

  it('모르는 출처에는 헤더를 붙이지 않는다 — 브라우저가 막는다', () => {
    expect(corsHeadersFor('https://evil.example.com', ALLOWED)).toEqual({ vary: 'Origin' });
    expect(corsHeadersFor('https://tripcanvas-ai.vercel.app.evil.com', ALLOWED)).toEqual({ vary: 'Origin' });
  });

  it('Origin이 없으면(같은 출처·앱에서 온 요청) 아무것도 하지 않는다', () => {
    expect(corsHeadersFor(null, ALLOWED)).toEqual({});
  });

  it('허용 목록이 비어 있으면 아무 출처도 열지 않는다 — 설정을 잊었을 때 조용히 전부 열리지 않게', () => {
    expect(corsHeadersFor('https://tripcanvas-ai.vercel.app', [])).toEqual({ vary: 'Origin' });
  });

  it('와일드카드는 만들지 않는다', () => {
    const headers = corsHeadersFor('https://tripcanvas-ai.vercel.app', ALLOWED);
    expect(Object.values(headers)).not.toContain('*');
  });
});

describe('preflightResponse', () => {
  it('허용된 출처의 사전 요청에는 204와 허용 메서드·헤더를 준다', async () => {
    const res = preflightResponse('https://tripcanvas-ai.vercel.app', ALLOWED);
    expect(res.status).toBe(204);
    expect(res.headers.get('access-control-allow-origin')).toBe('https://tripcanvas-ai.vercel.app');
    expect(res.headers.get('access-control-allow-methods')).toContain('PATCH');
    expect(res.headers.get('access-control-allow-headers')?.toLowerCase()).toContain('authorization');
    expect(Number(res.headers.get('access-control-max-age'))).toBeGreaterThan(0);
    expect(await res.text()).toBe('');
  });

  it('모르는 출처의 사전 요청은 허용 헤더 없이 끝난다', () => {
    const res = preflightResponse('https://evil.example.com', ALLOWED);
    expect(res.status).toBe(204);
    expect(res.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('쿠키를 허용하지 않는다 — /api/v1은 bearer 토큰만 쓴다', () => {
    const res = preflightResponse('https://tripcanvas-ai.vercel.app', ALLOWED);
    expect(res.headers.get('access-control-allow-credentials')).toBeNull();
  });
});
