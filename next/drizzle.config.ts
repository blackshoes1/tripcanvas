// drizzle-kit — `npx drizzle-kit generate` 가 schema.ts 에서 SQL 마이그레이션을 만든다.
// 적용은 `npm run db:migrate`(컨테이너의 migrate 단계)로 한다 — API는 시작할 때 마이그레이션을 돌리지 않는다. 운영 DB에 손으로 SQL을 치지 않는다(§62).
// MIGRATE_DATABASE_URL이 있으면 그것으로 붙는다 — 관리형 DB에서 스키마를 만드는 계정(소유자)과 앱이 쓰는 계정을 가를 수 있게(docs/managed-infrastructure.md).
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/server/infrastructure/database/schema.ts',
  out: './src/server/infrastructure/database/migrations',
  dbCredentials: { url: process.env.MIGRATE_DATABASE_URL || process.env.DATABASE_URL || 'postgres://localhost:5432/tripcanvas' }
});
