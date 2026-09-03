// 예전 방식의 토큰 확인 — Supabase에 getUser()를 묻는다. withRemoteFallback의 폴백으로만 쓴다.
import { supabaseForToken } from '../infrastructure/supabase/legacyTripRepository';
import type { RequestContext } from './types';

export function remoteSupabaseUser(supabaseUrl: string): (token: string) => Promise<RequestContext | null> {
  return async (token) => {
    const { data, error } = await supabaseForToken(token, supabaseUrl).auth.getUser();
    const user = data?.user;
    if (error || !user?.id) return null;
    return { userId: user.id, legacySupabaseUserId: user.id, email: user.email ?? null, sessionId: null, tokenSource: 'supabase' };
  };
}
