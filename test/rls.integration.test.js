// 함께하기 RLS·RPC — **진짜 PostgreSQL**에서 돈다(§94).
//
// 정규식으로 "정책이 파일에 있다"를 확인하는 migration.test.js와 달리, 여기서는 마이그레이션을 실제로 적용하고
// 사용자 A·B·C로 번갈아 접속해 "B가 A의 여행을 볼 수 없다 / 보기 권한은 저장이 거절된다 / 나간 사람의 저장이
// 조용히 복제되지 않는다"를 DB가 판정하게 한다.
//
// 로컬 PostgreSQL이 있어야 한다(없으면 skip):
//   scripts/pg-local.sh start && eval "$(scripts/pg-local.sh env)" && npm run test:rls
// Supabase가 아니라 대역(test/rls/supabase-stub.sql)이지만, RLS·security definer·errcode는 PostgreSQL 그 자체다.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const path = require('node:path');

const PSQL = process.env.TC_PSQL, HOST = process.env.TC_PGHOST, PORT = process.env.TC_PGPORT || '5432';
const skip = (PSQL && HOST) ? false : '로컬 PostgreSQL 없음 — scripts/pg-local.sh start 후 TC_PSQL·TC_PGHOST·TC_PGPORT 설정';
const root = path.join(__dirname, '..');
const sql = (f) => path.join(root, f);

