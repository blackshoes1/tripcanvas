'use client';
// 국내 POI 레이어 — app.js refreshKakaoPOI/drawKakaoPOI와 같은 조회·같은 표시.
//
// 왜 필요한가: 카카오맵 SDK는 바탕 지도의 POI를 눌렀다는 사실도, 그 장소의 id도 주지 않는다
// (Map 이벤트는 전부 좌표뿐). 그래서 좌표로 되짚는 추측이 불가피했고 엉뚱한 상호가 들어갔다.
// → 우리가 직접 장소를 조회해 칩으로 깔고 그걸 누르게 한다. 우리가 찍었으니 무엇을 눌렀는지
//   정확히 안다 — 해외의 placeId와 같은 수준이 된다.
import legacyLib from '@legacy/lib.js';

import { POI_CATS, POI_FALLBACK_RADIUS_M, POI_MAX, shouldShowPoi } from '../domain/mapPick';

export interface PoiPick {
  lat: number;
  lng: number;
  name: string;
  city: string;
}

/**
 * 지도에 POI 칩을 까는 레이어. 지도 이동이 멈출 때마다 refresh()를 부르면 된다.
 * 응답이 늦게 오는 조회는 seq로 버린다 — 이미 다른 곳을 보고 있는데 옛 결과가 깔리지 않게.
 */
export function createKakaoPoiLayer(kmap: kakao.maps.Map, onPick: (p: PoiPick) => void) {
  let overlays: kakao.maps.CustomOverlay[] = [];
  let seq = 0;

  function clear(): void {
    overlays.forEach(o => { try { o.setMap(null); } catch { /* 이미 떨어진 오버레이 */ } });
    overlays = [];
  }

  function draw(list: kakao.maps.services.CategoryItem[]): void {
    clear();
    list.slice(0, POI_MAX).forEach(p => {
      const lat = +p.y, lng = +p.x;
      if (!isFinite(lat) || !isFinite(lng) || !p.place_name) return;
      const el = document.createElement('button');
      el.type = 'button';
      el.className = 'poiChip';
      el.textContent = p.place_name;   // 외부 데이터 → textContent (innerHTML 금지)
      el.title = p.road_address_name || p.address_name || p.place_name;
      el.onclick = ev => {
        ev.preventDefault();
        ev.stopPropagation();
        onPick({
          lat, lng,
          name: p.place_name,
          city: legacyLib.cityFromKakaoAddress(p.address_name || p.road_address_name || '')
        });
      };
      const ov = new kakao.maps.CustomOverlay({
        position: new kakao.maps.LatLng(lat, lng), content: el, xAnchor: 0.5, yAnchor: 0.5, clickable: true
      });
      ov.setMap(kmap);
      overlays.push(ov);
    });
  }

  async function refresh(): Promise<void> {
    const S = window.kakao?.maps?.services;
    if (!S?.Places) { clear(); return; }
    if (!shouldShowPoi(kmap.getLevel())) { clear(); return; }   // 넓게 보는 중엔 의미 없음

    const mine = ++seq;
    const ps = new S.Places();

    // 지도가 아직 크기를 못 잡았으면 getBounds()가 한 점으로 접혀 조회가 0건이 된다.
    // 그때는 중심 반경으로 대신 훑는다.
    const bd = kmap.getBounds();
    const sw = bd?.getSouthWest(), ne = bd?.getNorthEast();
    const hasArea = !!(sw && ne)
      && Math.abs(ne.getLat() - sw.getLat()) > 1e-6
      && Math.abs(ne.getLng() - sw.getLng()) > 1e-6;
    const opt = hasArea && bd
      ? { bounds: bd }
      : { location: kmap.getCenter(), radius: POI_FALLBACK_RADIUS_M, sort: S.SortBy?.DISTANCE };

    const perCat = await Promise.all(POI_CATS.map(code =>
      new Promise<kakao.maps.services.CategoryItem[]>(res => {
        try {
          ps.categorySearch(code, (data, status) => {
            res(status === S.Status.OK && Array.isArray(data) ? data : []);
          }, opt);
        } catch { res([]); }
      })
    ));
    if (mine !== seq) return;   // 그 사이 지도가 또 움직였다 — 옛 결과는 버린다

    const found = new Map<string, kakao.maps.services.CategoryItem>();
    perCat.flat().forEach(d => {
      const key = d?.id || `${d?.x},${d?.y}`;
      if (d && !found.has(key)) found.set(key, d);
    });
    draw([...found.values()]);
  }

  return {
    refresh,
    clear,
    destroy() { seq++; clear(); }
  };
}
