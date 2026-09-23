// OAuth state·provider 검증과 세션 발급은 Better Auth가 담당한다.
// 앱으로 전달하는 것은 1분짜리 암호화된 일회용 교환권이다. 시작한 기기의 PKCE verifier가
// 없으면 교환할 수 없고, 세션 토큰은 HTTPS 응답으로만 전달한다.
import { createHash, timingSafeEqual } from 'node:crypto';
import { EncryptJWT, jwtDecrypt } from 'jose';
import type { BetterAuthInstance } from './betterAuth';
import { enabledSocialProviders, type SocialProvider, type SocialProviders } from './socialProviders';

export interface SocialHandoffOptions {
  secret: string;
  baseURL: string;
  webBaseURL: string;
  socialProviders: SocialProviders;
  trustedOrigins?: string[];
}
const CHALLENGE = /^[A-Za-z0-9_-]{43}$/;
const VERIFIER = /^[A-Za-z0-9._~-]{43,128}$/;
const FINISH = '/api/auth/social/finish';
const noStore = { 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' };

function encryptionKey(secret: string) {
  return createHash('sha256').update(`withj-social-handoff-v1:${secret}`).digest();
}
export function challengeFor(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url');
}
export async function sealHandoff(token: string, challenge: string, secret: string): Promise<string> {
  return new EncryptJWT({ token, challenge }).setProtectedHeader({ alg: 'dir', enc: 'A256GCM' })
    .setIssuer('withj-social').setAudience('withj-social-exchange').setIssuedAt().setExpirationTime('60s')
    .encrypt(encryptionKey(secret));
}
export async function openHandoff(ticket: string, verifier: string, secret: string): Promise<string> {
  if (!VERIFIER.test(verifier) || ticket.length > 4096) throw new Error('Invalid handoff');
  const { payload } = await jwtDecrypt(ticket, encryptionKey(secret), {
    issuer: 'withj-social', audience: 'withj-social-exchange', keyManagementAlgorithms: ['dir'], contentEncryptionAlgorithms: ['A256GCM']
  });
  if (typeof payload.challenge !== 'string' || !CHALLENGE.test(payload.challenge) || typeof payload.token !== 'string') throw new Error('Invalid handoff');
  if (!timingSafeEqual(Buffer.from(payload.challenge), Buffer.from(challengeFor(verifier)))) throw new Error('Invalid verifier');
  return payload.token;
}
function destination(client: string, opts: SocialHandoffOptions, values: Record<string, string>, webOrigin?: string | null) {
  const url = new URL(client === 'ios' ? 'tripcanvas://oauth' : (webOrigin || opts.webBaseURL));
  url.hash = new URLSearchParams(values).toString();
  return url.toString();
}
function failure(status = 400) {
  return Response.json({ code: 'SOCIAL_LOGIN_FAILED', message: '로그인을 완료하지 못했어요. 처음부터 다시 시도해 주세요.' }, { status, headers: noStore });
}

export async function startSocialLogin(request: Request, auth: BetterAuthInstance, opts: SocialHandoffOptions): Promise<Response> {
  const query = new URL(request.url).searchParams;
  const provider = query.get('provider');
  const client = query.get('client');
  const challenge = query.get('challenge') ?? '';
  const webOrigin = query.get('webOrigin');
  if (webOrigin && !(opts.trustedOrigins ?? [new URL(opts.webBaseURL).origin]).includes(webOrigin)) return failure();
  if (!enabledSocialProviders(opts.socialProviders).some(p => p === provider) || !['web', 'ios'].includes(client ?? '') || !CHALLENGE.test(challenge)) return failure();
  const callback = new URL(FINISH, opts.baseURL);
  callback.searchParams.set('client', client!);
  callback.searchParams.set('challenge', challenge);
  if (webOrigin) callback.searchParams.set('webOrigin', webOrigin);
  const response = await auth.api.signInSocial({
    body: { provider: provider as SocialProvider, callbackURL: callback.toString(), errorCallbackURL: callback.toString(), disableRedirect: true },
    headers: request.headers, asResponse: true
  });
  if (!response.ok) return failure();
  const result = await response.json();
  if (typeof result.url !== 'string' || !result.url.startsWith('https://')) return failure();
  const headers = new Headers(noStore);
  for (const cookie of response.headers.getSetCookie()) headers.append('set-cookie', cookie);
  headers.set('location', result.url);
  return new Response(null, { status: 302, headers });
}

/** OAuth 콜백이 방금 발급한 세션만 교환권으로 만든다. finish URL 직접 호출로는 발급하지 않는다. */
export async function finishSocialLogin(request: Request, response: Response, auth: BetterAuthInstance, opts: SocialHandoffOptions): Promise<Response> {
  if (!new URL(request.url).pathname.startsWith('/api/auth/callback/')) return response;
  const location = response.headers.get('location');
  if (!location) return response;
  const callback = new URL(location, opts.baseURL);
  if (callback.origin !== new URL(opts.baseURL).origin || callback.pathname !== FINISH) return response;
  const client = callback.searchParams.get('client') ?? '';
  const challenge = callback.searchParams.get('challenge') ?? '';
  const webOrigin = callback.searchParams.get('webOrigin');
  if (webOrigin && !(opts.trustedOrigins ?? [new URL(opts.webBaseURL).origin]).includes(webOrigin)) return failure();
  if (!['web', 'ios'].includes(client) || !CHALLENGE.test(challenge)) return failure();
  const headers = new Headers(response.headers);
  for (const [key, value] of Object.entries(noStore)) headers.set(key, value);
  const token = response.headers.get('set-auth-token');
  // 성공 토큰과 제공자 토큰은 URL·로그·브라우저 기록에 넣지 않는다.
  headers.delete('set-auth-token');
  if (!token || callback.searchParams.has('error')) {
    const error = callback.searchParams.get('error') === 'email_not_verified' ? 'EMAIL_NOT_VERIFIED' : 'SOCIAL_LOGIN_FAILED';
    headers.set('location', destination(client, opts, { social_error: error, social_state: challenge }, webOrigin));
  } else {
    const sessionHeaders = new Headers({ authorization: `Bearer ${token}` });
    const session = await auth.api.getSession({ headers: sessionHeaders });
    if (!session?.user.emailVerified) {
      headers.set('location', destination(client, opts, { social_error: 'EMAIL_NOT_VERIFIED', social_state: challenge }, webOrigin));
    } else {
      const oneTime = await auth.api.generateOneTimeToken({ headers: sessionHeaders });
      const ticket = await sealHandoff(oneTime.token, challenge, opts.secret);
      headers.set('location', destination(client, opts, { social_ticket: ticket, social_state: challenge }, webOrigin));
    }
  }
  return new Response(null, { status: 302, headers });
}

export async function exchangeSocialLogin(request: Request, auth: BetterAuthInstance, opts: SocialHandoffOptions): Promise<Response> {
  try {
    const text = await request.text();
    if (text.length > 6000) return failure();
    const body = JSON.parse(text);
    if (typeof body.ticket !== 'string' || typeof body.verifier !== 'string') return failure();
    const token = await openHandoff(body.ticket, body.verifier, opts.secret);
    const verified = await auth.api.verifyOneTimeToken({ body: { token }, asResponse: true });
    if (!verified.ok) return failure();
    const data = await verified.json();
    const bearer = verified.headers.get('set-auth-token');
    if (!bearer || !data.user?.emailVerified) return failure();
    return Response.json({ token: bearer, user: { id: data.user.id, email: data.user.email } }, { headers: noStore });
  } catch { return failure(); }
}
