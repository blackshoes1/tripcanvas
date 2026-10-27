-- better-auth 1.7.3부터 계정 열쇠가 (issuer, accountId)에서 다시 (providerId, accountId)로 돌아가 issuer를 쓰지 않는다.
-- NOT NULL로 두면 1.7.14의 스키마 검사가 인증 초기화를 거부하고 새 계정 INSERT도 실패한다 — 그래서 비울 수 있게만 한다.
ALTER TABLE "auth_account" ALTER COLUMN "issuer" DROP NOT NULL;--> statement-breakpoint
-- ⚠️ 이미지 롤백은 스키마를 되돌리지 않는다. 1.7.14가 만든 계정(issuer 없음)을 롤백된 1.7.2는 (issuer, accountId)로
-- 찾으므로 보지 못한다 — 비밀번호 로그인은 '맞지 않아요', 소셜 로그인은 계정 줄이 하나 더 생기고 다시 올리면
-- 1.7.14가 'Multiple accounts match'로 그 사람을 막는다. 그래서 비어 들어오는 issuer를 1.7.2가 쓰던 값으로 채운다.
-- 값은 1.7.2의 규칙 그대로다: credential은 `createLocalAccountIssuer`, google·apple은 provider의 `accountIssuer`,
-- 나머지(kakao)는 `createOAuthAccountIssuer` — `local:oauth:` + encodeURIComponent(id)이고 우리 id는 ASCII 소문자라 그대로다.
-- 칸을 지우는 단계(contract)에서 이 트리거도 함께 지운다.
create or replace function tc_auth_account_issuer() returns trigger
language plpgsql as $$
begin
  if new.issuer is null then
    new.issuer := case new.provider_id
      when 'credential' then 'local:credential'
      when 'google' then 'https://accounts.google.com'
      when 'apple' then 'https://appleid.apple.com'
      else 'local:oauth:' || new.provider_id
    end;
  end if;
  return new;
end $$;
--> statement-breakpoint
drop trigger if exists tc_auth_account_issuer on auth_account;
--> statement-breakpoint
create trigger tc_auth_account_issuer before insert on auth_account
  for each row execute function tc_auth_account_issuer();
--> statement-breakpoint
-- 트리거 없이 이 파일의 앞 버전을 이미 적용한 DB(개발·스테이징)에 생긴 빈 칸도 같은 값으로 채운다. 운영에는 없다.
update auth_account set issuer = case provider_id
    when 'credential' then 'local:credential'
    when 'google' then 'https://accounts.google.com'
    when 'apple' then 'https://appleid.apple.com'
    else 'local:oauth:' || provider_id
  end
  where issuer is null;
