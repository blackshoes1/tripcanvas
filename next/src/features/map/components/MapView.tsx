'use client';
// 지도 뷰 — buildMapScene 결과를 그리는 SDK 어댑터 (판정·규칙은 전부 domain/scene).
// 레거시 Engines 어댑터의 google/kakao 분기를 그대로 옮겼다: 오버레이 핸들은 remove() 목록으로 통일.
// 읽기 뷰라 POI 탭(clickableIcons)·우클릭 추가·검색은 없다 — Phase 6에서 이관.
import { useEffect, useRef, useState } from 'react';

import type { FitTarget, MapScene } from '@/features/map/domain/types';
import { loadGoogleMaps, loadKakaoMaps } from '@/features/map/services/sdkLoader';

type PinClick = (di: number, si: number) => void;

// ── 오버레이 DOM (레거시 mkPin/ghostStay/legChip와 같은 클래스) ──
function mkPinEl(color: string, label: number, opt: boolean, catIcon: string | null, title: string): HTMLDivElement {
  const size = opt ? 22 : 27;
  const el = document.createElement('div');
  el.className = 'num-icon';
  el.style.cssText = `width:${size}px;height:${size}px;background:${color};${opt ? 'opacity:.75;' : ''}`;
  el.textContent = String(label);
  el.title = title;
  if (catIcon) {
    const b = document.createElement('span');
    b.className = 'pinCat';
    b.textContent = catIcon;
    el.appendChild(b);
  }
  return el;
}
function ghostEl(color: string, title: string): HTMLDivElement {
  const el = document.createElement('div');
  el.className = 'ghostStay';
  el.textContent = '🏠';
  el.title = title;
  el.style.borderColor = color;
  return el;
}
function chipEl(text: string): HTMLDivElement {
  const el = document.createElement('div');
  el.className = 'legChip';
  el.textContent = text;
  return el;
}

// ── 엔진별 그리기 (레거시 Engines.google/kakao 동일 옵션) ──
function drawGoogle(map: google.maps.Map, scene: MapScene, onPinClick?: PinClick): (() => void)[] {
  const removers: (() => void)[] = [];
  const overlay = (lat: number, lng: number, el: HTMLElement, zIndex?: number) => {
    const m = new google.maps.marker.AdvancedMarkerElement({ map, position: { lat, lng }, content: el, zIndex });
    removers.push(() => { m.map = null; });
    return m;
  };
  scene.pins.forEach(p => {
    const m = overlay(p.lat, p.lng, mkPinEl(p.color, p.label, p.opt, p.catIcon, p.title));
    if (onPinClick) m.addEventListener('gmp-click', () => onPinClick(p.di, p.si));
  });
  scene.lines.forEach(l => {
    const opt: Record<string, unknown> = { map, path: l.pts, geodesic: true };
    if (l.dashed) {
      Object.assign(opt, {
        strokeOpacity: 0,
        icons: [{ icon: { path: 'M 0,-1 0,1', strokeOpacity: l.opacity, strokeColor: l.color, scale: 2 }, offset: '0', repeat: '14px' }]
      });
    } else {
      Object.assign(opt, { strokeColor: l.color, strokeWeight: 3, strokeOpacity: l.opacity });
    }
    const pl = new google.maps.Polyline(opt);
    removers.push(() => pl.setMap(null));
  });
  scene.ghosts.forEach(g => overlay(g.lat, g.lng, ghostEl(g.color, g.title)));
  scene.chips.forEach(c => overlay(c.lat, c.lng, chipEl(c.text)));
  return removers;
}

function drawKakao(kmap: kakao.maps.Map, scene: MapScene, onPinClick?: PinClick): (() => void)[] {
  const removers: (() => void)[] = [];
  const overlay = (lat: number, lng: number, el: HTMLElement, clickable: boolean) => {
    const ov = new kakao.maps.CustomOverlay({
      position: new kakao.maps.LatLng(lat, lng), content: el, xAnchor: 0.5, yAnchor: 0.5, clickable
    });
    ov.setMap(kmap);
    removers.push(() => ov.setMap(null));
  };
  scene.pins.forEach(p => {
    const el = mkPinEl(p.color, p.label, p.opt, p.catIcon, p.title);
    if (onPinClick) {
      el.style.cursor = 'pointer';
      el.onclick = () => onPinClick(p.di, p.si);
    }
    overlay(p.lat, p.lng, el, true);
  });
  scene.lines.forEach(l => {
    const pl = new kakao.maps.Polyline({
      path: l.pts.map(p => new kakao.maps.LatLng(p.lat, p.lng)),
      strokeColor: l.color, strokeWeight: l.dashed ? 2 : 3, strokeOpacity: l.opacity,
      strokeStyle: l.dashed ? 'dash' : 'solid'
    });
    pl.setMap(kmap);
    removers.push(() => pl.setMap(null));
  });
  scene.ghosts.forEach(g => overlay(g.lat, g.lng, ghostEl(g.color, g.title), false));
  scene.chips.forEach(c => overlay(c.lat, c.lng, chipEl(c.text), false));
  return removers;
}

