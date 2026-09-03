// SMTP 어댑터(§21). NAS에서 메일 서버를 직접 운영하지 않는다 — 외부 provider의 SMTP를 쓴다.
// 본문은 짧게: 링크 하나와 유효기간. 여행 내용·이름은 넣지 않는다(메일함은 우리가 지킬 수 없는 곳이다).
import nodemailer, { type Transporter } from 'nodemailer';

import type { SmtpConfig } from '../../config/env';
import type { MailService } from './types';

const escape = (s: string) => s.replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c);

function body(title: string, lead: string, action: string, url: string): { text: string; html: string } {
  const text = `${title}\n\n${lead}\n\n${url}\n\n요청한 적이 없다면 이 메일을 무시하세요.`;
  const html = `<div style="font-family:system-ui,-apple-system,sans-serif;line-height:1.6;color:#1f2430">
  <h2 style="margin:0 0 12px">${escape(title)}</h2>
  <p style="margin:0 0 20px">${escape(lead)}</p>
  <p style="margin:0 0 20px"><a href="${escape(url)}" style="display:inline-block;padding:10px 18px;background:#1d6fd6;color:#fff;border-radius:8px;text-decoration:none">${escape(action)}</a></p>
  <p style="margin:0;color:#6b7280;font-size:13px">요청한 적이 없다면 이 메일을 무시하세요.</p>
</div>`;
  return { text, html };
}

/**
 * 설정 → nodemailer transport. 어댑터와 점검 도구(`npm run mail:test`)가 **같은 것**을 쓴다 —
 * 점검이 따로 만들면 "점검은 통과했는데 실제 발송은 안 되는" 상태가 생긴다.
 */
export function createSmtpTransport(config: SmtpConfig): Transporter {
  return nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    ...(config.user ? { auth: { user: config.user, pass: config.password ?? '' } } : {})
  });
}

export function createSmtpMailService(config: SmtpConfig, transport?: Transporter): MailService {
  const tx = transport ?? createSmtpTransport(config);

  async function send(to: string, subject: string, content: { text: string; html: string }): Promise<void> {
    await tx.sendMail({ from: config.from, to, subject, text: content.text, html: content.html });
  }

  return {
    sendVerificationEmail: (to, url) => send(to, '[Trip Canvas] 이메일 확인',
      body('이메일을 확인해 주세요', '아래 버튼을 누르면 가입이 완료되고 로그인할 수 있습니다.', '이메일 확인하기', url)),
    sendPasswordReset: (to, url) => send(to, '[Trip Canvas] 비밀번호 재설정',
      body('비밀번호를 새로 정해 주세요', '아래 버튼을 누르면 새 비밀번호를 정할 수 있습니다.', '비밀번호 재설정하기', url))
  };
}

/** SMTP가 없을 때(로컬·초기 배포) — 메일을 조용히 삼키지 않고 링크를 로그로 남긴다 */
export function createConsoleMailService(log: (message: string) => void = console.log): MailService {
  return {
    async sendVerificationEmail(to, url) { log(`[mail:VERIFY] ${to} → ${url}`); },
    async sendPasswordReset(to, url) { log(`[mail:RESET] ${to} → ${url}`); }
  };
}
