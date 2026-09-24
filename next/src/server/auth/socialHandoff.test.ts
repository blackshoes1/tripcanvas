import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createTestDatabase, type TestDatabase } from '../infrastructure/database/testDb';
import { createBetterAuth, type BetterAuthInstance } from './betterAuth';
import { challengeFor, exchangeSocialLogin, finishSocialLogin, openHandoff, sealHandoff, startSocialLogin } from './socialHandoff';
import { readSocialProviders, enabledSocialProviders } from './socialProviders';

const opts = { secret: 'test-secret-at-least-32-characters-long!!', baseURL: 'https://api.test', webBaseURL: 'https://web.test', socialProviders: {} };
const verifier = 'a'.repeat(64);
let db: TestDatabase;
let auth: BetterAuthInstance;
beforeEach(async () => {
  db = await createTestDatabase();
  auth = createBetterAuth({ ...opts, db: db.db, mail: { async sendVerificationEmail() {}, async sendPasswordReset() {} } });
});
afterEach(async () => { vi.unstubAllGlobals(); await db.close(); });

async function signedSession() {
  await auth.api.signUpEmail({ body: { name: 'Test', email: 'test@example.com', password: 'valid-long-password' } });
  const ctx = await auth.$context;
  const user = await ctx.internalAdapter.findUserByEmail('test@example.com');
  await ctx.internalAdapter.updateUser(user!.user.id, { emailVerified: true });
  const response = await auth.api.signInEmail({ body: { email: 'test@example.com', password: 'valid-long-password' }, asResponse: true });
  return response.headers.get('set-auth-token')!;
}

it('enables only fully configured providers and never treats provider names as verified emails', () => {
  const providers = readSocialProviders({ OAUTH_GOOGLE_CLIENT_ID: 'id', OAUTH_GOOGLE_CLIENT_SECRET: 'secret', OAUTH_NAVER_CLIENT_ID: 'incomplete' });
  expect(enabledSocialProviders(providers)).toEqual(['google']);
  expect(providers.google).toMatchObject({ requireEmailVerification: true });
});

it('binds encrypted handoff to verifier and rejects tampering and wrong key', async () => {
  const ticket = await sealHandoff('private-one-time-token', challengeFor(verifier), opts.secret);
  expect(ticket).not.toContain('private-one-time-token');
  expect(await openHandoff(ticket, verifier, opts.secret)).toBe('private-one-time-token');
  await expect(openHandoff(ticket, 'b'.repeat(64), opts.secret)).rejects.toThrow();
  await expect(openHandoff(ticket.slice(0, -8) + 'tampered', verifier, opts.secret)).rejects.toThrow();
  await expect(openHandoff(ticket, verifier, 'wrong-key')).rejects.toThrow();
});

it('rejects unconfigured providers and invalid challenge', async () => {
  const response = await startSocialLogin(new Request(`${opts.baseURL}/api/auth/social/start?provider=google&client=ios&challenge=bad`), auth, opts);
  expect(response.status).toBe(400);
});

it('does not mint a ticket from direct finish requests', async () => {
  const response = Response.redirect(`${opts.baseURL}/api/auth/social/finish?client=ios&challenge=${challengeFor(verifier)}`);
  const result = await finishSocialLogin(new Request(`${opts.baseURL}/api/auth/social/finish`), response, auth, opts);
  expect(result).toBe(response);
});

it('exchanges once into a signed bearer session and wrong verifier does not consume it', async () => {
  const signed = await signedSession();
  const headers = new Headers({ authorization: `Bearer ${signed}` });
  const ott = await auth.api.generateOneTimeToken({ headers });
  const ticket = await sealHandoff(ott.token, challengeFor(verifier), opts.secret);
  const exchange = (proof: string) => exchangeSocialLogin(new Request(`${opts.baseURL}/api/auth/social/exchange`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ticket, verifier: proof })
  }), auth, opts);
  expect((await exchange('b'.repeat(64))).status).toBe(400);
  const response = await exchange(verifier);
  expect(response.status).toBe(200);
  expect(response.headers.get('cache-control')).toBe('no-store');
  const result = await response.json();
  expect(result.token).toContain('.');
  expect(result.user.email).toBe('test@example.com');
  expect(await auth.api.getSession({ headers: new Headers({ authorization: `Bearer ${result.token}` }) })).toBeTruthy();
  expect((await exchange(verifier)).status).toBe(400);
});

