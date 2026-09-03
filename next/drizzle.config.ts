// drizzle-kit — `npx drizzle-kit generate` 가 schema.ts 에서 SQL 마이그레이션을 만든다.
// 적용은 앱이 시작할 때(runMigrations) 또는 `npm run db:migrate` 로 한다. 운영 DB에 손으로 SQL을 치지 않는다(§62).
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/server/infrastructure/database/schema.ts',
  out: './src/server/infrastructure/database/migrations',
  dbCredentials: { url: process.env.DATABASE_URL ?? 'postgres://localhost:5432/tripcanvas' }
});
