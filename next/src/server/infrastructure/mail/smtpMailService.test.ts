// SMTP 어댑터. 실제 발송은 `npm run mail:test`로 사람이 확인하고(§21 미검증 항목), 여기서는
// **무엇을 보내는가**를 붙든다: 메일함은 우리가 지킬 수 없는 곳이라 실린 내용이 곧 노출 범위다.
import { describe, expect, it, vi } from 'vitest';

import type { SmtpConfig } from '../../config/env';
import { createConsoleMailService, createSmtpMailService, maskEmail } from './smtpMailService';

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

// 2026-09-06: 한 계정이 "메일이 안 온다"고 신고했는데 **성공도 실패도 로그가 없어서**
// 앱이 보냈는지 릴레이가 삼켰는지 알 수 없었다. 그 상태를 다시 만들지 않는다.
describe('발송 결과를 남긴다', () => {
  const CONFIG_2 = { host: 'smtp.test', port: 587, secure: false, user: null, password: null,
                     from: 'With J <no-reply@test>' };

  it('수락되면 릴레이 응답까지 로그에 남는다', async () => {
    const logs: string[] = [];
    const tx = { sendMail: async () => ({ accepted: ['t@example.com'], rejected: [], response: '250 2.0.0 OK 1' }) };
    const mail = createSmtpMailService(CONFIG_2, tx as never, (m) => logs.push(m));

    await mail.sendVerificationEmail('tester@example.com', 'https://x/verify?token=t');

    expect(logs).toHaveLength(1);
    expect(logs[0]).toContain('250 2.0.0 OK');
    expect(logs[0]).toContain('이메일 확인');
    // 주소를 통째로 남기지 않는다 — 운영 로그는 오래 남는다
    expect(logs[0]).toContain('t***@example.com');
    expect(logs[0]).not.toContain('tester@example.com');
  });

  /** 릴레이가 250을 주면서 수신자만 거절할 수 있다 — 그건 '보냈다'가 아니다. */
  it('수신자가 거절되면 실패로 다룬다', async () => {
    const logs: string[] = [];
    const tx = { sendMail: async () => ({ accepted: [], rejected: ['t@example.com'], response: '250 queued' }) };
    const mail = createSmtpMailService(CONFIG_2, tx as never, (m) => logs.push(m));

    await expect(mail.sendVerificationEmail('t@example.com', 'https://x/v')).rejects.toThrow(/받지 않았습니다/);
    expect(logs.some((l) => l.includes('발송 실패'))).toBe(true);
  });

  it('던져진 오류도 로그에 남고 그대로 올라간다', async () => {
    const logs: string[] = [];
    const tx = { sendMail: async () => { throw new Error('535 인증 실패'); } };
    const mail = createSmtpMailService(CONFIG_2, tx as never, (m) => logs.push(m));

    await expect(mail.sendPasswordReset('t@example.com', 'https://x/r')).rejects.toThrow('535 인증 실패');
    expect(logs.some((l) => l.includes('535 인증 실패'))).toBe(true);
  });

  /** ⚠️ accepted를 안 채우는 transport가 있다 — 그걸 실패로 보면 멀쩡한 발송이 막힌다. */
  it('accepted가 비어도 명시적 거절이 없으면 성공이다', async () => {
    const logs: string[] = [];
    const tx = { sendMail: async () => ({ response: '250 OK' }) };
    const mail = createSmtpMailService(CONFIG_2, tx as never, (m) => logs.push(m));

    await mail.sendVerificationEmail('t@example.com', 'https://x/v');
    expect(logs.some((l) => l.includes('발송 실패'))).toBe(false);
  });

  it('마스킹은 주소 모양이 이상해도 안전하다', () => {
    expect(maskEmail('a@b.com')).toBe('a***@b.com');
    expect(maskEmail('@b.com')).toBe('***');
    expect(maskEmail('없는주소')).toBe('***');
  });
});
