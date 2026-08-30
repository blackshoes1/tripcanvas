'use client';
// 첫 방문 소개 배선 — 판정은 domain(isFirstVisit), 닫음 기록은 services(onboardStore).
import { useSyncExternalStore } from 'react';

import { isFirstVisit } from '../domain/onboarding';
import {
  dismissOnboard, getOnboardDismissed, getOnboardServerDismissed, subscribeOnboard
} from '../services/onboardStore';

/**
 * @param trips 저장소의 여행 목록
 * @param enabled 읽기전용(공유 링크 보기)에서는 끈다 — 남의 여행을 보러 온 사람에게 소개는 방해다
 */
export function useOnboarding(trips: readonly { id: string }[] | null, enabled: boolean) {
  const dismissed = useSyncExternalStore(
    subscribeOnboard, getOnboardDismissed, getOnboardServerDismissed
  );
  return { show: enabled && isFirstVisit(dismissed, trips), dismiss: dismissOnboard };
}
