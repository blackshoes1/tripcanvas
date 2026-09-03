// 메일은 교체 가능한 Infrastructure Adapter다(§21) — 도메인은 SMTP를 모른다.
// NAS에서 직접 메일 서버를 운영하지 않는다(전달률·차단 문제). 외부 SMTP provider를 쓰고, 없으면 콘솔로 떨어진다.
export interface MailService {
  /** 가입 확인 — 이 링크를 눌러야 로그인이 열린다(§20) */
  sendVerificationEmail(to: string, url: string): Promise<void>;
  sendPasswordReset(to: string, url: string): Promise<void>;
}

/** 쿨다운 키(§67). 종류가 다르면 서로 막지 않는다 */
export type MailKind = 'VERIFY' | 'RESET';

export interface MailCooldownStore {
  lastSentAt(email: string, kind: MailKind): Promise<number | null>;
  markSent(email: string, kind: MailKind, at: number): Promise<void>;
}
