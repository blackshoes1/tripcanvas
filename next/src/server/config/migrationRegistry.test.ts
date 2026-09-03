// 이관 레지스트리 — 도메인별 source of truth를 환경변수로 정한다(§35·§77). 롤백은 값을 되돌리는 것뿐이다(§78).
import { describe, expect, it } from 'vitest';

import { readRegistry } from './migrationRegistry';

describe('readRegistry', () => {
  it('아무 설정이 없으면 모든 도메인이 LEGACY다', () => {
    const r = readRegistry({});
    expect(r.TRIP).toBe('LEGACY');
    expect(r.AUTH).toBe('LEGACY');
    expect(r.COLLAB).toBe('LEGACY');
  });

  it('DATABASE_URL이 있으면 TC_MIGRATION_TRIP 값을 따른다', () => {
    const r = readRegistry({ DATABASE_URL: 'postgres://x', TC_MIGRATION_TRIP: 'NEW_BACKEND' });
    expect(r.TRIP).toBe('NEW_BACKEND');
    expect(r.AUTH).toBe('LEGACY');
  });

  it('DATABASE_URL이 없으면 값을 줘도 LEGACY다 — 새 DB가 없는 배포에서 새 경로로 빠지지 않게', () => {
    const r = readRegistry({ TC_MIGRATION_TRIP: 'NEW_BACKEND' });
    expect(r.TRIP).toBe('LEGACY');
  });

  it('모르는 값은 LEGACY로 떨어지고 이유를 남긴다', () => {
    const warnings: string[] = [];
    const r = readRegistry({ DATABASE_URL: 'postgres://x', TC_MIGRATION_TRIP: 'dual_read', TC_MIGRATION_COLLAB: 'YES' }, (m) => warnings.push(m));
    expect(r.TRIP).toBe('DUAL_READ');          // 대소문자는 너그럽게
    expect(r.COLLAB).toBe('LEGACY');
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/COLLAB/);
  });
});
