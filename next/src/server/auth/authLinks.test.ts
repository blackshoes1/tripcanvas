// 메일 속 링크는 **사람이 도착할 곳**이어야 한다. API 호스트에는 화면이 없어서,
// 2026-09-04 전환에서 재설정 링크가 `https://<api>/?error=INVALID_TOKEN` 으로 떨어졌다.
import { describe, expect, it } from 'vitest';

import { resetLink, withWebCallback } from './betterAuth';

const WEB = 'https://tripcanvas-ai.vercel.app';

describe('재설정 링크', () => {
  it('웹으로 직접 보낸다 — 새 비밀번호를 받는 화면은 웹에만 있다', () => {
    expect(resetLink('tok123', WEB)).toBe(`${WEB}/#reset=tok123`);
  });

  it('주소 끝의 슬래시가 겹치지 않는다', () => {
    expect(resetLink('t', `${WEB}/`)).toBe(`${WEB}/#reset=t`);
  });

  it('토큰을 그대로 이어 붙이지 않는다 — 해시가 깨지지 않게 인코딩한다', () => {
    expect(resetLink('a b#c', WEB)).toBe(`${WEB}/#reset=a%20b%23c`);
  });
});

describe('확인 링크', () => {
  it('검증은 API가 하고 도착지만 웹으로 바꾼다', () => {
    const url = withWebCallback('https://api.test/api/auth/verify-email?token=abc&callbackURL=%2F', WEB);
    const parsed = new URL(url);
    expect(parsed.origin + parsed.pathname).toBe('https://api.test/api/auth/verify-email');
    expect(parsed.searchParams.get('token')).toBe('abc');
    expect(parsed.searchParams.get('callbackURL')).toBe(`${WEB}/#verified=1`);
  });

  it('모양이 예상과 다르면 라이브러리가 준 것을 그대로 쓴다', () => {
    expect(withWebCallback('not a url', WEB)).toBe('not a url');
  });
});
