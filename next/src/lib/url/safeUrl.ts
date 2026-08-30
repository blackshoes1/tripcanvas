// href 방어 — esc()류 이스케이프로는 javascript: 스킴을 못 막는다 (레거시 safeUrl과 같은 규칙).
// 상대 URL은 https 기준으로 해석해 통과시킨다 (레거시는 location.href 기준 — 동작 동일, SSR 안전).
export function safeUrl(v: unknown): string {
  const u = String(v ?? '').trim();
  if (!u) return '';
  try {
    return /^https?:$/.test(new URL(u, 'https://local.invalid').protocol) ? u : '';
  } catch {
    return '';
  }
}
