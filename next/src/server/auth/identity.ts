// 새 Auth 계정 ↔ 도메인 사용자(§12·§13·§19).
//
// 왜 두 테이블인가: `users.id`는 **Supabase user id 그대로**여야 한다 — trips.user_id · trip_members.user_id ·
// 후보·코멘트·기록이 전부 그 값을 참조하기 때문이다(§13). 새 Auth는 제 계정 테이블(auth_user)을 갖고,
// 둘은 users.auth_user_id로 이어진다. 그래서 Auth를 또 바꿔도 도메인 데이터는 그대로다.
//
// ⚠️ 이어 주는 유일한 열쇠는 **확인된 이메일**이다. 확인 전에 이어 주면 남의 이메일로 가입해 그 사람의 여행을
// 가져가는 계정 탈취가 된다. better-auth 쪽에도 requireEmailVerification을 켜 두었지만, 여기서 한 번 더 막는다.
import type { AuthIdentityRepository } from '../repositories/types';

export interface AuthUserIdentity {
  id: string;
  email: string;
  emailVerified: boolean;
}

/** 정규화된 이메일 — 대소문자·앞뒤 공백을 무시하고 같은 사람으로 본다 */
export function normalizeEmail(email: unknown): string {
  return String(email ?? '').trim().toLowerCase();
}

/**
 * 이 Auth 계정이 어느 도메인 사용자인가. 없으면 만든다.
 * 이을 수 없으면(이메일 미확인·이메일 없음) null — 호출측은 인증 실패로 다룬다.
 */
export async function resolveDomainUser(
  repo: AuthIdentityRepository,
  authUser: AuthUserIdentity
): Promise<string | null> {
  const linked = await repo.findByAuthUserId(authUser.id);
  if (linked) return linked;

  const email = normalizeEmail(authUser.email);
  if (!email || !authUser.emailVerified) return null;

  // 아직 아무 Auth 계정과도 이어지지 않은 기존 사용자만 이어받는다 — 이미 이어진 사용자는 빼앗기지 않는다
  const existing = await repo.findUnlinkedByEmail(email);
  if (existing && await repo.link(existing, authUser.id)) return existing;

  return repo.createLinked(email, authUser.id);
}
