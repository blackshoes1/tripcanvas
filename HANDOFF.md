# 작업 인계 — 코드 감사 후속 완료 / 운영 설정·잔여 폴더 확인

갱신: 2026-10-02 20:08 KST. 이 파일은 untracked이며 남은 확인이 끝나면 삭제한다.

## 완료

- 사용자 승인: "남은 작업도 다 해줘". #313~#326 인계 PR 14개 및 후속 #327을 모두 병합했다. 열린 PR 없음. 최종 main: `5b5e2309c61db8427d0b927e560983ec068972ab`.
- #327: https://github.com/blackshoes1/tripcanvas/pull/327. 미뤘던 8건 모두 처리했다. Next 0분/미지정 체류, 예약 연박의 아침 출발점, VIEWER 색상 권한(#325), 협업 진입 전 저장, iOS 소켓 종료 검사, 실제 PG 동시성, iOS 초대 토큰 파리티, 레거시 Supabase CAS 권한. 다른 탭의 기간 변경 일자 칩과 NAS 스크립트 권한도 추가 수정.
- PR 최종 head `f8a16321f7d3e43e5e8a6bbfdc0e9bef53f3b94c`: Linux CI 36996639151 및 macOS CI 36996639092 SUCCESS. web units 608 PASS/3 SKIP(별도 실제 PG 단계에서 RLS 2/2 PASS, SKIP 0), integration 220/220, web E2E 67/67, Next 1212/1212, Next API E2E 5/5, 실제 PG 경합 6/6, 백업 복원 리허설 PASS. iOS XCTest 563/563 및 Release 빌드 PASS.
- 최종 Release 36997864151 및 main iOS 36997863717 SUCCESS. 운영 웹 메뉴 tc-v247 실제 확인. NAS api/realtime/production 태그 전부 `5b5e2309c61db8427d0b927e560983ec068972ab` 일치. 공개 Funnel /api/health 2026-10-02T11:07:40Z HEALTHY(api/db/realtime/backup), readOnly false. 최초 updater 전환의 script 0711을 exact 파일 Docker helper로 0755 복구했고 일반 SSH `nas-deploy.sh --status` PASS, 새 파일의 chmod 0755 코드 존재 확인.
- iOS TestFlight run 36997869673 SUCCESS: 빌드 70 업로드 및 한국어 What to Test 등록 성공. 폰에서 설치 후 동작 확인은 사용자가 수행한다.
- Supabase 프로젝트 gdnhrwtfidjimtabgovh: merged `20261002081145_sync_trip_authorization.sql` 내용 적용 완료. 서버 이력 버전 20261002105246 / sync_trip_authorization. public RPC SECURITY INVOKER 유지, private helper SECURITY DEFINER/빈 search_path, anon execute/usage 차단, authenticated 및 service_role 기존 권한 유지. 여행 8개(활성 5개) 전체 문서 fingerprint 적용 전후 `8ab55068a45091c901675fc4fbff6ec5` 동일. 보안 advisors 기존 7/22/1 경고 및 상세 항목 모두 동일(새 경고 없음).
- 원복 SQL: `C:/Users/owner/AppData/Local/Temp/tripcanvas-supabase-rpc-before-20261002.sql`. 이미지 롤백은 DB 함수를 되돌리지 않으므로 필요 시 이 정의/권한을 별도로 복원한다.
- NAS SSH `blackshoes@100.126.246.42`. nodemailer 10.0.13 확인 메일 1통 실제 도착 사용자 확인, 재발송 금지. NAS OAUTH_NAVER_* 없음 / live auth-config Google만. 기존 공유 여행 중복 사본 0건, 사용자 데이터 삭제 없음. J 0016 leg_fill_usage 운영 테이블 존재 PASS.
- 위조 헤더 rate-limit 공개 Funnel 경로 검증 PASS(지도 30/31, 호텔 10/11). 별도 외부 기기에서 검증한 것으로 표현하지 않는다.
- main ruleset 18573903 ACTIVE, bypass 없음, strict 최신 main, Quality/Next workspace/E2E/Docker image build 필수 등록. iOS 변경 PR도 전체 녹색 확인 후 병합.
- NAS 임시 DB 컨테이너 tripcanvas-audit-pg-20261002(network none/tmpfs/운영 볼륨 없음) 및 임시 테스트 폴더 삭제 완료.
- 인계 worktree 전부 clean·merge된 HEAD 확인 후 git worktree remove로 등록 해제. 별개의 `.claude/worktrees/musing-snyder-2e9a56`와 원래 untracked proto 11개는 보존했다. managed 후속 WT `C:/Users/owner/.codex/worktrees/audit-followups/tripcanvas` archive 완료(archived_worktree artifact 확인, 실제 폴더 없음). 현재 Git worktree는 원본 main과 별개의 Claude 폴더 두 개뿐이다.

## 남은 확인

1. Vercel `geunyoungs-projects-0d71c3ce/tripcanvas`의 Automatically expose System Environment Variables 확인. 연결된 MCP 팀 목록은 빈 목록/프로젝트 403, IAB 브라우저는 로그아웃이다. 사용자 로그인/팀 재연결 질문 대기. 설정 URL: https://vercel.com/geunyoungs-projects-0d71c3ce/tripcanvas/settings/environment-variables . 미확인을 켜져 있다고 추정하지 않는다.
2. Windows 잔여 폴더 7개: `D:/98.스터디/tripcanvas-wt/` 아래 checkout-day-return, ci-hardening, domain-rules, hide-naver-login, ios-collab-parity, server-input-limits, server-trip-authz. Git 등록은 해제됐으나 접근 거부 또는 빌드 폴더 잔여로 실제 디렉터리가 남았다. 모두 삭제 전 clean/merged 확인된 사본이다. PowerShell Remove-Item -Recurse -Force 보완 삭제는 자동 승인 검토에서 상세 이유 없이 "정책상 차단"으로 거절돼 수행하지 않았다. 강제 삭제를 완료한 것으로 보고하지 않는다.
3. 위 확인과 잔여 폴더 정리가 끝나면 이 HANDOFF.md를 삭제한다.

검증 원본 로그는 `C:/Users/owner/AppData/Local/Temp/tripcanvas-pr327-{quality,next,e2e,ios}.log`, `tripcanvas-testflight-70.log`, `tripcanvas-followups-*-20261002.log`에 남아 있다.
