// 실제 PostgreSQL 전용. 운영 DATABASE_URL은 읽지 않고 매번 새 임시 DB를 만든다.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { readFileSync } = require('node:fs');
const { setTimeout: delay } = require('node:timers/promises');
const { Client, Pool } = require('pg');
const { drizzle } = require('drizzle-orm/node-postgres');
const { migrate } = require('drizzle-orm/node-postgres/migrator');

test('실제 PostgreSQL: CAS 권한 잠금과 경로 예산의 동시성', { timeout: 60000 }, async t => {
  const host = process.env.TC_PGHOST;
  const containerTest = process.env.TC_PG_TEST_CONTAINER === '1' && host === '127.0.0.1';
  assert.ok(host && (host.startsWith('/tmp/tripcanvas-pg') || containerTest),
    'scripts/pg-local.sh의 임시 클러스터가 필요하다. 운영 DATABASE_URL은 사용하지 않는다.');
  const config = { host, port: Number(process.env.TC_PGPORT || 5499), user: 'postgres',
    connectionTimeoutMillis: 5000, statement_timeout: 10000 };
  const name = `tc_concurrency_${process.pid}_${Date.now().toString(36)}`;
  const admin = new Client({ ...config, database: 'postgres' });
  await admin.connect();
  await admin.query(`create database ${name}`);
  const writer = new Pool({ ...config, database: name, max: 6, application_name: 'tc-cas-writer' });
  const other = new Pool({ ...config, database: name, max: 6, application_name: 'tc-role-manager' });
  try {
    const schema = require('../dist-tools/server/infrastructure/database/schema.js');
    const { PgTripRepository } = require('../dist-tools/server/infrastructure/database/pgTripRepository.js');
    const { PgLegFillUsageRepository } = require('../dist-tools/server/infrastructure/database/pgLegFillUsageRepository.js');
    const { PgDailyMomentRepository } = require('../dist-tools/server/infrastructure/database/pgDailyMomentRepository.js');
    const db = drizzle(writer, { schema });
    const otherDb = drizzle(other, { schema });
    await migrate(db, { migrationsFolder: path.join(__dirname, '../src/server/infrastructure/database/migrations') });
    const owner = randomUUID(), editor = randomUUID();
    await writer.query('insert into users(id) values($1),($2)', [owner, editor]);
    const repo = new PgTripRepository(db);
    for (const change of [{ role: 'VIEWER', status: 'ACTIVE' }, { role: 'EDITOR', status: 'REMOVED' }]) {
      await t.test(`권한 변경이 먼저 잠갔으면 CAS는 ${change.role}/${change.status}를 기다려 재확인`, async () => {
        const record = await repo.create({ ownerId: owner, clientId: randomUUID(), data: { name: 'original', days: [] } });
        await writer.query("insert into trip_members(trip_id,user_id,role,status) values($1,$2,'EDITOR','ACTIVE')", [record.id, editor]);
        const manager = await other.connect();
        let pending;
        try {
          await manager.query('begin');
          await manager.query('update trip_members set role=$1,status=$2 where trip_id=$3 and user_id=$4',
            [change.role, change.status, record.id, editor]);
          pending = repo.updateCas(record.id, { name: 'unauthorized', days: [] }, 1,
            { actorId: editor, authorize: role => role === 'OWNER' || role === 'EDITOR' });
          // 단순 Promise.all 대신 DB가 잠금에서 실제로 기다리는 것을 확인한다.
          let blocked = false;
          for (let i = 0; i < 250; i++) {
            const { rows } = await admin.query("select 1 from pg_stat_activity where datname=$1 and application_name='tc-cas-writer' and wait_event_type='Lock' and query like '%trip_members%'", [name]);
            if (rows.length) { blocked = true; break; }
            await delay(20);
          }
          await manager.query('commit');
          const result = await pending;
          assert.ok(blocked, '별도 연결의 역할 잠금이 CAS를 실제로 막았다');
          assert.equal(result.forbidden, true);
          const { rows } = await writer.query('select data,revision from trips where id=$1', [record.id]);
          assert.deepEqual(rows[0].data, { name: 'original', days: [] });
          assert.equal(Number(rows[0].revision), 1);
        } finally {
          await manager.query('rollback');
          if (pending) await pending.catch(() => {});
          manager.release();
        }
      });
    }
    await t.test('같은 revision의 서로 다른 동시 저장은 하나만 반영', async () => {
      const record = await repo.create({ ownerId: owner, clientId: randomUUID(), data: { name: 'initial', days: [] } });
      const secondRepo = new PgTripRepository(otherDb);
      const opts = { actorId: owner, authorize: role => role === 'OWNER' };
      const result = await Promise.all([
        repo.updateCas(record.id, { name: 'first', days: [] }, 1, opts),
        secondRepo.updateCas(record.id, { name: 'second', days: [] }, 1, opts)
      ]);
      assert.equal(result.filter(x => x.applied).length, 1);
      assert.equal(result.filter(x => x.conflict).length, 1);
      assert.equal(result[0].record.revision, 2);
      assert.equal(result[1].record.revision, 2);
    });
    await t.test('개인 선택 저장과 거두기는 커밋 뒤 내용 없는 갱신 신호를 발행', async () => {
      const record = await repo.create({ ownerId: owner, clientId: randomUUID(), data: { name: 'signal', days: [] } });
      const listener = await other.connect(), notifications = [];
      const receive = msg => { const body = JSON.parse(msg.payload); if (body.tripId === record.id) notifications.push(body); };
      listener.on('notification', receive);
      try {
        await listener.query('listen tc_realtime');
        const moments = new PgDailyMomentRepository(db);
        const input = { tripId: record.id, userId: owner, dayKey: 'date:2026-10-16', expectedRevision: 1, spotKey: 'cafe', spotName: 'private wish' };
        for (const spotKey of ['cafe', null]) {
          const expected = notifications.length + 1;
          await moments.save({ ...input, spotKey });
          for (let count = 0; count < 100 && notifications.length < expected; count++) await delay(10);
          assert.equal(notifications.length, expected);
          assert.deepEqual(notifications.at(-1), { tripId: record.id, clientId: record.clientId, id: 0, kind: 'DAILY_MOMENT_CHANGED', actorId: owner });
          assert.equal(JSON.stringify(notifications).includes('private wish'), false);
        }
        assert.equal((await moments.list(record.id, input.dayKey)).length, 0);
        assert.equal(Number((await writer.query('select revision from trips where id=$1', [record.id])).rows[0].revision), 1);
        await assert.rejects(moments.save({ ...input, expectedRevision: 2 }));
        await delay(20); assert.equal(notifications.length, 2);
      } finally {
        await listener.query('unlisten tc_realtime'); listener.off('notification', receive); listener.release();
      }
    });
    await t.test('개인별 오늘 하나는 동시 저장·거두기에도 일행 행과 다른 날을 보존', async () => {
      const record = await repo.create({ ownerId: owner, clientId: randomUUID(), data: { name: 'moments', days: [] } });
      await writer.query("insert into trip_members(trip_id,user_id,role,status,display_name) values($1,$2,'VIEWER','ACTIVE','영희')", [record.id, editor]);
      const first = new PgDailyMomentRepository(db), second = new PgDailyMomentRepository(otherDb);
      const own = { tripId: record.id, userId: owner, dayKey: 'date:2026-10-15', expectedRevision: 1, spotKey: 'cafe', spotName: '카페' };
      const companion = { ...own, userId: editor, spotKey: 'sunset', spotName: '노을' };
      await Promise.all([first.save(own), second.save(companion)]);
      assert.equal((await first.list(record.id, own.dayKey)).length, 2);
      await first.save({ ...own, dayKey: 'date:2026-10-16', spotKey: 'park', spotName: '공원' });
      await Promise.all([first.save({ ...own, spotKey: null, spotName: null }), second.save({ ...companion, spotName: '저녁 노을' })]);
      const today = await first.list(record.id, own.dayKey);
      assert.equal(today.length, 1);
      assert.equal(today[0].userId, editor);
      assert.equal(today[0].spotName, '저녁 노을');
      assert.equal((await first.list(record.id, 'date:2026-10-16'))[0].spotName, '공원');
    });
    await t.test('일행 바람 저장도 먼저 잠긴 탈퇴·일정 변경을 기다리고 재확인', async () => {
      for (const kind of ['member', 'revision']) {
        const record = await repo.create({ ownerId: owner, clientId: randomUUID(), data: { name: 'moments', days: [] } });
        await writer.query("insert into trip_members(trip_id,user_id,role,status) values($1,$2,'VIEWER','ACTIVE')", [record.id, editor]);
        const manager = await other.connect();
        let pending;
        try {
          await manager.query('begin');
          if (kind === 'member') await manager.query("update trip_members set status='LEFT' where trip_id=$1 and user_id=$2", [record.id, editor]);
          else await manager.query('update trips set revision=revision+1 where id=$1', [record.id]);
          pending = new PgDailyMomentRepository(db).save({ tripId: record.id, userId: editor, dayKey: 'date:2026-10-15',
            expectedRevision: 1, spotKey: 'cafe', spotName: '카페' }).then(() => ({ error: null }), error => ({ error }));
          let blocked = false;
          for (let i = 0; i < 250; i++) {
            const { rows } = await admin.query("select 1 from pg_stat_activity where datname=$1 and application_name='tc-cas-writer' and wait_event_type='Lock'", [name]);
            if (rows.length) { blocked = true; break; }
            await delay(20);
          }
          await manager.query('commit');
          const result = await pending;
          assert.ok(blocked, `${kind} 변경을 저장과 다른 연결에서 실제로 기다렸다`);
          assert.equal(result.error?.code, kind === 'member' ? 'NOT_FOUND' : 'STALE_VERSION');
          const { rows } = await writer.query('select * from trip_daily_moments where trip_id=$1', [record.id]);
          assert.equal(rows.length, 0);
        } finally {
          await manager.query('rollback');
          if (pending) await pending;
          manager.release();
        }
      }
    });
    await t.test('레거시 sync_trip도 진행 중인 역할 강등을 기다린 뒤 거절', async () => {
      const legacyName = `${name}_legacy`;
      await admin.query(`create database ${legacyName}`);
      const manager = new Client({ ...config, database: legacyName });
      const actor = new Client({ ...config, database: legacyName, application_name: 'tc-legacy-writer' });
      await Promise.all([manager.connect(), actor.connect()]);
      try {
        const root = path.resolve(__dirname, '../..');
        const migrations = ['test/rls/supabase-stub.sql',
          'supabase/migrations/202608190001_sync_integrity.sql',
          'supabase/migrations/202609020001_trip_collaboration.sql',
          'supabase/migrations/20261002081145_sync_trip_authorization.sql'];
        for (const file of migrations) {
          let source = readFileSync(path.join(root, file), 'utf8');
          if (file.endsWith('sync_integrity.sql')) source = source.replace(
            'id bigint generated by default as identity primary key', 'id uuid primary key default gen_random_uuid()');
          await manager.query(source);
        }
        await manager.query('insert into auth.users(id) values($1),($2)', [owner, editor]);
        await actor.query('set role authenticated');
        await actor.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify({ sub: owner })]);
        await actor.query("select * from sync_trip('legacy-lock-test',$1,null,false)", [{ name: 'preserved', days: [] }]);
        await manager.query("insert into trip_members(trip_id,user_id,role,status) select id,$1,'EDITOR','ACTIVE' from trips where client_id='legacy-lock-test'", [editor]);
        await actor.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify({ sub: editor })]);
        await manager.query('begin');
        await manager.query("update trip_members set role='VIEWER' where user_id=$1", [editor]);
        const pending = actor.query("select * from sync_trip('legacy-lock-test',$1,1,false)", [{ name: 'denied', days: [] }])
          .then(result => ({ result }), error => ({ error }));
        let blocked = false;
        for (let i = 0; i < 250; i++) {
          const { rows } = await admin.query("select 1 from pg_stat_activity where datname=$1 and application_name='tc-legacy-writer' and wait_event_type='Lock'", [legacyName]);
          if (rows.length) { blocked = true; break; }
          await delay(20);
        }
        await manager.query('commit');
        const outcome = await pending;
        assert.ok(blocked, '멤버 행 잠금에서 실제로 기다렸다');
        assert.equal(outcome.error?.code, '42501');
        const { rows } = await manager.query("select data,revision from trips where client_id='legacy-lock-test'");
        assert.deepEqual(rows[0].data, { name: 'preserved', days: [] });
        assert.equal(Number(rows[0].revision), 1);
      } finally {
        await manager.query('rollback');
        await Promise.all([manager.end(), actor.end()]);
        await admin.query(`drop database ${legacyName}`);
      }
    });
    await t.test('동시 경로 예약이 사용자·전체 상한을 넘지 않고 같은 수량 차감', async () => {
      const a = new PgLegFillUsageRepository(db), b = new PgLegFillUsageRepository(otherDb);
      const requests = Array.from({ length: 24 }, (_, i) => ({
        user: i % 2 ? 'user:a' : 'user:b', repo: i % 2 ? a : b
      }));
      const grants = await Promise.all(requests.map((request, i) => request.repo.reserve('2026-10-02',
        (i % 3 ? [{ scope: 'all', limit: 9 }, { scope: request.user, limit: request.user === 'user:a' ? 5 : 7 }]
          : [{ scope: request.user, limit: request.user === 'user:a' ? 5 : 7 }, { scope: 'all', limit: 9 }]), 1)));
      const used = await a.used('2026-10-02', ['all', 'user:a', 'user:b']);
      assert.equal(grants.reduce((sum, value) => sum + value, 0), 9);
      assert.equal(used.get('all'), 9);
      for (const [user, limit] of [['user:a', 5], ['user:b', 7]]) {
        assert.ok(used.get(user) <= limit);
        assert.equal(used.get(user), grants.reduce((sum, value, i) => sum + (requests[i].user === user ? value : 0), 0));
      }
      assert.equal(await a.reserve('2026-10-02', [{ scope: 'all', limit: 9 }, { scope: 'user:a', limit: 5 }], 1), 0);
    });
  } finally {
    await Promise.all([writer.end(), other.end()]);
    await admin.query(`drop database ${name}`);
    await admin.end();
  }
});
