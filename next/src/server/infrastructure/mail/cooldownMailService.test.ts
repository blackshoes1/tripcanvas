// 메일 쿨다운(§67) — 같은 사람에게 인증·재설정 메일이 반복 발송되지 않게 한다.
// Supabase에서 겪은 이메일 rate limit 문제를 자체 시스템에서 다시 만들지 않는 것이 목적이다(§66).
import { beforeEach, describe, expect, it } from 'vitest';

import { createTestDatabase, type TestDatabase } from '../database/testDb';
import { PgMailCooldownStore } from '../database/pgMailCooldownStore';
import { withCooldown } from './cooldownMailService';
import type { MailService } from './types';

let db: TestDatabase;
let sent: { to: string; kind: string }[];
let now: number;
let mail: MailService;

const inner: () => MailService = () => ({
  async sendVerificationEmail(to) { sent.push({ to, kind: 'VERIFY' }); },
  async sendPasswordReset(to) { sent.push({ to, kind: 'RESET' }); }
});

beforeEach(async () => {
  db = await createTestDatabase();
  sent = [];
  now = 1_700_000_000_000;
  mail = withCooldown(inner(), new PgMailCooldownStore(db.db), { cooldownMs: 60_000, now: () => now });
});

describe('withCooldown', () => {
  it('처음은 보내고, 쿨다운 안의 재요청은 조용히 건너뛴다', async () => {
    await mail.sendVerificationEmail('a@example.com', 'https://x/verify?token=1');
    await mail.sendVerificationEmail('a@example.com', 'https://x/verify?token=2');
    expect(sent).toEqual([{ to: 'a@example.com', kind: 'VERIFY' }]);
  });

  it('쿨다운이 지나면 다시 보낸다', async () => {
    await mail.sendVerificationEmail('a@example.com', 'https://x/1');
    now += 60_001;
    await mail.sendVerificationEmail('a@example.com', 'https://x/2');
    expect(sent).toHaveLength(2);
  });

  it('종류가 다르면 서로 막지 않는다 — 인증 메일이 재설정 메일을 가리지 않게', async () => {
    await mail.sendVerificationEmail('a@example.com', 'https://x/1');
    await mail.sendPasswordReset('a@example.com', 'https://x/2');
    expect(sent.map((s) => s.kind)).toEqual(['VERIFY', 'RESET']);
  });

  it('사람이 다르면 서로 막지 않는다. 이메일은 대소문자를 가리지 않는다', async () => {
    await mail.sendVerificationEmail('a@example.com', 'https://x/1');
    await mail.sendVerificationEmail('b@example.com', 'https://x/2');
    await mail.sendVerificationEmail('A@Example.com', 'https://x/3');
    expect(sent.map((s) => s.to)).toEqual(['a@example.com', 'b@example.com']);
  });

  it('발송이 실패하면 쿨다운을 남기지 않는다 — 재시도가 막히면 안 된다', async () => {
    const failing: MailService = {
      async sendVerificationEmail() { throw new Error('SMTP down'); },
      async sendPasswordReset() {}
    };
    const guarded = withCooldown(failing, new PgMailCooldownStore(db.db), { cooldownMs: 60_000, now: () => now });
    await expect(guarded.sendVerificationEmail('a@example.com', 'https://x/1')).rejects.toThrow('SMTP down');
    const store = new PgMailCooldownStore(db.db);
    expect(await store.lastSentAt('a@example.com', 'VERIFY')).toBeNull();
  });
});
