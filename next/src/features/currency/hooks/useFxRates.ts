'use client';
// 환율 구독 — 값이 바뀌면 화면의 환산액이 따라 갱신된다.
// ⚠️ costLabel/toKRW(lib/currency/format)는 같은 스냅샷을 모듈 안에서 읽는다. 그래서
// 환산액을 그리는 memo는 이 훅이 주는 값을 **의존성에 넣어야** 새 환율로 다시 그린다.
import { useEffect, useSyncExternalStore } from 'react';

import { todayISO } from '@/lib/date/today';
import { getFxServerSnapshot, getFxSnapshot, refreshFx, subscribeFx } from '../services/fxStore';

export function useFxRates(): Record<string, number> {
  const rates = useSyncExternalStore(subscribeFx, getFxSnapshot, getFxServerSnapshot);
  // 하루 한 번만 실제로 나간다(services가 판정) — 외부 시스템 갱신이라 이펙트가 맞다
  useEffect(() => { void refreshFx(todayISO()); }, []);
  return rates;
}
