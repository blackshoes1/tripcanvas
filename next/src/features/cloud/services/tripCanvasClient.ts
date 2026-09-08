'use client';
// 정적 웹과 같은 인증·HTTP transport. Supabase 테이블에 직접 접근하지 않는다.
import auth from '@legacy/auth.js';
import api from '@legacy/api.js';

export type CloudUser = { id: string; email: string };
let configured = false;
let ready: Promise<void> | null = null;
const listeners = new Set<(user: CloudUser | null) => void>();

function configure() {
  if (configured || typeof window === 'undefined') return;
  const local = /^(localhost|127\.0\.0\.1)$/.test(window.location.hostname);
  const baseUrl = process.env.NEXT_PUBLIC_API_BASE_URL || (local ? window.location.origin : auth.DEFAULT_BASE);
  let storage: Storage | null = null;
  try { storage = window.localStorage; } catch { /* 로컬 저장이 제한된 환경 */ }
  auth.configure({ baseUrl, storage });
  api.configure({ baseUrl, getToken: auth.getToken });
  auth.onChange(user => { for (const listener of listeners) listener(user); });
  configured = true;
}

export async function initializeCloud(): Promise<void> {
  configure();
  if (!configured) return;
  if (!ready) {
    ready = (async () => {
      if (await auth.resolveProvider() !== 'TRIPCANVAS') {
        throw new Error('로그인 서버에 연결하지 못했어요. 잠시 후 다시 시도해 주세요.');
      }
      await auth.restore();
    })().catch(error => { ready = null; throw error; });
  }
  return ready;
}

export function subscribeCloudUser(listener: (user: CloudUser | null) => void): () => void {
  configure();
  listeners.add(listener);
  listener(auth.user());
  return () => { listeners.delete(listener); };
}

export function hasCloudSession(): boolean { return typeof window !== 'undefined' && auth.user() !== null; }
export { api as cloudApi, auth as cloudAuth };
