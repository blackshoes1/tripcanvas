// 배포하지 않는다. 두 커밋 사이의 변경으로 필요한 배포 대상을 출력한다.
const { execFileSync } = require('node:child_process');

function deploymentTargets(paths) {
  const targets = new Set();
  for (const path of paths) {
    if (/^(app|lib|adaptive|intake|collab|price|routing|sync|api|auth)\.js$/.test(path) ||
        /^(index\.html|style\.css|sw\.js|manifest\.json|icon-[^/]+\.png|vercel\.json)$/.test(path) || path.startsWith('api/')) targets.add('vercel');
    // 루트 엔진·프록시도 Next가 import한다. 컨테이너 셋은 같은 소스에서 함께 빌드한다.
    if (path.startsWith('next/') || path.startsWith('api/') ||
        /^(lib|adaptive|intake|collab|price|routing|sync)\.js$/.test(path) ||
        path === '.dockerignore' || path === 'deploy/docker-compose.yml') targets.add('nas-images');
    if (path.startsWith('next/src/server/infrastructure/database/migrations/') || path === 'next/drizzle.config.ts') targets.add('nas-schema');
    if (path.startsWith('deploy/')) targets.add('nas-config');
    if (path.startsWith('ios/')) targets.add('ios');
    if (path.startsWith('supabase/migrations/')) targets.add('legacy-schema');
  }
  return [...targets].sort();
}

function main() {
  const [base, head = 'HEAD'] = process.argv.slice(2);
  if (!base || process.argv.length > 4) throw new Error('usage: node scripts/deployment-plan.js <deployed-commit> [target-commit]');
  const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();
  const from = git('rev-parse', '--verify', '--end-of-options', `${base}^{commit}`);
  const to = git('rev-parse', '--verify', '--end-of-options', `${head}^{commit}`);
  const paths = git('diff', '--name-only', '--no-renames', '-z', from, to).split('\0').filter(Boolean);
  console.log(`배포 계획: ${from} → ${to}`);
  console.log('커밋된 변경만 비교. 운영 배포 여부와 미커밋 파일은 별도로 확인한다.');
  const descriptions = {
    vercel: 'Vercel 웹/함수 — 웹 자산이면 버전 갱신. NAS API 호환 확인 후 merge.',
    'nas-images': 'NAS — migrate·api·realtime 이미지를 같은 커밋으로 빌드. migrate 성공 후 전체 compose up.',
    'nas-schema': 'NAS 스키마 — 백업·복구 확인, 구버전 호환 검토, 새 migrate 이미지로 적용.',
    'nas-config': 'NAS 구성 — 설정 변경 검토. backup 포함 전체 compose 상태 확인. .env는 별도 유지.',
    ios: 'iOS — 계약·시뮬레이터·실기기 검증 후 별도 배포.',
    'legacy-schema': 'Supabase 레거시 스키마 — NAS 마이그레이션과 별개. 아직 사용하는 경로인지 먼저 확인.'
  };
  for (const target of deploymentTargets(paths)) console.log(`- ${descriptions[target]}`);
  if (!deploymentTargets(paths).length) console.log('코드 경로 기준 배포 대상 없음. 문서·검증 도구 변경은 해당 검증을 수행한다.');
}

if (require.main === module) {
  try { main(); } catch (e) { console.error(e.message); process.exitCode = 1; }
}
module.exports = { deploymentTargets };
