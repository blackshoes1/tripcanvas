import { describe, expect, it, vi } from 'vitest';

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
    id: '12345678',
    place_url: 'http://place.map.kakao.com/12345678',
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
    expect(place.provider).toBe('kakao');
    expect(place.providerId).toBe('12345678');
    expect(place.placeUrl).toBe('http://place.map.kakao.com/12345678');
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

  it('ID와 상세 링크가 없거나 부적절하면 만들어 내지 않는다', () => {
    for (const fields of [
      { id: undefined, place_url: undefined },
      { id: 'google-id', place_url: 'javascript:alert(1)' },
      { id: {}, place_url: 'https://place.map.kakao.com.evil.test/12345678' },
      { id: '', place_url: 'https://other.test/12345678' }
    ]) {
      const [place] = normalizeKakao([kakaoDocument(fields)]);
      expect(place.providerId).toBeNull();
      expect(place.placeUrl).toBeNull();
    }
  });

  it('좌표는 숫자로 읽히는 값만 인정한다', () => {
    expect(readPoint('33.5', '126.5')).toEqual({ lat: 33.5, lng: 126.5 });
    expect(readPoint('', '')).toBeNull();
    expect(readPoint(null, null)).toBeNull();
    expect(readPoint('91', '0')).toBeNull();
    expect(readPoint('0x21', '126.5')).toBeNull();
    expect(readPoint(true, 126.5)).toBeNull();
  });

  it('개수는 1~15로 자른다', () => {
    expect(clampLimit(undefined)).toBe(5);
    expect(clampLimit(null)).toBe(5);
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

  it('지도 업종 검색도 인증을 먼저 확인하고 제공처를 호출하지 않는다', async () => {
    const { impl, urls } = fetchReturning([]);
    const response = await routes('key', impl).search(request('category=cafe&bounds=33.4,126.4,33.6,126.6', 'bad'));
    expect(response.status).toBe(401);
    expect(urls).toEqual([]);
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
    expect(body.places[0].providerId).toBe('12345678');
    expect(urls[0]).toContain('size=3');
  });

  it.each([
    ['food', 'FD6', 'food'], ['cafe', 'CE7', 'cafe'],
    ['attraction', 'AT4', 'sight'], ['stay', 'AD5', 'stay']
  ])('검색어 없이 %s 분류와 화면 범위로 실제 업종 검색을 한다', async (category, code, spotCategory) => {
    const { impl, urls } = fetchReturning([kakaoDocument({ category_group_code: code })]);
    const response = await routes('key', impl).search(request(`category=${category}&bounds=33.4,126.4,33.6,126.6&limit=15`));
    expect(response.status).toBe(200);
    expect((await response.json()).places[0].category).toBe(spotCategory);
    const url = new URL(urls[0]);
    expect(url.pathname).toBe('/v2/local/search/category.json');
    expect(url.searchParams.get('category_group_code')).toBe(code);
    expect(url.searchParams.get('rect')).toBe('126.4,33.4,126.6,33.6');
    expect(url.searchParams.has('query')).toBe(false);
    expect(url.searchParams.has('radius')).toBe(false);
    expect(urls).toHaveLength(1);
  });

  it('검색어와 분류를 함께 보내면 키워드 검색에 실제 필터를 전달한다', async () => {
    const { impl, urls } = fetchReturning([kakaoDocument()]);
    const response = await routes('key', impl).search(request('q=스타벅스&category=cafe&bounds=33.4,126.4,33.6,126.6&lat=37.5&lng=127'));
    expect(response.status).toBe(200);
    const url = new URL(urls[0]);
    expect(url.pathname).toBe('/v2/local/search/keyword.json');
    expect(url.searchParams.get('query')).toBe('스타벅스');
    expect(url.searchParams.get('category_group_code')).toBe('CE7');
    expect(url.searchParams.get('rect')).toBe('126.4,33.4,126.6,33.6');
    expect(url.searchParams.has('radius')).toBe(false);
    expect(url.searchParams.has('x')).toBe(false);
  });

  it('제공처가 범위 밖이나 다른 분류를 반환해도 지도 탐색 결과에 섞지 않는다', async () => {
    const { impl } = fetchReturning([
      kakaoDocument(),
      kakaoDocument({ id: '2', y: '33.61' }),
      kakaoDocument({ id: '3', x: '126.39' }),
      kakaoDocument({ id: '4', category_group_code: 'FD6' }),
      kakaoDocument({ id: '5', y: '33.4', x: '126.4' }),
      kakaoDocument({ id: '6', y: '33.6', x: '126.6' })
    ]);
    const response = await routes('key', impl).search(request('category=cafe&bounds=33.4,126.4,33.6,126.6&limit=15'));
    const body = await response.json();
    expect(body.places.map((place: { providerId: string }) => place.providerId)).toEqual(['12345678', '5', '6']);
  });

  it('화면 검색이 비어도 전국 결과로 대체하지 않는다', async () => {
    const { impl, urls } = fetchReturning([]);
    const response = await routes('key', impl).search(request('q=카페&bounds=33.4,126.4,33.6,126.6&lat=33.5&lng=126.5'));
    expect(response.status).toBe(200);
    expect((await response.json()).places).toEqual([]);
    expect(urls).toHaveLength(1);
  });

  it.each([
    'category=cafe', 'bounds=33.4,126.4,33.6,126.6',
    'q=카페&category=bank', 'q=카페&category=',
    'q=카페&bounds=', 'q=카페&bounds=33.4,126.4,33.6',
    'q=카페&bounds=33.4,,33.6,126.6', 'q=카페&bounds=NaN,126.4,33.6,126.6',
    'q=카페&bounds=33.4,126.4,Infinity,126.6', 'q=카페&bounds=33.4,0x7e,33.6,126.6',
    'q=카페&bounds=-91,126.4,33.6,126.6', 'q=카페&bounds=33.4,126.4,33.6,181',
    'q=카페&bounds=33.6,126.4,33.4,126.6', 'q=카페&bounds=33.4,126.4,33.4,126.6',
    'q=카페&bounds=33.4,179,33.6,-179',
    'q=카페&lat=33.5', 'q=카페&lat=&lng=', 'q=카페&lat=91&lng=126.5',
    'q=카페&lat=33.5&lng=0x7e', 'q=카페&limit=Infinity', 'q=카페&limit=1.5',
    'q=카페&limit=99999999999999999999'
  ])('잘못된 요청은 제공처 호출 전에 400: %s', async query => {
    const { impl, urls } = fetchReturning([]);
    const response = await routes('key', impl).search(request(query));
    expect(response.status).toBe(400);
    expect((await response.json()).code).toBe('VALIDATION_ERROR');
    expect(urls).toEqual([]);
  });

  it('넓은 지도 영역을 몰래 좁히지 않고 확대를 안내한다', async () => {
    const { impl, urls } = fetchReturning([]);
    const response = await routes('key', impl).search(request('category=cafe&bounds=33,126,34,127'));
    expect(response.status).toBe(400);
    expect((await response.json()).message).toContain('확대');
    expect(urls).toEqual([]);
  });

  it('REST 키는 서버 요청 헤더로만 보내고 결과에는 포함하지 않는다', async () => {
    const impl = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ documents: [kakaoDocument()] })));
    const response = await routes('server-only-test-key', impl).search(request('category=cafe&bounds=33.4,126.4,33.6,126.6'));
    const [url, options] = impl.mock.calls[0];
    expect(options?.headers).toEqual({ Authorization: 'KakaoAK server-only-test-key' });
    expect(String(url)).not.toContain('server-only-test-key');
    expect(await response.text()).not.toContain('server-only-test-key');
  });

  it('업종 검색의 키 미설정과 제공처 응답 오류도 빈 장소로 표시하지 않는다', async () => {
    const query = 'category=cafe&bounds=33.4,126.4,33.6,126.6';
    expect((await routes('').search(request(query))).status).toBe(502);
    const malformed = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ error: 'unexpected' })));
    const response = await routes('key', malformed).search(request(query));
    expect(response.status).toBe(502);
    expect((await response.json()).code).toBe('UPSTREAM_ERROR');
  });
});

