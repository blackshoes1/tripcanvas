// 구간 캐시 저장소 — PGlite(진짜 PostgreSQL) 위에서 같은 마이그레이션으로 돌린다.
import { beforeEach, describe, expect, it } from 'vitest';

import { PgLegCacheRepository } from './pgLegCacheRepository';
import { createTestDatabase, type TestDatabase } from './testDb';

let db: TestDatabase;
let legs: PgLegCacheRepository;

const row = (key: string, sec: number | null) => ({
  key, sec, m: sec == null ? null : sec * 10, path: sec == null ? null : 'abc',
  taxi: null, snapped: false, fail: sec == null, provider: 'kakao'
});

beforeEach(async () => {
  db = await createTestDatabase();
  legs = new PgLegCacheRepository(db.db);
});

describe('leg_cache', () => {
  it('없는 키는 조용히 빠진다 — 없는 구간을 지어내지 않는다', async () => {
    expect(await legs.getMany(['없음'])).toEqual([]);
    expect(await legs.getMany([])).toEqual([]);
  });

  it('한 번의 조회로 여러 구간을 읽는다', async () => {
    await legs.put(row('a', 600));
    await legs.put(row('b', 900));
    const found = await legs.getMany(['a', 'b', 'c']);
    expect(found.map((r) => r.key).sort()).toEqual(['a', 'b']);
    expect(found.find((r) => r.key === 'a')?.sec).toBe(600);
    expect(found[0].fetchedAt).toBeInstanceOf(Date);
  });

  it('같은 키를 다시 넣으면 덮어쓴다 — 재조회가 행을 늘리지 않는다', async () => {
    await legs.put(row('a', null));          // 실패로 먼저 남고
    await legs.put(row('a', 1200));          // 나중에 도로가 잡혔다
    const [found] = await legs.getMany(['a']);
    expect(found.fail).toBe(false);
    expect(found.sec).toBe(1200);
    expect(found.path).toBe('abc');
  });

  it('실패 행도 남는다 — 매번 다시 묻지 않으려면 "못 찾았다"도 기록이다', async () => {
    await legs.put(row('x', null));
    const [found] = await legs.getMany(['x']);
    expect(found).toMatchObject({ key: 'x', fail: true, sec: null, m: null, path: null, provider: 'kakao' });
  });
});
