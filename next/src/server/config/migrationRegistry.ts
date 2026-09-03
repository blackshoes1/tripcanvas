// 이관 레지스트리(§35) — 도메인별 source of truth. 환경변수 TC_MIGRATION_<DOMAIN> 하나로 전환하고 되돌린다(§77·§78).
//
//   LEGACY       Supabase가 진실. 새 backend 코드는 있어도 부르지 않는다
//   DUAL_READ    새 PostgreSQL에서 먼저 찾고 없으면 Supabase에서 읽는다(이관 기간 한정, §32). 쓰기는 새 쪽
//   NEW_BACKEND  새 PostgreSQL이 진실
//
// DATABASE_URL이 없으면 무조건 LEGACY다 — 새 DB가 없는 배포(오늘의 Vercel)가 실수로 새 경로에 들어가지 않게.

export type MigrationState = 'LEGACY' | 'DUAL_READ' | 'NEW_BACKEND';
export const MIGRATION_DOMAINS = ['AUTH', 'TRIP', 'BOOKING', 'PRICING', 'ADAPTIVE', 'COLLAB', 'REALTIME', 'STORAGE'] as const;
export type MigrationDomain = (typeof MIGRATION_DOMAINS)[number];
export type MigrationRegistry = Record<MigrationDomain, MigrationState>;

const STATES: readonly MigrationState[] = ['LEGACY', 'DUAL_READ', 'NEW_BACKEND'];

export function readRegistry(
  env: Record<string, string | undefined>,
  warn: (message: string) => void = () => {}
): MigrationRegistry {
  const hasDatabase = !!env.DATABASE_URL;
  const registry = {} as MigrationRegistry;
  for (const domain of MIGRATION_DOMAINS) {
    const raw = env[`TC_MIGRATION_${domain}`];
    let state: MigrationState = 'LEGACY';
    if (raw != null && raw !== '') {
      const upper = raw.trim().toUpperCase();
      if ((STATES as readonly string[]).includes(upper)) state = upper as MigrationState;
      else warn(`TC_MIGRATION_${domain}=${raw} 은 모르는 값 — LEGACY로 둔다 (LEGACY | DUAL_READ | NEW_BACKEND)`);
    }
    if (!hasDatabase && state !== 'LEGACY') {
      warn(`TC_MIGRATION_${domain}=${state} 이지만 DATABASE_URL이 없어 LEGACY로 둔다`);
      state = 'LEGACY';
    }
    registry[domain] = state;
  }
  return registry;
}
