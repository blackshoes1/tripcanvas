-- 요청 제한의 key를 하나뿐이게 한다. better-auth는 key를 읽어서 없으면 만들므로, 처음 들어온 요청들이 동시에 오면
-- 줄을 하나씩 만들고 줄마다 따로 센다 — 로그인 10초 3번이 N×3번이 된다(GHSA-44jh-23m7-hpcf와 같은 우회).
-- unique면 둘째 INSERT가 실패하고 라이브러리가 다시 읽어 같은 줄을 센다.
--
-- 이 마이그레이션이 도는 동안 옛 API가 아직 떠 있다(NAS: migrate → api). 지운 뒤 인덱스를 만들기 전에 중복이 다시
-- 들어오면 인덱스 생성이 실패하므로, 쓰기를 막고(읽기는 둔다) 같은 key의 줄은 마지막 요청 하나만 남긴다.
-- 줄은 시간 창마다 다시 쓰는 셈 값이라 지워도 잃는 것은 지금 창의 횟수뿐이다.
LOCK TABLE "auth_rate_limit" IN SHARE ROW EXCLUSIVE MODE;--> statement-breakpoint
DELETE FROM "auth_rate_limit" a USING "auth_rate_limit" b
  WHERE a."key" = b."key"
    AND (a."last_request" < b."last_request" OR (a."last_request" = b."last_request" AND a."id" < b."id"));--> statement-breakpoint
CREATE UNIQUE INDEX "auth_rate_limit_key_uidx" ON "auth_rate_limit" USING btree ("key");--> statement-breakpoint
DROP INDEX "auth_rate_limit_key_idx";
