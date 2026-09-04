// R1용 원본 — 운영 덤프를 복원한 **사본**에서 읽는다. 운영 DB를 직접 가리키지 않는다(리허설은 사본에만 쓴다).
//
// "테이블이 없다"(null)와 "비었다"([])를 구분한다: 운영에 적용되지 않은 마이그레이션이 셋 있어서
// 원본에 없는 테이블이 정상적으로 존재한다. 이 둘을 뭉개면 진짜 실패를 놓친다.
import type { MigratedTable, MigrationSource, SourceRow } from './types';

/** pg Client의 최소 계약 — 테스트는 PGlite를 넣는다 */
export interface SourceQueryClient {
  query(text: string): Promise<{ rows: Record<string, unknown>[] }>;
}

export interface PgSourceOptions {
  /** 계정이 있는 곳. 기본은 Supabase의 auth.users, CSV로 따로 받았다면 그 테이블 */
  usersTable?: string;
}

/** 식별자를 그대로 쓰지 않는다 — 스키마.테이블 형태만 허용하고 따옴표로 감싼다 */
function quoteQualified(name: string): string {
  const parts = name.split('.');
  if (parts.length > 2 || parts.some((p) => !/^[A-Za-z_][A-Za-z0-9_]*$/.test(p))) {
    throw new Error(`[migration] 테이블 이름이 올바르지 않다: ${name}`);
  }
  return parts.map((p) => `"${p}"`).join('.');
}

export function createPgSource(client: SourceQueryClient, opts: PgSourceOptions = {}): MigrationSource {
  const usersTable = opts.usersTable ?? 'auth.users';

  async function exists(qualified: string): Promise<boolean> {
    const { rows } = await client.query(`select to_regclass('${qualified.replace(/'/g, "''")}') as oid`);
    return !!rows[0]?.oid;
  }

  return {
    async rows(table: MigratedTable): Promise<SourceRow[] | null> {
      // 계정은 id·email만 가져온다 — 비밀번호 해시·메타데이터는 옮기지 않는다(§19)
      if (table === 'users') {
        const qualified = quoteQualified(usersTable);
        if (!(await exists(qualified))) return null;
        const { rows } = await client.query(`select id, email from ${qualified} order by id`);
        return rows;
      }
      const qualified = quoteQualified(`public.${table}`);
      if (!(await exists(qualified))) return null;
      const { rows } = await client.query(`select * from ${qualified}`);
      return rows;
    }
  };
}

/**
 * 이 연결이 실제로 어디를 보고 있는가 — `계정@호스트/DB` 한 줄.
 *
 * 검증(verify.ts)은 **원본과 대상이 같은가**만 본다. 원본이 운영인지는 아무도 확인하지 않으므로
 * 낡은 사본을 가리켜도 조용히 통과한다(2026-09-04에 실제로 그랬다 — 멤버 한 명이 빠진 채 "통과").
 * 그래서 무엇을 읽고 어디에 쓰는지 사람이 눈으로 확인할 수 있게 시작할 때 찍는다.
 */
export async function describeConnection(client: SourceQueryClient): Promise<string> {
  try {
    const { rows } = await client.query(
      `select current_database() as db, current_user as usr, coalesce(host(inet_server_addr()), 'local') as host`
    );
    const r = rows[0] ?? {};
    return `${String(r.usr ?? '?')}@${String(r.host ?? '?')}/${String(r.db ?? '?')}`;
  } catch {
    return '(확인 불가)';   // 진단용 한 줄 때문에 이관을 막지 않는다
  }
}

/** 운영용 — 레거시 사본에 붙는 pg 연결 */
export async function pgSourceClient(connectionString: string): Promise<SourceQueryClient & { end(): Promise<void> }> {
  const { Client } = await import('pg');
  const client = new Client({ connectionString });
  await client.connect();
  return {
    query: async (text: string) => {
      const result = await client.query(text);
      return { rows: result.rows as Record<string, unknown>[] };
    },
    end: () => client.end()
  };
}
