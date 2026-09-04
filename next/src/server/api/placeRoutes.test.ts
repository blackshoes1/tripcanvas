import { describe, expect, it } from 'vitest';

import { clampLimit, kakaoParams, normalizeKakao, readPoint, searchKakaoPlaces } from '../application/places/kakaoPlaceSearch';
import { createPlaceRoutes } from './placeRoutes';
import type { RequestContext, TokenVerifier } from '../auth/types';

// 검증 실패는 예외가 아니라 null이다(TokenVerifier 계약) — authenticate가 그걸 401로 옮긴다.
const verifier: TokenVerifier = {
  async verify(token: string): Promise<RequestContext | null> {
    if (token !== 'good') return null;
    return { userId: 'u1', legacySupabaseUserId: null, email: 'a@b.c', sessionId: null, tokenSource: 'tripcanvas' };
  }
};

function kakaoDocument(overrides: Record<string, unknown> = {}) {
  return {
    place_name: '스타벅스 제주점',
    address_name: '제주특별자치도 제주시 연동 123',
    road_address_name: '제주 제주시 노연로 1',
    category_group_code: 'CE7',
    x: '126.4917',
    y: '33.4996',
    ...overrides
  };
}

function fetchReturning(documents: unknown[], status = 200): { impl: typeof fetch; urls: string[] } {
  const urls: string[] = [];
  const impl = (async (url: string | URL) => {
    urls.push(String(url));
    return new Response(JSON.stringify({ documents }), { status });
  }) as unknown as typeof fetch;
  return { impl, urls };
}

describe('카카오 장소 검색 정규화', () => {
  it('웹과 같은 필드를 만든다 — 도시·카테고리 판정은 lib.js가 한다', () => {
    const [place] = normalizeKakao([kakaoDocument()]);
    expect(place.name).toBe('스타벅스 제주점');
    expect(place.address).toBe('제주 제주시 노연로 1');
    expect(place.city).toBe('제주');
    expect(place.category).toBe('cafe');
    expect(place.lat).toBeCloseTo(33.4996);
    expect(place.lng).toBeCloseTo(126.4917);
  });

  it('좌표나 이름이 없는 항목은 버린다 — 담아도 동선에 못 쓴다', () => {
    const places = normalizeKakao([
      kakaoDocument({ x: '', y: '' }),
      kakaoDocument({ place_name: '   ' }),
      kakaoDocument()
    ]);
    expect(places).toHaveLength(1);
  });

  it('모르는 분류는 추론하지 않고 null로 둔다', () => {
    expect(normalizeKakao([kakaoDocument({ category_group_code: 'ZZ9' })])[0].category).toBeNull();
  });

  it('좌표는 숫자로 읽히는 값만 인정한다', () => {
    expect(readPoint('33.5', '126.5')).toEqual({ lat: 33.5, lng: 126.5 });
    expect(readPoint('', '')).toBeNull();
    expect(readPoint(null, null)).toBeNull();
    expect(readPoint('91', '0')).toBeNull();
  });

  it('개수는 1~15로 자른다', () => {
    expect(clampLimit(undefined)).toBe(5);
    expect(clampLimit('99')).toBe(15);
    expect(clampLimit('0')).toBe(1);
  });

  it('앵커가 있으면 반경을 실어 보낸다', () => {
    const withNear = kakaoParams('카페', { lat: 33.5, lng: 126.5 }, 5);
    expect(withNear.get('radius')).toBe('20000');
    expect(withNear.get('y')).toBe('33.5');
    expect(kakaoParams('카페', null, 5).get('radius')).toBeNull();
  });

  it('근처에서 못 찾으면 전국에서 다시 찾는다(웹과 같은 순서)', async () => {
    const urls: string[] = [];
    const impl = (async (url: string | URL) => {
      urls.push(String(url));
      const documents = urls.length === 1 ? [] : [kakaoDocument()];
      return new Response(JSON.stringify({ documents }), { status: 200 });
    }) as unknown as typeof fetch;

    const places = await searchKakaoPlaces('스타벅스', { lat: 33.5, lng: 126.5 }, 5, { apiKey: 'k', fetchImpl: impl });
    expect(places).toHaveLength(1);
    expect(urls).toHaveLength(2);
    expect(urls[0]).toContain('radius=20000');
    expect(urls[1]).not.toContain('radius=');
  });
});

describe('GET /api/v1/places/search', () => {
  const routes = (kakaoRestKey: string, fetchImpl?: typeof fetch) =>
    createPlaceRoutes({ verifier, kakaoRestKey, fetchImpl });

  const request = (query: string, token = 'good') =>
    new Request(`https://api.test/api/v1/places/search?${query}`, {
      headers: { authorization: `Bearer ${token}` }
    });

  it('로그인해야 부를 수 있다 — 우리 키로 나가는 요청이다', async () => {
    const response = await routes('key').search(request('q=카페', 'bad'));
    expect(response.status).toBe(401);
  });

  it('검색어가 없으면 400', async () => {
    const response = await routes('key').search(request('q='));
    expect(response.status).toBe(400);
  });

  it('키가 없으면 빈 결과가 아니라 미연결이라고 답한다', async () => {
    const response = await routes('').search(request('q=카페'));
    expect(response.status).toBe(502);
    expect((await response.json()).message).toContain('연결');
  });

  it('업스트림이 실패하면 502 — 빈 목록으로 뭉개지 않는다', async () => {
    const { impl } = fetchReturning([], 500);
    const response = await routes('key', impl).search(request('q=카페'));
    expect(response.status).toBe(502);
  });

  it('찾은 장소를 그대로 준다', async () => {
    const { impl, urls } = fetchReturning([kakaoDocument()]);
    const response = await routes('key', impl).search(request('q=스타벅스&lat=33.5&lng=126.5&limit=3'));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.provider).toBe('KAKAO');
    expect(body.places[0].city).toBe('제주');
    expect(urls[0]).toContain('size=3');
  });
});
