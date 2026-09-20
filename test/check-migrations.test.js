'use strict';
// 마이그레이션 하위호환 검사 — main 머지가 운영 DB에 자동 적용되므로(2026-09-19)
// 쓰던 컬럼을 지우거나 이름을 바꾸는 변경은 PR에서 걸러야 한다.
// 여기서 지키는 것: 데이터가 든 것의 삭제·개명·비호환 변경은 걸리고 · 코드 객체(트리거·함수)의
// drop은 안 걸리고 · ADD COLUMN ... NOT NULL DEFAULT는 안 걸리고 · 주석과 문자열을 구분하고 ·
// 허용 표시가 있으면 통과한다.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { findDestructive, stripComments } = require('../scripts/check-migrations.js');

const rules = (sql) => findDestructive(sql).map((h) => h.rule);

test('데이터가 든 것을 지우거나 이름을 바꾸면 걸린다', () => {
  assert.deepEqual(rules('DROP TABLE trips;'), ['테이블 삭제']);
  assert.deepEqual(rules('ALTER TABLE "trips" DROP COLUMN "start";'), ['컬럼 삭제']);
  assert.deepEqual(rules('ALTER TABLE trips RENAME COLUMN a TO b;'), ['컬럼 이름 변경']);
  assert.deepEqual(rules('ALTER TABLE trips RENAME TO journeys;'), ['테이블 이름 변경']);
  assert.deepEqual(rules('TRUNCATE trip_activity;'), ['데이터 비우기']);
  assert.deepEqual(rules('DROP SCHEMA public CASCADE;'), ['스키마 삭제']);
});

test('옛 코드를 깨는 컬럼 변경도 걸린다', () => {
  assert.deepEqual(rules('ALTER TABLE trips ALTER COLUMN title SET NOT NULL;'), ['기존 컬럼에 NOT NULL 추가']);
  assert.deepEqual(rules('ALTER TABLE trips ALTER COLUMN revision TYPE bigint;'), ['기존 컬럼 타입 변경']);
});

test('코드 객체의 drop은 걸리지 않는다 — 같은 파일에서 다시 만든다(0004가 그렇다)', () => {
  assert.deepEqual(rules('drop trigger if exists tc_notify_activity on trip_activity;'), []);
  assert.deepEqual(rules('drop function if exists tc_trip_role(uuid);'), []);
  assert.deepEqual(rules('drop policy if exists p on trips;'), []);
  assert.deepEqual(rules('drop index if exists trips_user_idx;'), []);
});

test('컬럼을 더하는 것은 NOT NULL이어도 하위호환이다 — 0008이 그렇게 했다', () => {
  assert.deepEqual(rules('ALTER TABLE "trips" ADD COLUMN "updated_seq" bigint DEFAULT nextval(\'s\') NOT NULL;'), []);
  assert.deepEqual(rules('ALTER TABLE "trip_candidates" ADD COLUMN "category" text;--> statement-breakpoint'), []);
});

test('주석 안의 구문은 세지 않는다', () => {
  assert.deepEqual(rules('-- DROP TABLE trips; 언젠가\nALTER TABLE trips ADD COLUMN x text;'), []);
  assert.deepEqual(rules('/* DROP COLUMN a */\nSELECT 1;'), []);
});

test("문자열 안의 `--`는 주석이 아니다", () => {
  assert.match(stripComments("SELECT 'a--b'; -- 꼬리"), /'a--b'/);
  assert.doesNotMatch(stripComments("SELECT 1; -- 꼬리"), /꼬리/);
});

test('판단해서 허용 표시를 남기면 통과한다 — 사람이 PR에서 정한다', () => {
  assert.deepEqual(rules('-- tc:allow-destructive 0020에서 옮겨 심었다\nALTER TABLE trips DROP COLUMN old;'), []);
});

test('한 파일에 여럿이면 여럿 다 보고한다 — 줄 번호와 함께', () => {
  const hits = findDestructive('ALTER TABLE t DROP COLUMN a;\nSELECT 1;\nDROP TABLE u;');
  assert.equal(hits.length, 2);
  assert.equal(hits[0].line, 1);
  assert.equal(hits[1].line, 3);
});
