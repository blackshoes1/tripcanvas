// GET /api/v1/places/search?q=&lat=&lng=&limit=&category=&bounds= — 국내 장소 검색 프록시.
//
// 앱이 이 라우트를 쓰는 이유는 하나다: **REST 키를 앱에 넣을 수 없다**(kakaoPlaceSearch 주석).
// 해외 검색은 여기 없다 — 앱이 번들 ID로 제한된 iOS 키로 구글에 직접 묻는다.
//
// 로그인해야 부를 수 있다. 우리 키로 나가는 요청이라 공개해 두면 남의 할당량이 아니라 우리 할당량이 준다.
import { CONTRACT_SCHEMA_VERSION } from '@/features/trip-state/domain/contract';
import { authenticate } from '../auth/authenticate';
import type { TokenVerifier } from '../auth/types';
import {
  boundsTooWide, clampLimit, readBounds, readPoint, readSearchCategory, searchKakaoPlaces, type PlaceResult
} from '../application/places/kakaoPlaceSearch';
import { ApiError, errorResponse, JSON_HEADERS } from './errors';
import { placeAdmissionDetails } from '../application/places/placeAdmissionDetails';

export interface PlaceSearchResponse {
  schemaVersion: number;
  provider: 'KAKAO';
  places: PlaceResult[];
}

export interface PlaceRouteDeps {
  verifier: TokenVerifier;
  /** 서버 전용 카카오 REST 키. 없으면 이 라우트는 '미연결'이라고 답한다 */
  kakaoRestKey: string;
  fetchImpl?: typeof fetch;
}

const MAX_QUERY_LENGTH = 100;

export function createPlaceRoutes(deps: PlaceRouteDeps) {
  return {
    /** 한 번에 명소 하나만, 사용자가 상세를 열 때 호출한다. 미연결을 무료/예약 불필요로 바꾸지 않는다. */
    async details(request: Request): Promise<Response> {
      try {
        await authenticate(request, deps.verifier);
        const params = new URL(request.url).searchParams;
        const provider = params.get('provider');
        const providerId = params.get('id');
        if ((provider !== 'kakao' && provider !== 'google') || !providerId ||
          params.getAll('provider').length !== 1 || params.getAll('id').length !== 1 ||
          !(provider === 'kakao' ? /^\d{1,20}$/ : /^[A-Za-z0-9_-]{5,200}$/).test(providerId)) {
          throw new ApiError('VALIDATION_ERROR', { message: '장소 제공자와 한 곳의 장소 ID가 필요합니다.' });
        }
        const body = { schemaVersion: CONTRACT_SCHEMA_VERSION, ...placeAdmissionDetails(provider, providerId) };
        return new Response(JSON.stringify(body), { status: 200, headers: JSON_HEADERS });
      } catch (e) {
        return errorResponse(e);
      }
    },
    async search(request: Request): Promise<Response> {
      try {
        await authenticate(request, deps.verifier);

        const params = new URL(request.url).searchParams;
        const query = (params.get('q') ?? '').trim();
        if (query.length > MAX_QUERY_LENGTH) {
          throw new ApiError('VALIDATION_ERROR', { message: '검색어가 너무 깁니다.' });
        }
        const category = params.has('category') ? readSearchCategory(params.get('category')!) : null;
        if (params.has('category') && !category) {
          throw new ApiError('VALIDATION_ERROR', { message: '지원하지 않는 장소 분류입니다.' });
        }
        const bounds = params.has('bounds') ? readBounds(params.get('bounds')!) : null;
        if (params.has('bounds') && !bounds) {
          throw new ApiError('VALIDATION_ERROR', { message: '지도 범위가 올바르지 않습니다. 날짜변경선을 넘는 범위는 국내 검색에서 지원하지 않습니다.' });
        }
        if (bounds && boundsTooWide(bounds)) {
          throw new ApiError('VALIDATION_ERROR', { message: '검색 범위가 너무 넓어요. 지도를 확대한 뒤 다시 찾아주세요.' });
        }
        if (!query && !(category && bounds)) {
          throw new ApiError('VALIDATION_ERROR', { message: '검색어(q) 또는 장소 분류와 지도 범위가 필요합니다.' });
        }
        const near = readPoint(params.get('lat'), params.get('lng'));
        if ((params.has('lat') || params.has('lng')) && !near) {
          throw new ApiError('VALIDATION_ERROR', { message: '검색 중심 좌표가 올바르지 않습니다.' });
        }
        if (params.has('limit') && (!/^-?\d+$/.test(params.get('limit')!) ||
          !Number.isSafeInteger(Number(params.get('limit'))))) {
          throw new ApiError('VALIDATION_ERROR', { message: '검색 개수는 정수여야 합니다.' });
        }
        const limit = clampLimit(params.get('limit'));
        // 키가 없으면 빈 결과를 주지 않는다 — "그런 장소가 없다"와 "검색을 못 한다"는 다른 말이다.
        if (!deps.kakaoRestKey) {
          throw new ApiError('UPSTREAM_ERROR', { message: '장소 검색이 연결되어 있지 않습니다.' });
        }

        let places: PlaceResult[];
        try {
          places = await searchKakaoPlaces(query, near, limit, {
            apiKey: deps.kakaoRestKey,
            fetchImpl: deps.fetchImpl
          }, { category: category ?? undefined, bounds: bounds ?? undefined });
        } catch (e) {
          console.error('[tripcanvas-api] 장소 검색 실패:', e instanceof Error ? e.message : e);
          throw new ApiError('UPSTREAM_ERROR', { message: '장소 검색이 지금 응답하지 않습니다.' });
        }

        const body: PlaceSearchResponse = { schemaVersion: CONTRACT_SCHEMA_VERSION, provider: 'KAKAO', places };
        return new Response(JSON.stringify(body), { status: 200, headers: JSON_HEADERS });
      } catch (e) {
        return errorResponse(e);
      }
    }
  };
}
