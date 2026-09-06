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

/**
 * 로그에 남길 받는 사람. 주소를 통째로 남기지 않는다 — 운영 로그는 오래 남는다.
 * `t***@gmail.com` 정도면 "누구에게 갔나"를 확인하기에 충분하다.
 */
export function maskEmail(email: string): string {
  const at = email.lastIndexOf('@');
  if (at <= 0) return '***';
  const local = email.slice(0, at);
  return `${local[0]}***${email.slice(at)}`;
}

export function createSmtpMailService(
  config: SmtpConfig,
  transport?: Transporter,
  log: (message: string) => void = (m) => console.log(`[tripcanvas-api] ${m}`)
): MailService {
  const tx = transport ?? createSmtpTransport(config);

  /**
   * ⚠️ **결과를 반드시 남긴다.** 예전에는 성공도 실패도 아무 흔적이 없어서,
   * "메일이 안 온다"는 신고를 받아도 앱이 보냈는지 릴레이가 삼켰는지 알 수 없었다
   * (2026-09-06에 한 계정을 이것 때문에 오래 뒤졌다). SMTP가 준 응답을 그대로 적는다.
   */
  async function send(to: string, subject: string, content: { text: string; html: string }): Promise<void> {
    const who = maskEmail(to);
    try {
      const info = await tx.sendMail({ from: config.from, to, subject, text: content.text, html: content.html });
      const accepted = (info?.accepted ?? []).length;
      const rejected = (info?.rejected ?? []).length;
      log(`메일 발송 → ${who} · ${subject} · 수락 ${accepted} 거절 ${rejected} · ${info?.response ?? '응답 없음'}`);
      // 릴레이가 250을 주면서 특정 수신자만 거절할 수 있다 — 그건 '보냈다'가 아니다.
      // ⚠️ `accepted === 0`은 실패로 보지 않는다: 이 값을 채우지 않는 transport가 있어서,
      //    그걸 실패로 다루면 **멀쩡한 발송이 막힌다.** 명시적 거절만 실패다.
      if (rejected > 0) {
        throw new Error(`릴레이가 수신자를 받지 않았습니다 (수락 ${accepted} 거절 ${rejected})`);
      }
    } catch (error) {
      log(`메일 발송 실패 → ${who} · ${subject} · ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }
  }

  return {
    sendVerificationEmail: (to, url) => send(to, '[With J] 이메일 확인',
      body('이메일을 확인해 주세요', '아래 버튼을 누르면 가입이 완료되고 로그인할 수 있습니다.', '이메일 확인하기', url)),
    sendPasswordReset: (to, url) => send(to, '[With J] 비밀번호 재설정',
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
