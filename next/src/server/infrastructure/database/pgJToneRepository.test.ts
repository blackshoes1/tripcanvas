import { expect, it } from 'vitest';
import { createTestDatabase } from './testDb';
import { PgUserRepository } from './pgUserRepository';
import { PgJToneRepository } from './pgJToneRepository';

it('운영과 같은 마이그레이션으로 개인 설정을 저장하고 ensure 뒤에도 유지한다', async () => {
  const db = await createTestDatabase();
  try {
    const users = new PgUserRepository(db.db), tones = new PgJToneRepository(db.db);
    const a = '00000000-0000-0000-0000-00000000000a', b = '00000000-0000-0000-0000-00000000000b';
    for (const id of [a, b]) await users.ensure({ id, email: null });
    expect(await tones.read(a)).toBe('FRIENDLY');
    await tones.save(a, 'POLITE');
    await users.ensure({ id: a, email: null });
    expect(await new PgJToneRepository(db.db).read(a)).toBe('POLITE');
    expect(await tones.read(b)).toBe('FRIENDLY');
  } finally { await db.close(); }
});