describe('GET /api/v1/places/details', () => {
  const request = (query: string, token = 'good') => new Request(`https://api.test/api/v1/places/details?${query}`, {
    headers: { authorization: `Bearer ${token}` }
  });

  it.each([['kakao', '12345678'], ['google', 'ChIJ_test_place']])('미연결인 %s 명소는 가격·예약 규정·확인 시각을 만들어 내지 않는다', async (provider, id) => {
    const fetchImpl = vi.fn<typeof fetch>();
    const routes = createPlaceRoutes({ verifier, kakaoRestKey: 'configured-search-key', fetchImpl });
    const response = await routes.details(request(`provider=${provider}&id=${id}`));
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toMatchObject({
      provider, providerId: id, status: 'NOT_CONNECTED', requirement: 'UNKNOWN', quote: null,
      sourceURL: null, checkedAt: null, stale: false
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('로그인 없이 명소 상세를 부를 수 없다', async () => {
    const routes = createPlaceRoutes({ verifier, kakaoRestKey: '' });
    expect((await routes.details(request('provider=kakao&id=12345', 'bad'))).status).toBe(401);
  });

  it.each([
    '', 'provider=kakao', 'provider=unknown&id=12345', 'provider=kakao&id=ChIJ_test',
    'provider=google&id=../../secret', 'provider=kakao&id=12345&id=67890',
    'provider=kakao&provider=google&id=12345', 'provider=kakao&id=12345,67890'
  ])('잘못된 장소 식별자나 일괄 조회를 거절한다: %s', async query => {
    const routes = createPlaceRoutes({ verifier, kakaoRestKey: '' });
    expect((await routes.details(request(query))).status).toBe(400);
  });
});
