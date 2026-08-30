'use client';
// 재생 세션 — app.js playTrip()의 상태기계를 그대로 옮긴다. 판정(경로·구간·페이싱·탐색)은
// domain이 하고 여기서는 rAF·카메라·마커만 몬다 (§27).
//
// 핵심 설계(레거시 그대로): 구간(phase) 단위로 **카메라를 고정**한다.
// 진입 시 구간 전체를 한 화면에 담고 타일 로딩을 기다린 뒤, 이동 중에는 카메라를 전혀 움직이지 않는다.
// → 새 타일 로딩이 없어(자동차는 오버레이라 타일과 무관) 네트워크와 무관하게 매끄럽게 미끄러진다.
import { useCallback, useEffect, useRef, useState } from 'react';

import { MODE_ICON } from '@/features/itinerary/domain/dayView';
import type { LegCache } from '@/features/itinerary/domain/types';
import type { MapHandle } from '@/features/map/components/MapView';
import type { Trip } from '@/features/trip/domain/types';
import { buildAnimPath, type AnimPoint } from '../domain/animPath';
import {
  buildTimeline, facesEast, legIndexAt, MIN_ANIM_POINTS, positionAt, seekTarget, type PlayTimeline
} from '../domain/timeline';

/** 타일 로딩 최대 대기(ms)·로딩 후 정착 지연(ms) — 깔끔한 출발을 우선한다 */
const TILE_TIMEOUT = 3500;
const SETTLE = 400;
/** 프레임 잭·탭 복귀 갭 클램프 — 렉이 걸려도 점프 대신 감속한다 */
const MAX_FRAME_MS = 34;

export type PlaySpeed = 0.5 | 1 | 2;

export interface PlayStatus {
  playing: boolean;
  paused: boolean;
  /** 0~1 */
  progress: number;
  legIndex: number;
  legCount: number;
  /** 지금 지나는 구간 (없으면 아직 시작 전) */
  at: AnimPoint | null;
}

const IDLE: PlayStatus = { playing: false, paused: false, progress: 0, legIndex: 0, legCount: 0, at: null };

export interface PlaybackDeps {
  trip: Trip | null;
  legCache: LegCache;
  activeDay: number;
  map: React.RefObject<MapHandle | null>;
  /** 재생할 동선이 없을 때 등 사용자에게 알릴 말 */
  onNotice?: (msg: string) => void;
  /** 끝났을 때 카메라를 원래 프레임으로 되돌리도록 */
  onEnd?: () => void;
}

