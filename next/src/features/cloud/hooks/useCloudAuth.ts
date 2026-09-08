'use client';
// 로그인 상태 — 정적 웹과 같은 자체 인증 세션을 구독한다.
//
// ⚠️ 로그인 병합은 **계정이 바뀐 순간에만** 돈다(shouldMergeOnAuth). 토큰 자동 갱신
// (TOKEN_REFRESHED)에도 병합을 돌리면 오래 열어둔 탭이 몇 시간 뒤 제 로컬본을 다시 올려
// 다른 기기의 최신 편집을 덮어쓴다 — 레거시가 실제로 겪은 사고다.
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';

import { shouldMergeOnAuth } from '../domain/syncDecisions';
import { cloudAuth, initializeCloud, subscribeCloudUser } from '../services/tripCanvasClient';

export interface CloudUser {
  id: string;
  email: string;
}

export type AuthResult = { ok: true } | { ok: false; error: string };

/** 클라우드를 쓸 수 있는 환경인가 — 브라우저인지에만 달린 고정 사실이라 구독은 비어 있다.
 *  (렌더에서 직접 읽으면 SSR과 hydration 결과가 갈린다) */
const subscribeNever = () => () => {};

export function useCloudAuth(onAccountSwitch: (user: CloudUser) => void) {
  const [user, setUser] = useState<CloudUser | null>(null);
  const available = useSyncExternalStore(subscribeNever, () => true, () => false);
  const seenUserId = useRef<string | null>(null);
  const switchCb = useRef(onAccountSwitch);
  useEffect(() => { switchCb.current = onAccountSwitch; });

  useEffect(() => {
    const unsubscribe = subscribeCloudUser(next => {
      const merge = shouldMergeOnAuth(seenUserId.current, next?.id ?? null);
      seenUserId.current = next?.id ?? null;
      setUser(next);
      if (merge && next) switchCb.current(next);
    });
    void initializeCloud().catch(() => { /* 로그인 조작 때 재시도하고 이유를 표시한다 */ });
    const onStorage = (event: StorageEvent) => {
      if (event.key === cloudAuth.TOKEN_KEY || event.key === null) void cloudAuth.restore();
    };
    window.addEventListener('storage', onStorage);
    return () => { unsubscribe(); window.removeEventListener('storage', onStorage); };
  }, []);

  const signIn = useCallback(async (email: string, password: string): Promise<AuthResult> => {
    try {
      await initializeCloud();
      const { error } = await cloudAuth.signIn({ email, password });
      return error ? { ok: false, error: error.message } : { ok: true };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : '로그인하지 못했어요' };
    }
  }, []);

  const signOut = useCallback(async (): Promise<void> => {
    await cloudAuth.signOut();
  }, []);

  return { user, available, signIn, signOut };
}
