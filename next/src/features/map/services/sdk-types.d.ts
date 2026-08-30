// 지도 SDK 전역 최소 선언 — MapView 어댑터가 실제로 호출하는 표면만 구조적으로 선언한다.
// (공식 타입 패키지를 들이지 않는 이유: 읽기 뷰 어댑터는 호출 몇 개뿐이고, 레거시와 같은
//  CDN 전역 로딩이라 모듈 타입과 어긋난다. Phase 6 확장 시 @types/google.maps 도입 검토.)

declare namespace google.maps {
  class Map {
    constructor(el: HTMLElement, opts?: Record<string, unknown>);
    fitBounds(bounds: LatLngBounds, padding?: number): void;
    getZoom(): number | undefined;
    setZoom(zoom: number): void;
    panTo(p: { lat: number; lng: number }): void;
    /** 지도 탭 (Phase 6d) — POI 아이콘을 누르면 placeId가 실려 온다 */
    addListener(ev: 'click', cb: (e: MapMouseEvent) => void): void;
    addListener(ev: 'dblclick' | 'drag', cb: () => void): void;
  }
  interface MapMouseEvent {
    latLng: { lat(): number; lng(): number };
    /** POI 아이콘을 탭했을 때만 채워진다 */
    placeId?: string;
    stop?: () => void;
  }
  class LatLngBounds {
    extend(p: { lat: number; lng: number }): void;
  }
  class Polyline {
    constructor(opts: Record<string, unknown>);
    setMap(m: Map | null): void;
  }
  namespace marker {
    class AdvancedMarkerElement {
      constructor(opts: { map: Map; position: { lat: number; lng: number }; content?: HTMLElement; zIndex?: number });
      map: Map | null;
      /** 재생 마커는 매 프레임 위치만 바꾼다 (Phase 6f) */
      position: { lat: number; lng: number } | null;
      addEventListener(type: 'gmp-click', cb: () => void): void;
    }
  }
  namespace event {
    function addListenerOnce(m: Map, ev: string, cb: () => void): void;
    function trigger(m: Map, ev: string): void;
  }
  /** 신 Places API는 동적 로드 — 초기 libraries에 없어도 필요할 때 받아온다 (Phase 6c 검색) */
  function importLibrary(name: 'places'): Promise<{
    Place: typeof places.Place;
    SearchNearbyRankPreference?: { DISTANCE?: unknown };
  }>;
  namespace places {
    class Place {
      constructor(opts: { id: string; requestedLanguage?: string });
      static searchByText(req: Record<string, unknown>): Promise<{ places: PlaceLike[] | null }>;
      /** 좌표만 있을 때의 최후 수단 (Phase 6d) */
      static searchNearby(req: Record<string, unknown>): Promise<{ places: PlaceLike[] | null }>;
      fetchFields(req: { fields: string[] }): Promise<{ place?: PlaceLike }>;
      /** fetchFields는 인스턴스 자신도 채운다 — 레거시가 r.place ?? place로 폴백하는 이유 */
      displayName?: unknown;
      formattedAddress?: string;
      addressComponents?: unknown;
    }
    interface PlaceLike {
      id?: string;
      displayName?: unknown;
      formattedAddress?: string;
      addressComponents?: unknown;
      regularOpeningHours?: unknown;
      primaryType?: unknown;
      types?: unknown;
      location: { lat(): number; lng(): number };
    }
  }
  class Geocoder {
    geocode(
      req: { address: string },
      cb: (r: { geometry: { location: { lat(): number; lng(): number } } }[] | null, status: string) => void
    ): void;
  }
}

declare namespace kakao.maps {
  function load(cb: () => void): void;
  class LatLng {
    constructor(lat: number, lng: number);
  }
  class LatLngBounds {
    extend(p: LatLng): void;
    getSouthWest(): LatLng2;
    getNorthEast(): LatLng2;
  }
  /** SDK가 돌려주는 좌표 — 생성자 인자와 달리 게터로 읽는다 */
  interface LatLng2 {
    getLat(): number;
    getLng(): number;
  }
  class Map {
    constructor(el: HTMLElement, opts: { center: LatLng; level: number });
    getBounds(): LatLngBounds | null;
    getCenter(): LatLng;
    setBounds(bounds: LatLngBounds, padding?: number): void;
    getLevel(): number;
    setLevel(level: number): void;
    panTo(p: LatLng): void;
    relayout(): void;
  }
  class Polyline {
    constructor(opts: Record<string, unknown>);
    setMap(m: Map | null): void;
  }
  class CustomOverlay {
    constructor(opts: Record<string, unknown>);
    setMap(m: Map | null): void;
    /** 재생 마커 이동 (Phase 6f) */
    setPosition(p: LatLng): void;
  }
  namespace event {
    function addListener(target: Map, ev: 'click' | 'dblclick' | 'rightclick', cb: (e: { latLng: LatLng2 }) => void): void;
    function addListener(target: Map, ev: 'idle' | 'drag' | 'tilesloaded', cb: () => void): void;
    function removeListener(target: Map, ev: string, cb: () => void): void;
  }
  namespace services {
    const Status: { OK: string; ZERO_RESULT: string; ERROR: string };
    const SortBy: { DISTANCE?: string };
    interface CategoryItem extends PlaceItem {
      id?: string;
      /** 기준점에서의 거리(m) — 문자열로 온다 */
      distance?: string;
    }
    class Geocoder {
      /** 좌표 → 주소 (인자 순서가 lng, lat이다 — 뒤집으면 엉뚱한 곳이 나온다) */
      coord2Address(
        lng: number, lat: number,
        cb: (res: {
          address?: { region_1depth_name?: string; region_2depth_name?: string };
          road_address?: { building_name?: string };
        }[] | null, status: string) => void
      ): void;
    }
    interface PlaceItem {
      place_name: string;
      road_address_name?: string;
      address_name?: string;
      category_group_code?: string;
      /** 위도 문자열 */ y: string;
      /** 경도 문자열 */ x: string;
    }
    /** SDK는 콜백 스타일이라 서비스가 Promise로 감싼다 */
    class Places {
      /** 키워드 검색 (Phase 6c) */
      keywordSearch(
        q: string,
        cb: (data: PlaceItem[] | null, status: string) => void,
        opts?: { size?: number; location?: LatLng; radius?: number }
      ): void;
      /** 카테고리 검색 (Phase 6d) — 국내 POI 신원을 우리가 직접 조회해 깐다 */
      categorySearch(
        code: string,
        cb: (data: CategoryItem[] | null, status: string) => void,
        opts?: { bounds?: LatLngBounds; location?: LatLng; radius?: number; sort?: string }
      ): void;
    }
  }
}