export function usePlayback({ trip, legCache, activeDay, map, onNotice, onEnd }: PlaybackDeps) {
  const [status, setStatus] = useState<PlayStatus>(IDLE);
  const [speed, setSpeed] = useState<PlaySpeed>(1);

  // 재생 세션의 가변 상태 — 렌더와 무관하게 rAF가 읽고 쓴다
  const flat = useRef<AnimPoint[]>([]);
  const tl = useRef<PlayTimeline | null>(null);
  const raf = useRef<number | null>(null);
  const endT = useRef<ReturnType<typeof setTimeout> | null>(null);
  const marker = useRef<{ move(lat: number, lng: number): void; remove(): void } | null>(null);
  const carEl = useRef<HTMLSpanElement | null>(null);
  const seq = useRef(0);                 // 세션 식별 — 대기 중 정지/재시작된 조회를 무효화
  const d = useRef(0);                   // 누적거리 커서
  const pIdx = useRef(0);
  const elapsed = useRef(0);
  const lastTs = useRef<number | null>(null);
  const segCursor = useRef(0);
  const eastward = useRef(false);
  const pausedRef = useRef(false);
  const waiting = useRef(false);
  const speedRef = useRef<PlaySpeed>(1);
  useEffect(() => { speedRef.current = speed; }, [speed]);

  /** 자기 자신을 다시 예약하기 위한 최신 step 구현 */
  const stepRef = useRef<((ts: number) => void) | null>(null);

  const publish = useCallback((patch: Partial<PlayStatus>) => setStatus(s => ({ ...s, ...patch })), []);

  const stop = useCallback(() => {
    seq.current++;
    if (raf.current != null) { cancelAnimationFrame(raf.current); raf.current = null; }
    if (endT.current) { clearTimeout(endT.current); endT.current = null; }
    marker.current?.remove();
    marker.current = null;
    carEl.current = null;
    flat.current = [];
    tl.current = null;
    waiting.current = false;
    pausedRef.current = false;
    setStatus(IDLE);
  }, []);

  /** 커서 위치를 마커·HUD에 반영 (카메라는 건드리지 않는다) */
  const applyPos = useCallback(() => {
    const t = tl.current;
    if (!t || !marker.current) return;
    const pos = positionAt(flat.current, t.gcum, d.current, segCursor.current);
    if (!pos) return;
    segCursor.current = pos.segIndex;
    marker.current.move(pos.lat, pos.lng);
    eastward.current = facesEast(pos.at, pos.next, eastward.current);
    if (carEl.current) {
      // 🚗는 측면뷰라 회전시키면 눕는다 → 좌우 뒤집기만
      carEl.current.style.transform = `scaleX(${eastward.current ? -1 : 1})`;
      const icon = MODE_ICON[pos.at.mode] || '🚗';
      if (carEl.current.textContent !== icon) carEl.current.textContent = icon;
    }
    publish({
      progress: Math.max(0, Math.min(1, d.current / t.gtotal)),
      legIndex: legIndexAt(t.legStarts, d.current),
      at: pos.at
    });
  }, [publish]);

  const enterPhase = useCallback(function enter(keepElapsed: boolean) {
    const t = tl.current;
    const mine = seq.current;
    if (!t || !t.phases[pIdx.current]) return;
    raf.current = null;
    waiting.current = true;
    const ph = t.phases[pIdx.current];
    map.current?.fitPts(ph.pts, 90, ph.zoom);
    void map.current?.waitTiles(TILE_TIMEOUT).then(() => {
      if (mine !== seq.current) return;               // 대기 중 정지/재시작됨
      setTimeout(() => {
        if (mine !== seq.current) return;
        waiting.current = false;
        lastTs.current = null;
        if (!keepElapsed) elapsed.current = 0;
        applyPos();
        if (!pausedRef.current) raf.current = requestAnimationFrame(stepRef.current!);
      }, SETTLE);
    });
  }, [map, applyPos]);

  // step은 자기 자신을 다시 예약해야 한다 — 최신 구현을 ref로 들고 그걸 예약한다
  const step = useCallback((ts: number) => {
    const t = tl.current;
    if (!t || pausedRef.current) return;
    if (lastTs.current == null) lastTs.current = ts;
    const dt = Math.min(MAX_FRAME_MS, ts - lastTs.current);
    lastTs.current = ts;

    const ph = t.phases[pIdx.current];
    if (!ph) return;
    elapsed.current += dt * speedRef.current;
    const frac = Math.min(1, elapsed.current / ph.dur);
    d.current = ph.a + (ph.b - ph.a) * frac;
    applyPos();

    if (frac >= 1) {
      pIdx.current++;
      if (pIdx.current < t.phases.length) enterPhase(false);
      else {
        raf.current = null;
        endT.current = setTimeout(() => { stop(); onEnd?.(); }, 700);
      }
      return;
    }
    raf.current = requestAnimationFrame(stepRef.current!);
  }, [applyPos, enterPhase, stop, onEnd]);
  useEffect(() => { stepRef.current = step; }, [step]);

  const start = useCallback(() => {
    if (!trip) return;
    if (!map.current?.ready()) { onNotice?.('지도를 불러오는 중이에요'); return; }
    const path = buildAnimPath(trip, legCache, activeDay);
    if (path.length < MIN_ANIM_POINTS) { onNotice?.('재생할 동선이 없어요'); return; }

    stop();
    seq.current++;
    flat.current = path;
    tl.current = buildTimeline(path);
    d.current = 0; pIdx.current = 0; elapsed.current = 0;
    lastTs.current = null; segCursor.current = 0; pausedRef.current = false;

    const wrap = document.createElement('div');
    wrap.style.cssText = 'will-change:transform';
    const car = document.createElement('span');
    car.textContent = MODE_ICON[path[0].mode] || '🚗';
    car.style.cssText = 'display:inline-block;font-size:28px;line-height:1;'
      + 'filter:drop-shadow(0 2px 3px rgba(0,0,0,.55));transition:transform .12s linear';
    wrap.appendChild(car);
    wrap.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.15)' }],
      { duration: 600, iterations: Infinity, direction: 'alternate', easing: 'ease-in-out' });
    carEl.current = car;
    marker.current = map.current.moveMarker(path[0].lat, path[0].lng, wrap) ?? null;

    map.current.relayout();
    setStatus({ playing: true, paused: false, progress: 0, legIndex: 0, legCount: tl.current.legStarts.length, at: path[0] });
    enterPhase(false);
  }, [trip, legCache, activeDay, map, onNotice, stop, enterPhase]);

  const pause = useCallback(() => {
    if (pausedRef.current) return;
    pausedRef.current = true;
    if (raf.current != null) { cancelAnimationFrame(raf.current); raf.current = null; }
    lastTs.current = null;
    publish({ paused: true });
  }, [publish]);

  const resume = useCallback(() => {
    if (!pausedRef.current) return;
    pausedRef.current = false;
    lastTs.current = null;
    if (!waiting.current) raf.current = requestAnimationFrame(stepRef.current!);
    publish({ paused: false });
  }, [publish]);

  const seekPreview = useCallback((frac: number) => {
    const t = tl.current;
    if (!t) return;
    d.current = Math.max(0, Math.min(1, frac)) * t.gtotal;
    applyPos();
  }, [applyPos]);

  const seekCommit = useCallback(() => {
    const t = tl.current;
    if (!t) return;
    const tgt = seekTarget(t.phases, t.gtotal, d.current / t.gtotal);
    pIdx.current = tgt.pIdx;
    elapsed.current = tgt.elapsed;
    if (raf.current != null) { cancelAnimationFrame(raf.current); raf.current = null; }
    enterPhase(true);
  }, [enterPhase]);

  /** 이전 구간 — 구간 시작 직후(0.3km 이내)면 '더 이전'으로 (레거시와 같은 손맛) */
  const prevSeg = useCallback(() => {
    const t = tl.current;
    if (!t) return;
    const i = legIndexAt(t.legStarts, d.current);
    const tgt = i > 0 && d.current - t.legStarts[i] < 0.3 ? t.legStarts[i - 1] : t.legStarts[i];
    seekPreview(tgt / t.gtotal);
    seekCommit();
  }, [seekPreview, seekCommit]);

  const nextSeg = useCallback(() => {
    const t = tl.current;
    if (!t) return;
    const i = legIndexAt(t.legStarts, d.current);
    seekPreview((i < t.legStarts.length - 1 ? t.legStarts[i + 1] : t.gtotal) / t.gtotal);
    seekCommit();
  }, [seekPreview, seekCommit]);

  const toggle = useCallback(() => { if (status.playing) stop(); else start(); }, [status.playing, stop, start]);

  // 탭을 숨기면 자동 '일시정지'(정지 아님) — 위치를 보존해 돌아와서 이어볼 수 있게
  useEffect(() => {
    const onHide = () => { if (document.hidden && status.playing && !pausedRef.current) pause(); };
    document.addEventListener('visibilitychange', onHide);
    return () => document.removeEventListener('visibilitychange', onHide);
  }, [status.playing, pause]);

  useEffect(() => stop, [stop]);   // 화면을 떠나면 마커·타이머 정리

  return { status, speed, setSpeed, start, stop, toggle, pause, resume, seekPreview, seekCommit, prevSeg, nextSeg };
}
