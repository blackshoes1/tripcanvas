import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { hashPassword } from 'better-auth/crypto';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { expect, it } from 'vitest';

import { MIGRATIONS_FOLDER } from '../infrastructure/database/migrationsPath';
import * as schema from '../infrastructure/database/schema';
import { createBetterAuth } from './betterAuth';

it('keeps legacy issuer values while upgrading a NOT NULL database and signing in old and new accounts', async () => {
  const previous = await mkdtemp(path.join(os.tmpdir(), 'withj-auth-upgrade-'));
  const client = new PGlite();
  try {
    await cp(MIGRATIONS_FOLDER, previous, { recursive: true });
    const journalPath = path.join(previous, 'meta', '_journal.json');
    const journal = JSON.parse(await readFile(journalPath, 'utf8'));
    journal.entries = journal.entries.filter((entry: { idx: number }) => entry.idx < 20);
    await writeFile(journalPath, JSON.stringify(journal));
    const db = drizzle(client, { schema });
    await migrate(db, { migrationsFolder: previous });
    const password = 'correct-horse-battery';
    await db.insert(schema.authUser).values({ id: 'old-user', name: '기존 사용자', email: 'old@example.com', emailVerified: true });
    await db.insert(schema.authAccount).values({
      id: 'old-account', issuer: 'legacy-issuer-to-preserve', providerId: 'credential', accountId: 'old-user',
      userId: 'old-user', password: await hashPassword(password)
    });
    const nullable = () => client.query<{ is_nullable: string }>(
      "select is_nullable from information_schema.columns where table_name='auth_account' and column_name='issuer'");
    expect((await nullable()).rows[0].is_nullable).toBe('NO');
    const before = await client.query("select * from auth_account where id='old-account'");

    await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });

    expect((await nullable()).rows[0].is_nullable).toBe('YES');
    expect((await client.query("select * from auth_account where id='old-account'")).rows).toEqual(before.rows);
    let verificationURL = '';
    const baseURL = 'https://api.test';
    const auth = createBetterAuth({ db, baseURL, webBaseURL: 'https://web.test',
      secret: 'test-secret-at-least-32-characters-long!!',
      mail: { async sendVerificationEmail(_to, url) { verificationURL = url; }, async sendPasswordReset() {} } });
    const signIn = async (email: string) => {
      const response = await auth.handler(new Request(`${baseURL}/api/auth/sign-in/email`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password })
      }));
      expect(response.status).toBe(200);
      expect(response.headers.get('set-auth-token')).toBeTruthy();
    };
    await signIn('old@example.com');
    const created = await auth.api.signUpEmail({ body: { name: '새 사용자', email: 'new@example.com', password } });
    expect(verificationURL).not.toBe('');
    expect((await auth.handler(new Request(verificationURL))).status).toBeLessThan(400);
    await signIn('new@example.com');
    expect((await client.query<{ issuer: string | null }>('select issuer from auth_account where user_id=$1', [created.user.id])).rows[0].issuer).toBe('local:credential');
  } finally {
    await client.close();
    await rm(previous, { recursive: true, force: true });
  }
});