it('replaces a successful OAuth redirect with a verifier-bound ticket, never a session token', async () => {
  const signed = await signedSession();
  const response = new Response(null, { status: 302, headers: {
    location: `${opts.baseURL}/api/auth/social/finish?client=ios&challenge=${challengeFor(verifier)}`, 'set-auth-token': signed
  } });
  const finished = await finishSocialLogin(new Request(`${opts.baseURL}/api/auth/callback/google?code=provider-code`), response, auth, opts);
  const location = new URL(finished.headers.get('location')!);
  expect(location.protocol).toBe('tripcanvas:');
  expect(location.hostname).toBe('oauth');
  expect(location.href).not.toContain(signed);
  expect(finished.headers.has('set-auth-token')).toBe(false);
  const params = new URLSearchParams(location.hash.slice(1));
  expect(params.get('social_state')).toBe(challengeFor(verifier));
  expect(await openHandoff(params.get('social_ticket')!, verifier, opts.secret)).toBeTruthy();
});

it.each([true, false])('checks provider email verification (%s) through the library callback', async (verifiedEmail) => {
  const socialProviders = { google: { clientId: 'google-test-client', clientSecret: 'google-test-secret',
    requireEmailVerification: true, getUserInfo: async () => ({ user: {
      name: 'Traveler', email: 'oauth@example.com', emailVerified: verifiedEmail
    }, data: { sub: 'google-subject', aud: 'google-test-client', azp: 'google-test-client', email: 'oauth@example.com', email_verified: verifiedEmail, exp: 9999999999, iat: 1, iss: 'https://accounts.google.com', family_name: 'Test', given_name: 'Traveler', name: 'Traveler', picture: '' } }) } };
  const configured = { ...opts, socialProviders, trustedOrigins: ['https://web.test'] };
  auth = createBetterAuth({ ...configured, db: db.db, mail: { async sendVerificationEmail() {}, async sendPasswordReset() {} } });
  const startURL = `${opts.baseURL}/api/auth/social/start?provider=google&client=web&challenge=${challengeFor(verifier)}`;
  expect((await startSocialLogin(new Request(startURL + '&webOrigin=https://evil.test'), auth, configured)).status).toBe(400);
  const start = await startSocialLogin(new Request(startURL), auth, configured);
  expect(start.status).toBe(302);
  const state = new URL(start.headers.get('location')!).searchParams.get('state');
  expect(state).toBeTruthy();
  const cookie = start.headers.getSetCookie().map(value => value.split(';')[0]).join('; ');
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ access_token: 'provider-token', token_type: 'Bearer', expires_in: 3600 })));
  const callback = new Request(`${opts.baseURL}/api/auth/callback/google?code=test-code&state=${state}`, { headers: { cookie } });
  const finished = await finishSocialLogin(callback, await auth.handler(callback), auth, configured);
  const target = new URL(finished.headers.get('location')!);
  expect(target.origin).toBe('https://web.test');
  const ticket = new URLSearchParams(target.hash.slice(1)).get('social_ticket');
  if (!verifiedEmail) {
    expect(ticket).toBeNull();
    expect(new URLSearchParams(target.hash.slice(1)).get('social_error')).toBe('EMAIL_NOT_VERIFIED');
    return;
  }
  expect(ticket).toBeTruthy();
  const exchange = await exchangeSocialLogin(new Request(`${opts.baseURL}/api/auth/social/exchange`, { method: 'POST',
    body: JSON.stringify({ ticket, verifier }) }), auth, configured);
  expect(exchange.status).toBe(200);
  expect((await exchange.json()).user.email).toBe('oauth@example.com');
  const replay = await auth.handler(callback);
  expect(replay.headers.get('set-auth-token')).toBeNull();
});
