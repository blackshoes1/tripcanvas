import { expect, it, vi } from 'vitest';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import { createTestDatabase } from '../infrastructure/database/testDb';
import { createBetterAuth } from './betterAuth';
import { readSocialProviders } from './socialProviders';

it.each(['valid', 'audience', 'issuer', 'expiry', 'signature', 'nonce'])('verifies Google native ID token: %s', async (scenario) => {
  const db = await createTestDatabase();
  try {
    const webClient = '457039812975-jijh2qrbb4q8qc6k0n9efcj3drt4q5kp.apps.googleusercontent.com';
    const iosClient = '457039812975-oj50jeo2dm4k27shc8rpi8bpojd4ml8s.apps.googleusercontent.com';
    const { publicKey, privateKey } = await generateKeyPair('RS256');
    const jwk = { ...await exportJWK(publicKey), kid: 'test-google-key', alg: 'RS256', use: 'sig' };
    vi.stubGlobal('fetch', vi.fn(async (url) => {
      expect(String(url)).toBe('https://www.googleapis.com/oauth2/v3/certs');
      return Response.json({ keys: [jwk] });
    }));
    const auth = createBetterAuth({ db: db.db, secret: 'test-secret-at-least-32-characters-long!!',
      baseURL: 'https://api.test', webBaseURL: 'https://web.test',
      socialProviders: readSocialProviders({ OAUTH_GOOGLE_CLIENT_ID: webClient, OAUTH_GOOGLE_CLIENT_SECRET: 'test-secret' }),
      mail: { async sendVerificationEmail() {}, async sendPasswordReset() {} } });
    const makeToken = (changes = {}) => new SignJWT({ sub: 'google-stable-subject', email: 'native@example.com',
      email_verified: true, name: 'Traveler', nonce: 'native-nonce', azp: iosClient,
      iss: 'https://accounts.google.com', aud: webClient, iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 300, ...changes })
      .setProtectedHeader({ alg: 'RS256', kid: jwk.kid }).sign(privateKey);
    const signIn = (token: string, nonce = 'native-nonce') => auth.handler(new Request('https://api.test/api/auth/sign-in/social', {
      method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://api.test' },
      body: JSON.stringify({ provider: 'google', idToken: { token, nonce } })
    }));
    const changes = scenario === 'audience' ? { aud: iosClient }
      : scenario === 'issuer' ? { iss: 'https://attacker.test' }
      : scenario === 'expiry' ? { exp: 1 } : {};
    let token = await makeToken(changes);
    if (scenario === 'signature') token = token.slice(0, -10) + 'tampered!!';
    const response = await signIn(token, scenario === 'nonce' ? 'wrong-nonce' : 'native-nonce');
    if (scenario !== 'valid') {
      expect(response.status).toBe(401);
      expect(response.headers.get('set-auth-token')).toBeNull();
      return;
    }
    expect(response.status).toBe(200);
    const bearer = response.headers.get('set-auth-token');
    expect(bearer).toBeTruthy();
    const session = await auth.api.getSession({ headers: new Headers({ authorization: `Bearer ${bearer}` }) });
    expect(session?.user.email).toBe('native@example.com');
  } finally { vi.unstubAllGlobals(); await db.close(); }
});
