// 지도 SDK 지연 로드 — 레거시(app.js __gmapsReady / loadKakao)와 같은 CDN 스크립트·같은 키.
// 모듈 싱글턴: 여러 번 불러도 스크립트는 한 번만 붙는다. 실패해도 throw하지 않고 false.
import { GMAPS_KEY, KAKAO_KEY } from '@/features/map/config';

let googleReady: Promise<boolean> | null = null;
let kakaoReady: Promise<boolean> | null = null;

export function loadGoogleMaps(): Promise<boolean> {
  if (googleReady !== null) return googleReady;
  googleReady = new Promise<boolean>(res => {
    if (typeof window === 'undefined') { res(false); return; }
    const w = window as unknown as Record<string, unknown>;
    if (typeof google !== 'undefined' && google.maps) { res(true); return; }
    const cb = '__tcNextGmapsReady';
    w[cb] = () => { delete w[cb]; res(true); };
    const s = document.createElement('script');
    // marker 라이브러리만 — 읽기 뷰는 검색(places)이 필요 없다
    s.src = `https://maps.googleapis.com/maps/api/js?key=${GMAPS_KEY}&v=weekly&libraries=marker&loading=async&callback=${cb}`;
    s.async = true;
    s.onerror = () => { delete w[cb]; res(false); };
    document.head.appendChild(s);
  });
  return googleReady;
}

export function loadKakaoMaps(): Promise<boolean> {
  if (kakaoReady !== null) return kakaoReady;
  kakaoReady = new Promise<boolean>(res => {
    if (typeof window === 'undefined') { res(false); return; }
    if (typeof kakao !== 'undefined' && kakao.maps && kakao.maps.Map) { res(true); return; }
    const s = document.createElement('script');
    s.src = `https://dapi.kakao.com/v2/maps/sdk.js?appkey=${KAKAO_KEY}&autoload=false`;
    s.onload = () => { try { kakao.maps.load(() => res(true)); } catch { res(false); } };
    s.onerror = () => res(false);
    document.head.appendChild(s);
  });
  return kakaoReady;
}
