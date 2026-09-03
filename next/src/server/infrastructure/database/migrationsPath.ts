import path from 'node:path';

/** drizzle-kit이 만든 SQL 마이그레이션 폴더 — drizzle-kit migrate(운영)와 테스트(PGlite)가 같은 파일을 적용한다 */
export const MIGRATIONS_FOLDER = path.join(process.cwd(), 'src', 'server', 'infrastructure', 'database', 'migrations');
