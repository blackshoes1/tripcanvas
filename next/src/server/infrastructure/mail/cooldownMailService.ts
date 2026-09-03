// 메일 쿨다운(§67) — 같은 사람에게 같은 종류의 메일이 반복 발송되지 않게 감싼다.
// Supabase에서 겪은 이메일 rate limit 문제를 자체 시스템에서 다시 만들지 않는 것이 목적이다.
//
// 건너뛸 때 **오류를 내지 않는다**: "메일을 보냈습니다"라는 화면은 그대로 두어야 한다.
// 여기서 실패를 알리면 "그 이메일이 가입돼 있는지"를 밖에서 알아낼 수 있는 통로가 된다.
import { normalizeEmail } from '../../auth/identity';
import type { MailCooldownStore, MailKind, MailService } from './types';

export interface CooldownOptions {
  cooldownMs: number;
  now?: () => number;
  log?: (message: string) => void;
}

export function withCooldown(inner: MailService, store: MailCooldownStore, opts: CooldownOptions): MailService {
  const now = opts.now ?? (() => Date.now());
  const log = opts.log ?? (() => {});

  async function guarded(kind: MailKind, to: string, send: () => Promise<void>): Promise<void> {
    const email = normalizeEmail(to);
    if (!email) return;
    const last = await store.lastSentAt(email, kind);
    const at = now();
    if (last != null && at - last < opts.cooldownMs) {
      log(`${kind} 메일 쿨다운 — 건너뛴다`);
      return;
    }
    // 보낸 뒤에 기록한다: 실패한 발송이 재시도를 막으면 안 된다
    await send();
    await store.markSent(email, kind, at);
  }

  return {
    sendVerificationEmail: (to, url) => guarded('VERIFY', to, () => inner.sendVerificationEmail(to, url)),
    sendPasswordReset: (to, url) => guarded('RESET', to, () => inner.sendPasswordReset(to, url))
  };
}
