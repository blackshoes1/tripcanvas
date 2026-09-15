import { readFileSync } from 'node:fs';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { expect, it } from 'vitest';
import { MIGRATIONS_FOLDER } from './migrationsPath';

it('0010은 기존 중복·배치 상태를 보존하고 새 요청 키만 여행별로 제한한다', async () => {
  const db = new PGlite();
  try {
    const journal = JSON.parse(readFileSync(path.join(MIGRATIONS_FOLDER, 'meta/_journal.json'), 'utf8')) as {
      entries: { idx: number; tag: string }[];
    };
    const target = journal.entries.find(entry => entry.tag === '0010_candidate_place_provider');
    expect(target).toBeDefined();
    for (const entry of journal.entries.filter(entry => entry.idx < target!.idx)) {
      await db.exec(readFileSync(path.join(MIGRATIONS_FOLDER, `${entry.tag}.sql`), 'utf8'));
    }
    await db.exec(`
      insert into users(id) values ('00000000-0000-0000-0000-000000000001');
      insert into trips(id,user_id,client_id,data) values
        ('00000000-0000-0000-0000-000000000010','00000000-0000-0000-0000-000000000001','old','{}'),
        ('00000000-0000-0000-0000-000000000020','00000000-0000-0000-0000-000000000001','other','{}');
      insert into trip_candidates(trip_id,proposed_by,title,place_id,status,scheduled_ref) values
        ('00000000-0000-0000-0000-000000000010','00000000-0000-0000-0000-000000000001','기존 장소','old-google-id','SCHEDULED','2'),
        ('00000000-0000-0000-0000-000000000010','00000000-0000-0000-0000-000000000001','기존 장소','old-google-id','REJECTED',null);
    `);
    const before = (await db.query<Record<string, unknown>>('select * from trip_candidates order by id')).rows;
    await db.transaction(async tx => {
      await tx.exec(readFileSync(path.join(MIGRATIONS_FOLDER, `${target!.tag}.sql`), 'utf8'));
    });
    const after = (await db.query('select * from trip_candidates order by id')).rows;
    expect(after).toEqual(before.map(row => ({ ...row, provider: null, provider_id: null, client_key: null })));
    const insert = (tripId: string, key: string | null, providerId: string | null = null) => db.query(`
      insert into trip_candidates(trip_id,proposed_by,title,provider,provider_id,client_key)
      values ($1,'00000000-0000-0000-0000-000000000001','새 장소',$2,$3,$4) returning id`,
    [tripId, providerId ? 'kakao' : null, providerId, key]);
    const tripId = '00000000-0000-0000-0000-000000000010';
    const otherTripId = '00000000-0000-0000-0000-000000000020';
    const key = '00000000-0000-0000-0000-000000000030';
    await insert(tripId, key, '12345');
    await expect(insert(tripId, key, '67890')).rejects.toMatchObject({ code: '23505' });
    await expect(insert(tripId, null, '12345')).rejects.toMatchObject({ code: '23505' });
    await expect(insert(tripId, 'invalid')).rejects.toMatchObject({ code: '22P02' });
    await insert(otherTripId, key, '12345');
    await insert(tripId, null);
    await insert(tripId, null);
    expect((await db.query('select * from trip_candidates')).rows).toHaveLength(6);
  } finally {
    await db.close();
  }
});
