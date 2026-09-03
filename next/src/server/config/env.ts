// 서버 환경(§57). 비밀은 여기서만 읽고 도메인 코드는 모른다. 값이 없으면 오늘의 배포(Supabase 레거시)와 같은 동작이다.
import { readRegistry, type MigrationRegistry } from './migrationRegistry';

export interface ServerEnv {
  /** 독립 PostgreSQL. 없으면 새 backend 경로를 쓰지 않는다 */
  databaseUrl: string | null;
  /** Supabase 프로젝트 URL — JWT issuer(`${url}/auth/v1`)와 JWKS 위치의 근거 */
  supabaseUrl: string;
  /** 구형 HS256 토큰 검증용 JWT secret(있을 때만). 새 프로젝트의 비대칭 키는 JWKS로 받는다 */
  supabaseJwtSecret: string | null;
  registry: MigrationRegistry;
}

const LEGACY_SUPABASE_URL = 'https://gdnhrwtfidjimtabgovh.supabase.co';

export function parseEnv(env: Record<string, string | undefined>, warn?: (m: string) => void): ServerEnv {
  const rawUrl = env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL || LEGACY_SUPABASE_URL;
  return {
    databaseUrl: env.DATABASE_URL || null,
    supabaseUrl: rawUrl.replace(/\/+$/, ''),
    supabaseJwtSecret: env.SUPABASE_JWT_SECRET || null,
    registry: readRegistry(env, warn)
  };
}

let cached: ServerEnv | null = null;
export function getEnv(): ServerEnv {
  if (!cached) cached = parseEnv(process.env, (m) => console.warn(`[tripcanvas-api] ${m}`));
  return cached;
}
