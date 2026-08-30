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
      addEventListener(type: 'gmp-click', cb: () => void): void;
    }
  }
  namespace event {
    function addListenerOnce(m: Map, ev: string, cb: () => void): void;
    function trigger(m: Map, ev: string): void;
  }
  /** 신 Places API는 동적 로드 — 초기 libraries에 없어도 필요할 때 받아온다 (Phase 6c 검색) */
  function importLibrary(name: 'places'): Promise<{ Place: typeof places.Place }>;
  namespace places {
    class Place {
      static searchByText(req: Record<string, unknown>): Promise<{ places: PlaceLike[] | null }>;
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
  }
  class Map {
    constructor(el: HTMLElement, opts: { center: LatLng; level: number });
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
  }
  /** 키워드 검색 (Phase 6c) — SDK는 콜백 스타일이라 서비스가 Promise로 감싼다 */
  namespace services {
    const Status: { OK: string; ZERO_RESULT: string; ERROR: string };
    interface PlaceItem {
      place_name: string;
      road_address_name?: string;
      address_name?: string;
      category_group_code?: string;
      /** 위도 문자열 */ y: string;
      /** 경도 문자열 */ x: string;
    }
    class Places {
      keywordSearch(
        q: string,
        cb: (data: PlaceItem[] | null, status: string) => void,
        opts?: { size?: number; location?: LatLng; radius?: number }
      ): void;
    }
  }
}
