// CORS(§72) — 정적 웹(tripcanvas-ai)과 API(tripcanvas-api)가 **다른 출처**라 웹이 API를 부르려면 필요하다.
// `*`를 쓰지 않는다: 허용 목록에 있는 출처만 그대로 되돌려 준다. 모르는 출처에는 헤더를 붙이지 않아 브라우저가 막는다.
import { describe, expect, it } from 'vitest';

import { allowedRequestHeaders, corsHeadersFor, DEFAULT_ORIGINS, preflightResponse, readAllowedOrigins } from './cors';

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

  it('빈 목록을 직접 넘기면 아무 출처도 열지 않는다', () => {
    expect(corsHeadersFor('https://tripcanvas-ai.vercel.app', [])).toEqual({ vary: 'Origin' });
  });

  it('와일드카드는 만들지 않는다', () => {
    const headers = corsHeadersFor('https://tripcanvas-ai.vercel.app', ALLOWED);
    expect(Object.values(headers)).not.toContain('*');
  });
});

describe('readAllowedOrigins', () => {
  it('설정이 없으면 이 앱의 알려진 웹 주소를 쓴다 — 배포할 때 뭘 설정하지 않아도 동작해야 한다', () => {
    expect(readAllowedOrigins({})).toEqual([...DEFAULT_ORIGINS]);
    expect(readAllowedOrigins({ TRUSTED_ORIGINS: '  ' })).toEqual([...DEFAULT_ORIGINS]);
    expect(readAllowedOrigins({}).some((o) => o.includes('tripcanvas-ai'))).toBe(true);
  });

  it('설정이 있으면 그것만 쓴다 — 기본값을 섞지 않는다', () => {
    expect(readAllowedOrigins({ TRUSTED_ORIGINS: 'https://staging.example.com' })).toEqual(['https://staging.example.com']);
  });

  it('기본값에도 와일드카드는 없다', () => {
    expect(readAllowedOrigins({})).not.toContain('*');
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

// ── 브라우저가 얹는 헤더 ──
// 여기서 지키는 것: **고정 목록 하나 때문에 요청이 통째로 막히지 않는다.**
// 개발자도구의 '캐시 사용 안 함'은 cache-control·pragma를 붙이고, 그러면 사용자에게는
// 원인 없는 CORS 오류로만 보인다(2026-09-07에 실제로 그랬다).
describe('allowedRequestHeaders', () => {
  it('보내겠다는 헤더를 그대로 허용한다', () => {
    expect(allowedRequestHeaders('authorization,content-type,cache-control,pragma'))
      .toBe('authorization, content-type, cache-control, pragma');
  });

  it('묻지 않으면 우리가 실제로 읽는 것만 답한다', () => {
    expect(allowedRequestHeaders(null)).toBe('Authorization, Content-Type');
    expect(allowedRequestHeaders('   ')).toBe('Authorization, Content-Type');
  });

  it('헤더 이름이 아닌 것은 되비추지 않는다', () => {
    expect(allowedRequestHeaders('authorization, <script>, "quoted"')).toBe('authorization');
    expect(allowedRequestHeaders('<script>')).toBe('Authorization, Content-Type');
  });

  it('아무리 많이 요구해도 상한이 있다', () => {
    const many = Array.from({ length: 60 }, (_, i) => `x-h${i}`).join(',');
    expect(allowedRequestHeaders(many).split(', ')).toHaveLength(24);
  });

  it('사전 요청이 요구한 헤더를 응답에 싣는다 — 이것이 막히면 저장이 통째로 안 된다', () => {
    const response = preflightResponse('https://tripcanvas-ai.vercel.app', ALLOWED, { headers: 'authorization,content-type,cache-control' });
    expect(response.headers.get('access-control-allow-headers')).toContain('cache-control');
  });

  it('모르는 출처에는 여전히 아무것도 열지 않는다', () => {
    const response = preflightResponse('https://evil.example.com', ALLOWED, { headers: 'authorization,cache-control' });
    expect(response.headers.get('access-control-allow-headers')).toBeNull();
    expect(response.headers.get('access-control-allow-origin')).toBeNull();
  });
});

// ── 사설망 신고(Private Network Access) ──
// 우리 API 주소는 보는 사람에 따라 사설 주소로 풀린다(tailnet 100.x · 집 공유기의 MagicDNS).
// 그때 Chrome은 "공개 페이지가 사설망을 부른다"고 보고 사전 요청에 신고를 붙인다 —
// 답하지 않으면 요청이 막히고, 사용자에게는 원인 없는 CORS 오류로만 보인다(2026-09-07).
describe('사설망 사전 요청', () => {
  it('신고가 오면 허용을 함께 답한다', () => {
    const response = preflightResponse('https://tripcanvas-ai.vercel.app', ALLOWED, { privateNetwork: true });
    expect(response.headers.get('access-control-allow-private-network')).toBe('true');
  });

  it('신고가 없으면 붙이지 않는다 — 묻지 않은 것에 답하지 않는다', () => {
    const response = preflightResponse('https://tripcanvas-ai.vercel.app', ALLOWED, {});
    expect(response.headers.get('access-control-allow-private-network')).toBeNull();
  });

  it('모르는 출처에는 사설망도 열지 않는다', () => {
    const response = preflightResponse('https://evil.example.com', ALLOWED, { privateNetwork: true });
    expect(response.headers.get('access-control-allow-private-network')).toBeNull();
    expect(response.headers.get('access-control-allow-origin')).toBeNull();
  });
});
