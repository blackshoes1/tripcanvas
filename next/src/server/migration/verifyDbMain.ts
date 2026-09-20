// PostgreSQL → PostgreSQL 검증 실행 진입점(호스팅 이전 · 복원 리허설). 절차는 docs/managed-db-migration.md.
//
//   SOURCE_DATABASE_URL   원본 — 예: NAS 덤프를 복원한 사본, 또는 NAS 운영(읽기만 한다)
//   TARGET_DATABASE_URL   대상 — 예: 관리형 PostgreSQL(staging 또는 전환 직전의 새 primary)
//
//   npm run tools:build
//   npm run verify:db                         전부 비교
//   npm run verify:db -- --ignore=auth_rate_limit,auth_session   늘 달라지는 표는 내용 비교에서 뺀다(SKIP으로 남는다)
//   npm run verify:db -- --json               기계가 읽는 결과(JSON)로
//
// 종료 코드: 0 PASS · 1 FAIL · 2 INCOMPLETE(SKIP 있음). **SKIP은 통과가 아니다.**
// 어느 쪽에도 쓰지 않는다. 연결 문자열은 출력하지 않는다 — 시작할 때 `계정@호스트/DB`만 찍는다.
import path from 'node:path';

import { describeConnection, pgSourceClient } from './pgSource';
import { readRepoJournal, verifyDatabases } from './verifyDb';

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const json = args.includes('--json');
  const ignoreArg = args.find((a) => a.startsWith('--ignore='));
  const ignoreTables = ignoreArg ? ignoreArg.slice('--ignore='.length).split(',').map((s) => s.trim()).filter(Boolean) : [];
  const sourceUrl = process.env.SOURCE_DATABASE_URL ?? '';
  const targetUrl = process.env.TARGET_DATABASE_URL ?? '';

  if (!sourceUrl || !targetUrl) {
    console.error('[verify-db] SOURCE_DATABASE_URL(원본)과 TARGET_DATABASE_URL(대상)이 필요하다');
    process.exitCode = 1;
    return;
  }
  if (sourceUrl === targetUrl) {
    console.error('[verify-db] 원본과 대상이 같다 — 무엇을 비교하려는지 다시 확인할 것');
    process.exitCode = 1;
    return;
  }

  const source = await pgSourceClient(sourceUrl);
  const target = await pgSourceClient(targetUrl);
  try {
    // 검증은 "같은가"만 답한다. 원본이 정말 운영인지는 이 한 줄을 사람이 읽고 확인한다(2026-09-04의 교훈)
    console.error(`[verify-db] 원본 ${await describeConnection(source)}  →  대상 ${await describeConnection(target)}`);
    const migrationsFolder = path.join(process.cwd(), 'src', 'server', 'infrastructure', 'database', 'migrations');
    const report = await verifyDatabases(source, target, { ignoreTables, repoJournal: readRepoJournal(migrationsFolder) });
    if (json) console.log(JSON.stringify({ status: report.status, summary: report.summary, checks: report.checks }, null, 2));
    else console.log(report.text());
    process.exitCode = report.status === 'PASS' ? 0 : report.status === 'FAIL' ? 1 : 2;
  } catch (err) {
    console.error(`[verify-db] 중단: ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
  } finally {
    await source.end();
    await target.end();
  }
}

void main();
