'use client';
// Supabase 클라이언트 — 레거시와 **같은 프로젝트·같은 SDK 버전(2.112.3)**을 쓴다.
// 두 앱이 같은 계정·같은 trips 행을 다루므로 버전이 갈라지면 세션 저장 형식부터 어긋난다.
//
// 키는 publishable(공개용)이다. 레거시 app.js도 같은 값을 그대로 들고 있고, 데이터는
// RLS(trips_owner_* 정책)가 지킨다 — 이 키만으로는 남의 여행을 읽을 수 없다.
// 환경변수가 있으면 그쪽이 이긴다(다른 프로젝트로 붙일 때). 없으면 레거시와 같은 곳으로.
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://gdnhrwtfidjimtabgovh.supabase.co';
const KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'sb_publishable_2C-n1YFvE9Cw9B7L7B6Trw_XO3Val5q';

let client: SupabaseClient | null | undefined;

/** 브라우저에서만 만든다. SSR·비활성 환경에서는 null (호출측이 '클라우드 없음'으로 다룬다) */
export function supabase(): SupabaseClient | null {
  if (client !== undefined) return client;
  client = typeof window === 'undefined' ? null : createClient(URL, KEY);
  return client;
}
