// Repository가 받는 DB 핸들의 타입. 운영은 node-postgres, 테스트는 PGlite — 둘 다 Drizzle의 PgDatabase라 Repository 코드는 하나다.
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';

import type * as schema from './schema';

export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;
