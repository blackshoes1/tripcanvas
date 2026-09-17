-- 복구 리허설용 합성 데이터(scripts/rehearse-restore*.sh). 운영 데이터가 아니다.
-- 알 수 없는 필드(futureField)가 덤프·복원·마이그레이션을 지나도 남는지를 함께 본다.
INSERT INTO users(id,email,created_at) VALUES
 ('00000000-0000-4000-8000-000000000001','owner@example.invalid','2026-07-01T00:00:00Z'),
 ('00000000-0000-4000-8000-000000000002','viewer@example.invalid','2026-07-01T00:00:00Z');
INSERT INTO trips(id,user_id,client_id,data,revision,created_at,updated_at) VALUES
 ('00000000-0000-4000-8000-000000000010','00000000-0000-4000-8000-000000000001','restoretest',
  '{"id":"restoretest","name":"복구 리허설","days":[{"spots":[]}],"futureField":{"keep":true}}',7,'2026-08-01T00:00:00Z','2026-08-02T00:00:00Z');
INSERT INTO trips(id,user_id,client_id,data,revision,deleted_at,created_at,updated_at) VALUES
 ('00000000-0000-4000-8000-000000000011','00000000-0000-4000-8000-000000000001','deletedtest','{"id":"deletedtest","days":[]}',3,'2026-08-03T00:00:00Z','2026-08-01T00:00:00Z','2026-08-03T00:00:00Z');
INSERT INTO trip_members(trip_id,user_id,role,joined_at,created_at,updated_at) VALUES
 ('00000000-0000-4000-8000-000000000010','00000000-0000-4000-8000-000000000001','OWNER','2026-08-01T00:00:00Z','2026-08-01T00:00:00Z','2026-08-01T00:00:00Z'),
 ('00000000-0000-4000-8000-000000000010','00000000-0000-4000-8000-000000000002','VIEWER','2026-08-01T01:00:00Z','2026-08-01T01:00:00Z','2026-08-01T01:00:00Z');
INSERT INTO trip_snapshots(user_id,client_id,name,data,source_revision,created_at) VALUES
 ('00000000-0000-4000-8000-000000000001','restoretest','복구 리허설','{"futureField":{"keep":true}}',7,'2026-08-01T12:00:00Z');
INSERT INTO ops_backup_runs(started_at,finished_at,ok,bytes,destination) VALUES
 ('2026-08-01T03:00:00Z','2026-08-01T03:00:05Z',true,12345,'nas');