function psql(db, args) {
  return execFileSync(PSQL, ['-h', HOST, '-p', PORT, '-U', 'postgres', '-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-d', db, ...args],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

// 시나리오(test/rls/collaboration.sql)가 남기는 결과. 키 이름은 그 파일의 t_out 행이다.
const EXPECTED = {
  'a.trips': '1', 'a.owner_member': '1', 'a.roles': 'OWNER:1',
  // 초대 전 B는 A의 아무것도 못 본다 — 여행·멤버·초대 전부
  'b.before.trips': '0', 'b.before.members': '0', 'b.before.invites': '0', 'b.before.list_members': '0',
  'b.own.trips': '1',
  'b.invite.forbidden': '42501',
  // 토큰은 32자 URL-safe, 원문은 저장되지 않고 sha256만 있다
  'a.invite.token_len': '32', 'a.invite.role': 'EDITOR',
  'db.token_not_stored': 'true', 'db.token_hash_is_sha256': 'true',
  // 로그인 전: 미리보기(이름·시작일·일수·역할)만. 수락·여행 읽기는 권한 오류
  'anon.preview': 'true:OK:스페인:2026-10-25:2:EDITOR', 'anon.accept': '42501', 'anon.trips': '42501',
  'anon.preview.garbage': 'false:INVALID',
  // 토큰을 알아도 참여 전에는 본문을 못 본다(§67)
  'c.preview.valid': 'true', 'c.trips': '0',
  // 수락은 멱등(§74) — 두 번째는 already_member, 사용 횟수는 그대로
  'b.accept': 'true:OK:trip1:스페인:EDITOR:false', 'b.accept.again': 'true:OK:true',
  'b.after.trips': '2', 'b.after.roles': 'b-own=OWNER:1:true,trip1=EDITOR:2:false',
  'b.after.members': '영희/EDITOR/true,-/OWNER/false', 'db.invite.use_count': '1',
  // 편집자의 저장은 CAS를 그대로 지나고 주최자에게 보인다
  'b.edit': 'true:false:2', 'b.edit.stale': 'false:true:2', 'a.sees_edit': '스페인 (영희 편집)', 'a.roles.after': 'OWNER:2',
  // 편집자가 못 하는 것: 소유권 가로채기(트리거) · 삭제 · 다른 멤버 관리. 본인 이름은 된다
  'b.hijack': '42501', 'b.tombstone': '42501', 'b.remove_owner': '42501', 'b.rename': 'ok', 'b.rename.check': '영희(수정)',
  // 보기 권한: 읽기만. RPC도 직접 update도 막힌다
  'a.demote': 'ok', 'b.viewer.reads': '1', 'b.viewer.write': '42501', 'b.viewer.direct_update': '0',
  'a.after_viewer_write': '스페인 (영희 편집)',
  // 소유자 행은 못 바꾸고(§72 전까지) 주최자는 못 나간다(§71)
  'a.self_demote': '42501', 'a.leave': '42501',
  // client_id는 사용자별 — C의 같은 id 저장은 제 여행이 될 뿐 A의 행은 그대로
  'c.sync_same_id': 'true:1', 'c.trips.after_sync': 'C의 trip1', 'a.after_c': '스페인 (영희 편집):2',
  // 나가기: 멱등, 나간 뒤엔 안 보이고, 나간 사람의 저장은 조용한 복제가 아니라 거절
  'b.leave': 'true', 'b.leave.again': 'true', 'b.left.trips': 'b-own', 'b.left.write': '42501',
  // 취소된 링크 · 내보내진 사람은 이전 링크로 못 돌아오고 새 링크는 된다(§70) · 만료
  'a.revoke': 'true', 'a.invites.active': '0/1', 'c.revoked.preview': 'false:REVOKED', 'c.revoked.accept': 'false:REVOKED',
  'b.rejoin': 'true:OK:VIEWER:false', 'a.remove_b': 'ok', 'b.removed.trips': '0',
  'b.removed.old_link': 'false:REMOVED', 'b.removed.new_link': 'true:OK:EDITOR',
  'c.expired.preview': 'false:EXPIRED', 'c.expired.accept': 'false:EXPIRED',
  'b.expired.but_member': 'false:EXPIRED:true', 'b.expired.accept_member': 'true:true',
  // ── 2단계: 후보 장소와 반응 ──
  // 낸 사람은 이미 가고 싶다는 뜻이라 MUST가 자동으로 붙는다 · 이름은 여행 안 이름뿐(이메일 없음 §69)
  'cand.a.add': 'true', 'cand.a.auto_must': '1:MUST', 'cand.b.count': '2',
  'cand.labels': '주최자,영희', 'cand.no_email': 'true',
  // 멤버가 아니면 후보도 반응도 보이지 않고 남기지도 못한다. C의 같은 client_id 저장은 제 여행에만 들어간다
  'cand.c.select': '0', 'cand.c.reactions': '0', 'cand.c.list': '0', 'cand.c.react': '42501',
  'cand.c.add': 'ok', 'cand.c.add_lands_in_own': '몰래 추가', 'cand.a.untouched': '사그라다 파밀리아,카사 바트요',
  // 한 사람 한 표 — 두 번 눌러도, 마음이 바뀌어도 행은 하나. 서로의 의견은 보인다(§10)
  'cand.react.idempotent': '1', 'cand.react.changed': '2:0:0', 'cand.react.rows': '2',
  'cand.react.who': '주최자/MUST,영희/MUST', 'cand.react.cleared': '-:1', 'cand.react.invalid': '22023',
  // 보기 권한은 **의견만** 낸다 — 후보를 만들거나 일정에 넣지는 못하고, 테이블에 직접 쓸 권한도 없다
  'cand.viewer.reads': '2', 'cand.viewer.react': 'true', 'cand.viewer.react.applied': 'PASS',
  'cand.viewer.add': '42501', 'cand.viewer.schedule': '42501',
  'cand.viewer.direct_react': '42501', 'cand.viewer.direct_add': '42501',
  // 후보를 지우는 기준은 역할이 아니라 '누가 냈는가'다 — 편집자도 남의 것은 못 지우고 주최자는 지운다
  'cand.b.remove_others': '42501', 'cand.editor.remove_others': '42501',
  'cand.b.remove_own': 'true', 'cand.after_remove': '1', 'cand.reactions_cascade': '0',
  'cand.owner_removes_any': 'true',
  // 일정에 넣는 것은 사람이 누른다(§12·§79) — 되돌릴 수도 있다
  'cand.schedule': 'true', 'cand.scheduled': 'SCHEDULED:2', 'cand.unschedule': 'PROPOSED:-',
  // 나간 사람은 반응도 못 남기고 후보도 안 보인다
  'cand.left.react': '42501', 'cand.left.list': '0',
  // ── 3단계: 코멘트 · 활동 기록 ──
  // 코멘트는 의견이다 — 보기 권한도 남긴다. 멤버가 아니면 남기지도 보지도 못한다. 빈 말은 거절
  'cm.b.rejoin': 'true:EDITOR', 'cm.b.add': 'true', 'cm.empty': '22023',
  'cm.c.add': '42501', 'cm.c.select': '0', 'cm.c.list': '0',
  'cm.viewer.add': 'true', 'cm.list': '영희/야경 보고 저녁 먹자/true,영희/보기 권한의 한마디/true', 'cm.count': '2',
  // 지우기는 쓴 사람이나 주최자만. 두 번 지워도 같다. 테이블 직접 쓰기는 권한 자체가 없다
  'cm.b.delete_others': '42501', 'cm.b.delete_own': 'true', 'cm.b.delete_again': 'false',
  'cm.owner.delete_any': 'true', 'cm.after': '주최자/주최자 코멘트', 'cm.direct': '42501', 'act.direct': '42501',
  // 문서 저장: 예약이 늘면 BOOKING_ADDED, 아니면 SCHEDULE_CHANGED. 혼자 쓰는 여행(C)의 저장은 기록하지 않는다
  'act.b.booking': 'true:3', 'act.b.schedule': 'true:4', 'act.c.solo_save': 'true',
  'act.c.kinds': 'CANDIDATE_PROPOSED', 'act.c.select': '1',
  // A가 보는 기록 — 의미 있는 것만 순서대로. 소유자의 참여 행 없음 · 제안자의 자동 MUST 없음 · 반응 거두기 없음
  'act.a.kinds': 'MEMBER_JOINED,SCHEDULE_CHANGED,MEMBER_LEFT,MEMBER_JOINED,MEMBER_REMOVED,MEMBER_JOINED,CANDIDATE_PROPOSED,CANDIDATE_PROPOSED,REACTION,REACTION,REACTION,REACTION,CANDIDATE_SCHEDULED,CANDIDATE_PROPOSED,REACTION,MEMBER_LEFT,MEMBER_JOINED,COMMENT_ADDED,COMMENT_ADDED,COMMENT_ADDED,BOOKING_ADDED,SCHEDULE_CHANGED',
  'act.a.no_owner_join': '0',
  // 이름표는 읽는 시점에 만들고(나간 뒤에도 남는다), 내보내기의 actor는 소유자·대상은 member_label
  'act.a.labels': 'MEMBER_JOINED=영희/영희/false,MEMBER_JOINED=영희/영희/false,MEMBER_REMOVED=주최자/영희/true,MEMBER_JOINED=영희/영희/false,CANDIDATE_PROPOSED=주최자/-/true,CANDIDATE_PROPOSED=영희/-/false,CANDIDATE_PROPOSED=주최자/-/true,MEMBER_JOINED=영희/영희/false,COMMENT_ADDED=영희/-/false,COMMENT_ADDED=영희/-/false,COMMENT_ADDED=주최자/-/true,BOOKING_ADDED=영희/-/false',
  'act.a.subjects': '{"ref": "2", "title": "사그라다 파밀리아", "candidate_id": 1}|{"title": "사그라다 파밀리아", "excerpt": "야경 보고 저녁 먹자", "candidate_id": 1}|{"title": "사그라다 파밀리아", "excerpt": "보기 권한의 한마디", "candidate_id": 1}|{"title": "사그라다 파밀리아", "excerpt": "주최자 코멘트", "candidate_id": 1}|{"count": 1}',
  'act.a.limit': '3',
  // 실시간 퍼블리케이션에는 활동 테이블만 — 여행 문서(jsonb 전체)를 내보내지 않는다
  'act.publication': 'trip_activity',
  // ── 4단계: 여행별 멤버 취향 ──
  // 화면이 무엇을 보내든 DB에는 아는 값만 남는다 — 모르는 키·값은 버리고, 배열은 정리·중복 제거·12개 제한
  'pref.b.set': '{"note": "신혼여행이라 여유롭게", "pace": "RELAXED", "night": true, "morning": false, "walking": "LOW", "dislikes": ["쇼핑"], "interests": ["미술관", "야경"]}',
  'pref.b.bad_values': '{"walking": "LOW"}', 'pref.b.not_object': '{}', 'pref.b.limit': '12',
  'pref.b.empty_arrays': '{"pace": "NORMAL"}',
  // 같은 여행 멤버끼리 서로 본다(§10) · 이름표만(이메일 없음) · 본인 것만 바꾼다 · 직접 쓰기는 권한 자체가 없다
  'pref.a.list': '주최자/OWNER/true/{} | 영희/EDITOR/false/{"pace": "RELAXED", "night": true, "walking": "LOW", "dislikes": ["쇼핑"], "interests": ["미술관", "야경"]}',
  'pref.a.set': 'PACKED', 'pref.b.direct': '42501', 'pref.a.unchanged': 'PACKED',
  // 보기 권한도 취향은 남긴다(의견이다) · 비멤버의 같은 client_id 저장은 제 여행에만
  'pref.viewer.set': 'HIGH', 'pref.c.set': 'NORMAL', 'pref.c.list': '주최자/OWNER', 'pref.a.count': '2',
  // 취향 변경은 활동 기록에 남지 않는다(§38)
  'pref.no_activity': 'true',
  // ── 5단계: 갈린 후보의 결정 ──
  // "이번 일정에서는 제외"는 지우기가 아니라 상태다 — 의견·코멘트는 남고 언제든 되돌린다. 결정은 활동 기록에 한 번만, 되돌리기는 안 남긴다
  'dec.b.reject': 'true', 'dec.status': 'REJECTED:-', 'dec.activity': '1', 'dec.activity.subject': '사그라다 파밀리아',
  'dec.b.reopen': 'true', 'dec.reopened': 'PROPOSED:1:1', 'dec.activity.after_reopen': '1',
  // 결정은 편집 권한만 — 보기 권한·비멤버는 42501, 모르는 액션은 22023, 주최자는 된다
  'dec.viewer.reject': '42501', 'dec.viewer.reopen': '42501', 'dec.invalid': '22023', 'dec.c.reject': '42501', 'dec.a.reject': 'true',
  // 기존 단일 사용자 흐름은 그대로(§95)
  'a.snapshots': '1', 'b.snapshots': '0', 'a.tombstone_by_owner': 'true'
};

const { mkdtempSync, readFileSync, writeFileSync } = require('node:fs');
const os = require('node:os');

/**
 * 운영 DB의 trips.id는 **uuid**다(저장소 기본 마이그레이션의 bigint identity는 새 설치에만 해당 —
 * 운영은 그보다 먼저 만들어져 create table if not exists가 건드리지 않았다). 협업 마이그레이션은 어느 쪽에도
 * 적용돼야 하므로 두 모양 모두에서 같은 시나리오를 돌린다. 운영 모양은 기본 마이그레이션의 trips.id만 uuid로 바꾼 것.
 */
function baseSchema(shape) {
  const src = readFileSync(sql('supabase/migrations/202608190001_sync_integrity.sql'), 'utf8');
  if (shape === 'bigint') return sql('supabase/migrations/202608190001_sync_integrity.sql');
  const first = src.indexOf('id bigint generated by default as identity primary key');
  const patched = src.slice(0, first) + 'id uuid primary key default gen_random_uuid()' + src.slice(first + 'id bigint generated by default as identity primary key'.length);
  const dir = mkdtempSync(path.join(os.tmpdir(), 'tc-rls-'));
  const file = path.join(dir, 'base-uuid.sql');
  writeFileSync(file, patched);
  return file;
}

for (const shape of ['bigint', 'uuid']) test(`RLS(trips.id=${shape}): 마이그레이션을 실제 PostgreSQL에 적용하고 사용자 A·B·C 격리 시나리오를 DB가 판정한다`, { skip }, () => {
  const db = 'tc_rls_' + shape + '_' + Date.now().toString(36);
  psql('postgres', ['-c', `create database ${db}`]);
  try {
    psql(db, ['-f', sql('test/rls/supabase-stub.sql')]);
    psql(db, ['-f', baseSchema(shape)]);
    const idType = psql(db, ['-c', "select format_type(atttypid, atttypmod) from pg_attribute where attrelid='public.trips'::regclass and attname='id'"]).trim();
    assert.equal(idType, shape, '기본 스키마 모양');
    psql(db, ['-f', sql('supabase/migrations/202609020001_trip_collaboration.sql')]);
    psql(db, ['-f', sql('supabase/migrations/202609020002_trip_candidates.sql')]);
    psql(db, ['-f', sql('supabase/migrations/202609020003_trip_comments_activity.sql')]);
    psql(db, ['-f', sql('supabase/migrations/202609020004_member_preferences.sql')]);
    psql(db, ['-f', sql('supabase/migrations/202609020005_candidate_decisions.sql')]);
    // 두 번 적용해도 같다 — 운영에서 재실행돼도 안전해야 한다
    psql(db, ['-f', sql('supabase/migrations/202609020001_trip_collaboration.sql')]);
    psql(db, ['-f', sql('supabase/migrations/202609020002_trip_candidates.sql')]);
    psql(db, ['-f', sql('supabase/migrations/202609020003_trip_comments_activity.sql')]);
    psql(db, ['-f', sql('supabase/migrations/202609020004_member_preferences.sql')]);
    psql(db, ['-f', sql('supabase/migrations/202609020005_candidate_decisions.sql')]);
    const out = psql(db, ['-f', sql('test/rls/collaboration.sql')]);
    const got = {};
    for (const line of out.split('\n')) {
      if (!line.startsWith('OUT:')) continue;
      const i = line.indexOf('=');
      got[line.slice(4, i)] = line.slice(i + 1);
    }
    const missing = Object.keys(EXPECTED).filter((k) => !(k in got));
    assert.deepEqual(missing, [], '시나리오가 남기지 않은 키');
    for (const [k, v] of Object.entries(EXPECTED)) assert.equal(got[k], v, k);
  } finally {
    try { psql('postgres', ['-c', `drop database if exists ${db}`]); } catch (_) { /* 정리 실패는 결과에 영향 없음 */ }
  }
});