// ── 카메라 (레거시 Engines.fit 동일 — 카카오 레벨은 19-줌 환산) ──
function fitGoogle(map: google.maps.Map, fit: FitTarget) {
  const b = new google.maps.LatLngBounds();
  fit.pts.forEach(p => b.extend({ lat: p[0], lng: p[1] }));
  map.fitBounds(b, fit.pad);
  if (fit.maxZoom != null) {
    const max = fit.maxZoom;
    google.maps.event.addListenerOnce(map, 'idle', () => {
      const z = map.getZoom();
      if (z != null && z > max) map.setZoom(max);
    });
  }
}
function fitKakao(kmap: kakao.maps.Map, fit: FitTarget) {
  const b = new kakao.maps.LatLngBounds();
  fit.pts.forEach(p => b.extend(new kakao.maps.LatLng(p[0], p[1])));
  kmap.relayout();   // display 전환 직후 크기 재계산 (레거시 setEngine과 동일)
  kmap.setBounds(b, fit.pad);
  if (fit.maxZoom != null) {
    const minLv = Math.max(1, 19 - fit.maxZoom);
    if (kmap.getLevel() < minLv) kmap.setLevel(minLv);
  }
}

/**
 * 컨테이너가 실제 크기를 가질 때까지 대기 — 0×0에서 카카오 지도를 만들면 CustomOverlay가
 * 영구히 조용해지고(핀·칩 미표시, Polyline은 그려져 혼동) 프레이밍(setBounds)도 어긋난다.
 * 0×0은 흔하다: 백그라운드 탭/숨겨진 패널(vh가 0으로 계산), dev의 CSS 적용 지연.
 * 레거시는 표시 시점의 relayout()으로 우회하지만, 생성 자체를 늦추는 쪽이 안전하다.
 */
function waitForSize(el: HTMLElement): Promise<void> {
  return new Promise(res => {
    if (el.offsetWidth > 0 && el.offsetHeight > 0) { res(); return; }
    const ro = new ResizeObserver(() => {
      if (el.offsetWidth > 0 && el.offsetHeight > 0) { ro.disconnect(); res(); }
    });
    ro.observe(el);
  });
}

export function MapView({ scene, fit, onPinClick }: { scene: MapScene; fit: FitTarget | null; onPinClick?: PinClick }) {
  const gDiv = useRef<HTMLDivElement>(null);
  const kDiv = useRef<HTMLDivElement>(null);
  const gMap = useRef<google.maps.Map | null>(null);
  const kMap = useRef<kakao.maps.Map | null>(null);
  const removers = useRef<(() => void)[]>([]);
  const [ready, setReady] = useState({ google: false, kakao: false });
  const [failed, setFailed] = useState<'google' | 'kakao' | null>(null);

  // 장면이 원하는 엔진을 지연 초기화 (레거시: 구글 즉시 + 카카오 지연 — 읽기 뷰는 둘 다 필요할 때만)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (scene.engine === 'google' && !gMap.current) {
        const ok = await loadGoogleMaps();
        if (cancelled) return;
        if (!ok || !gDiv.current) { setFailed('google'); return; }
        await waitForSize(gDiv.current);
        if (cancelled || gMap.current) return;
        gMap.current = new google.maps.Map(gDiv.current, {
          center: { lat: 40, lng: -3.7 }, zoom: 6, mapId: 'DEMO_MAP_ID',
          disableDefaultUI: true, zoomControl: true, clickableIcons: false, gestureHandling: 'greedy'
        });
        setReady(r => ({ ...r, google: true }));
      }
      if (scene.engine === 'kakao' && !kMap.current) {
        const ok = await loadKakaoMaps();
        if (cancelled) return;
        if (!ok || !kDiv.current) { setFailed('kakao'); return; }
        await waitForSize(kDiv.current);
        if (cancelled || kMap.current) return;
        kMap.current = new kakao.maps.Map(kDiv.current, { center: new kakao.maps.LatLng(36.5, 127.9), level: 12 });
        setReady(r => ({ ...r, kakao: true }));
      }
    })();
    return () => { cancelled = true; };
  }, [scene.engine]);

  const engineReady = scene.engine === 'kakao' ? ready.kakao : ready.google;

  // 장면 그리기 — 이전 오버레이는 엔진과 무관하게 전부 제거 후 다시
  useEffect(() => {
    if (!engineReady) return;
    removers.current.forEach(r => r());
    removers.current = scene.engine === 'kakao'
      ? drawKakao(kMap.current!, scene, onPinClick)
      : drawGoogle(gMap.current!, scene, onPinClick);
  }, [scene, engineReady, onPinClick]);

  // 프레이밍 — fit 객체가 바뀔 때(일자 필터 전환·진입)만
  useEffect(() => {
    if (!fit || !engineReady) return;
    if (scene.engine === 'kakao') fitKakao(kMap.current!, fit);
    else fitGoogle(gMap.current!, fit);
  }, [fit, engineReady, scene.engine]);

  useEffect(() => () => { removers.current.forEach(r => r()); }, []);

  return (
    <div className="itMapWrap">
      <div ref={gDiv} className="itMapCanvas" style={{ display: scene.engine === 'google' ? 'block' : 'none' }} />
      <div ref={kDiv} className="itMapCanvas" style={{ display: scene.engine === 'kakao' ? 'block' : 'none' }} />
      {!engineReady && (
        <div className="itMapHint" role="status">
          {failed === scene.engine
            ? '지도를 불러오지 못했어요 — 네트워크 또는 API 키 도메인 등록(localhost:8000)을 확인해주세요'
            : '지도 불러오는 중…'}
        </div>
      )}
    </div>
  );
}
