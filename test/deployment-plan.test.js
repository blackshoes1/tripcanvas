const { test } = require('node:test');
const assert = require('node:assert/strict');
const { deploymentTargets } = require('../scripts/deployment-plan');

test('shared engine change deploys both web and NAS', () => {
  assert.deepEqual(deploymentTargets(['adaptive.js']), ['nas-images', 'vercel']);
});
test('schema change cannot be released by rebuilding the API alone', () => {
  assert.deepEqual(deploymentTargets(['next/src/server/infrastructure/database/migrations/0010_example.sql']), ['nas-images', 'nas-schema']);
});
test('realtime code triggers NAS images without a web deployment', () => {
  assert.deepEqual(deploymentTargets(['next/src/server/realtime/hub.ts']), ['nas-images']);
});
test('backup configuration is included even without app changes', () => {
  assert.deepEqual(deploymentTargets(['deploy/backup.sh']), ['nas-config']);
});
test('legacy migrations are separate from NAS schema', () => {
  assert.deepEqual(deploymentTargets(['supabase/migrations/old.sql']), ['legacy-schema']);
});
test('docs alone do not request a deployment', () => {
  assert.deepEqual(deploymentTargets(['docs/architecture.md']), []);
});
