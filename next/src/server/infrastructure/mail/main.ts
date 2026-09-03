// SMTP 실제 발송 점검. 자체 Auth를 켜기 **전에** 반드시 한 번 돌린다.
//
//   npm run tools:build
//   npm run mail:test                      연결·인증만 확인한다 (아무것도 보내지 않는다)
//   npm run mail:test -- you@example.com   확인 메일·재설정 메일을 실제로 보낸다
//
// 왜 필요한가: SMTP가 안 되면 가입도 비밀번호 재설정도 **아무도 완료할 수 없다**.
// 기존 사용자는 자체 Auth로 넘어올 때 재설정 메일이 유일한 통로라(§19), 그날 이게 막혀 있으면
// 전원이 잠긴다. 그래서 "설정했다"가 아니라 "받았다"를 사람이 눈으로 확인한다.
//
// 앱과 **같은 어댑터·같은 본문**을 쓴다. 점검용 메일을 따로 만들면 점검의 뜻이 없다.
import { parseEnv } from '../../config/env';
import { createSmtpMailService, createSmtpTransport } from './smtpMailService';

/** 무엇으로 붙는지 보여주되 비밀번호는 절대 찍지 않는다(§63) */
function describe(config: { host: string; port: number; secure: boolean; user: string | null; from: string }): string {
  return [
    `  host   ${config.host}:${config.port}${config.secure ? ' (TLS)' : ' (STARTTLS)'}`,
    `  user   ${config.user ?? '(익명)'}`,
    `  from   ${config.from}`
  ].join('\n');
}

async function main(): Promise<void> {
  const to = process.argv.slice(2).find((a) => !a.startsWith('-'));
  const env = parseEnv(process.env);

  if (!env.smtp) {
    console.error('[mail] SMTP가 설정되지 않았다 — SMTP_HOST 와 MAIL_FROM 이 **둘 다** 있어야 한다.');
    console.error('       (선택: SMTP_PORT 기본 587 · SMTP_SECURE · SMTP_USER · SMTP_PASSWORD)');
    console.error('       설정하지 않으면 앱은 메일을 삼키지 않고 링크를 로그로 남긴다 — 운영에서는 그걸로 부족하다.');
    process.exitCode = 1;
    return;
  }

  console.log('[mail] 설정');
  console.log(describe(env.smtp));

  const transport = createSmtpTransport(env.smtp);
  try {
    // 연결·인증만 본다. 여기서 걸리면 host·port·secure·계정 문제고, 통과하면 남은 건 전달률이다.
    await transport.verify();
    console.log('[mail] 연결·인증 OK');
  } catch (err) {
    console.error(`[mail] 연결·인증 실패 — ${err instanceof Error ? err.message : String(err)}`);
    console.error('       secure/port 조합을 먼저 의심할 것: 465는 secure=true, 587은 false(STARTTLS).');
    process.exitCode = 1;
    transport.close();
    return;
  }

  if (!to) {
    console.log('[mail] 받는 주소를 주면 실제로 보낸다:  npm run mail:test -- you@example.com');
    transport.close();
    return;
  }

  // 앱이 보내는 것과 같은 함수·같은 본문. 링크는 눌러도 아무 일이 없는 점검용이다.
  const mail = createSmtpMailService(env.smtp, transport);
  const base = env.apiBaseUrl || 'https://example.invalid';
  try {
    await mail.sendVerificationEmail(to, `${base}/api/auth/verify-email?token=MAIL-TEST-NOT-A-REAL-TOKEN`);
    console.log(`[mail] 확인 메일 발송 → ${to}`);
    await mail.sendPasswordReset(to, `${base}/api/auth/reset-password?token=MAIL-TEST-NOT-A-REAL-TOKEN`);
    console.log(`[mail] 재설정 메일 발송 → ${to}`);
  } catch (err) {
    console.error(`[mail] 발송 실패 — ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
    transport.close();
    return;
  } finally {
    transport.close();
  }

  console.log('');
  console.log('[mail] 받은 편지함에서 확인할 것:');
  console.log('  1. 두 통이 **도착**했는가 (스팸함도 볼 것 — 스팸으로 가면 실패로 친다)');
  console.log('  2. 보낸 사람이 MAIL_FROM 그대로인가');
  console.log('  3. 버튼과 본문 링크가 눌리는가 (토큰은 가짜라 열면 오류가 정상이다)');
  console.log('  4. 제목이 깨지지 않았는가 (한글 인코딩)');
  console.log('');
  console.log('  스팸으로 갔다면 SPF·DKIM을 provider 안내대로 맞춘 뒤 다시 돌린다 —');
  console.log('  전달률은 코드로 고칠 수 없고, 이걸 넘기면 전환 당일 아무도 로그인하지 못한다.');
}

void main();
