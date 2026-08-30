'use client';
// 로그인 상태 — Supabase 세션을 구독한다.
//
// ⚠️ 로그인 병합은 **계정이 바뀐 순간에만** 돈다(shouldMergeOnAuth). 토큰 자동 갱신
// (TOKEN_REFRESHED)에도 병합을 돌리면 오래 열어둔 탭이 몇 시간 뒤 제 로컬본을 다시 올려
// 다른 기기의 최신 편집을 덮어쓴다 — 레거시가 실제로 겪은 사고다.
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';

import { shouldMergeOnAuth } from '../domain/syncDecisions';
import { supabase } from '../services/supabaseClient';

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
  const available = useSyncExternalStore(subscribeNever, () => supabase() !== null, () => false);
  const seenUserId = useRef<string | null>(null);
  const switchCb = useRef(onAccountSwitch);
  useEffect(() => { switchCb.current = onAccountSwitch; });

  useEffect(() => {
    const sb = supabase();
    if (!sb) return;
    const { data } = sb.auth.onAuthStateChange((_event, session) => {
      const next = session?.user
        ? { id: session.user.id, email: session.user.email ?? '' }
        : null;
      const merge = shouldMergeOnAuth(seenUserId.current, next?.id ?? null);
      seenUserId.current = next?.id ?? null;
      setUser(next);
      if (merge && next) switchCb.current(next);
    });
    return () => data.subscription.unsubscribe();
  }, []);

  const signIn = useCallback(async (email: string, password: string): Promise<AuthResult> => {
    const sb = supabase();
    if (!sb) return { ok: false, error: '온라인 상태에서 다시 시도해주세요' };
    const { error } = await sb.auth.signInWithPassword({ email, password });
    // 원문 대신 우리 문구로 — 어떤 계정이 있는지 알려주지 않는다
    return error ? { ok: false, error: '이메일 또는 비밀번호가 맞지 않습니다' } : { ok: true };
  }, []);

  const signOut = useCallback(async (): Promise<void> => {
    await supabase()?.auth.signOut();
  }, []);

  return { user, available, signIn, signOut };
}
