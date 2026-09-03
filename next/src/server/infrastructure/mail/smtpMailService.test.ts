// SMTP 어댑터. 실제 발송은 `npm run mail:test`로 사람이 확인하고(§21 미검증 항목), 여기서는
// **무엇을 보내는가**를 붙든다: 메일함은 우리가 지킬 수 없는 곳이라 실린 내용이 곧 노출 범위다.
import { describe, expect, it, vi } from 'vitest';

import type { SmtpConfig } from '../../config/env';
import { createConsoleMailService, createSmtpMailService } from './smtpMailService';

const CONFIG: SmtpConfig = {
  host: 'smtp.example.com', port: 587, secure: false,
  user: 'u', password: 'p', from: 'Trip Canvas <no-reply@example.com>'
};

/** nodemailer Transporter 자리 — 보낸 것을 그대로 받아 둔다 */
function fakeTransport() {
  const sent: Record<string, string>[] = [];
  const sendMail = vi.fn(async (message: Record<string, string>) => { sent.push(message); return { messageId: 'm-1' }; });
  return { sent, transport: { sendMail } as never };
}

describe('보내는 것', () => {
  it('확인 메일과 재설정 메일은 제목이 다르고, 링크와 From이 설정대로 실린다', async () => {
    const { sent, transport } = fakeTransport();
    const mail = createSmtpMailService(CONFIG, transport);

    await mail.sendVerificationEmail('a@example.com', 'https://api.test/api/auth/verify-email?token=t1');
    await mail.sendPasswordReset('a@example.com', 'https://api.test/reset?token=t2');

    expect(sent).toHaveLength(2);
    expect(sent[0]!.subject).toContain('이메일 확인');
    expect(sent[1]!.subject).toContain('비밀번호 재설정');
    for (const m of sent) {
      expect(m.from).toBe(CONFIG.from);
      expect(m.to).toBe('a@example.com');
      // 메일 클라이언트가 HTML을 못 그릴 때를 위해 text도 함께 — 링크가 양쪽에 있어야 쓸모가 있다
      expect(m.text).toContain('https://api.test/');
      expect(m.html).toContain('https://api.test/');
    }
    expect(sent[0]!.text).toContain('t1');
    expect(sent[1]!.text).toContain('t2');
  });

  it('여행 내용·이름을 싣지 않는다 — 링크와 안내뿐이다', async () => {
    const { sent, transport } = fakeTransport();
    await createSmtpMailService(CONFIG, transport).sendVerificationEmail('a@example.com', 'https://api.test/v?token=t');

    const all = sent[0]!.text + sent[0]!.html;
    // 받는 사람의 이메일조차 본문에 넣지 않는다(전달되면 그대로 새어 나간다)
    expect(all).not.toContain('a@example.com');
    expect(all).toContain('요청한 적이 없다면');
  });

  it('링크에 든 특수문자를 HTML로 흘리지 않는다', async () => {
    const { sent, transport } = fakeTransport();
    await createSmtpMailService(CONFIG, transport)
      .sendVerificationEmail('a@example.com', 'https://api.test/v?token=t&x="><script>alert(1)</script>');

    expect(sent[0]!.html).not.toContain('<script>');
    expect(sent[0]!.html).toContain('&amp;');
  });

  it('발송이 실패하면 삼키지 않고 던진다 — 조용히 안 간 메일이 제일 나쁘다', async () => {
    const transport = { sendMail: vi.fn(async () => { throw new Error('550 rejected'); }) } as never;
    await expect(createSmtpMailService(CONFIG, transport).sendVerificationEmail('a@example.com', 'https://api.test/v'))
      .rejects.toThrow('550');
  });
});

describe('SMTP가 없을 때', () => {
  it('메일을 삼키지 않고 링크를 로그로 남긴다 — 로컬에서 가입을 끝낼 수 있어야 한다', async () => {
    const lines: string[] = [];
    const mail = createConsoleMailService((m) => lines.push(m));
    await mail.sendVerificationEmail('a@example.com', 'https://api.test/v?token=t');
    await mail.sendPasswordReset('a@example.com', 'https://api.test/r?token=t');

    expect(lines[0]).toContain('VERIFY');
    expect(lines[0]).toContain('https://api.test/v?token=t');
    expect(lines[1]).toContain('RESET');
  });
});
