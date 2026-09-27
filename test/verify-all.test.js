const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { spawnSync } = require('node:child_process');

function run(t, scope, { next = false, fail = false, postgres = false, simulator = null } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'tc-gate-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, 'scripts'));
  mkdirSync(join(root, 'bin'));
  if (next) mkdirSync(join(root, 'next/node_modules'), { recursive: true });
  copyFileSync(join(__dirname, '../scripts/verify-all.sh'), join(root, 'scripts/verify-all.sh'));
  writeFileSync(join(root, 'bin/npm'), `#!/bin/sh\necho '# skipped 0'\nexit ${fail ? 1 : 0}\n`, { mode: 0o755 });
  writeFileSync(join(root, 'scripts/pg-local.sh'), `#!/bin/sh\nexit ${postgres ? 0 : 2}\n`, { mode: 0o755 });
  if (simulator !== null) {
    mkdirSync(join(root, 'ios'));
    const commands = {
      uname: '#!/bin/sh\necho Darwin\n',
      xcrun: '#!/bin/sh\necho "    iPhone default (11111111-1111-1111-1111-111111111111) (Shutdown)"\necho "    TripCanvas isolated (22222222-2222-2222-2222-222222222222) (Shutdown)"\n',
      xcodebuild: '#!/bin/sh\necho "xcodebuild $*"\n',
      xcodegen: '#!/bin/sh\nexit 0\n'
    };
    for (const [name, script] of Object.entries(commands)) {
      writeFileSync(join(root, 'bin', name), script, { mode: 0o755 });
    }
  }
  return spawnSync('/bin/bash', [join(root, 'scripts/verify-all.sh'), scope], {
    encoding: 'utf8', env: { ...process.env, PATH: `${root}/bin:${process.env.PATH}`, TC_IOS_SIMULATOR_ID: simulator ?? '' }
  });
}

test('unknown scope cannot succeed without running checks', (t) => {
  const r = run(t, 'typo');
  assert.equal(r.status, 2);
  assert.match(r.stderr, /usage:/);
});
test('missing dependencies are incomplete, not passed', (t) => {
  const r = run(t, 'next');
  assert.equal(r.status, 2);
  assert.match(r.stdout, /SKIP/);
  assert.doesNotMatch(r.stdout, /게이트 통과/);
});
test('all selected checks passing succeeds', (t) => {
  const r = run(t, 'next', { next: true });
  assert.equal(r.status, 0);
  assert.match(r.stdout, /게이트 통과/);
});
test('check failures take priority over skipped checks', (t) => {
  const r = run(t, 'web', { fail: true });
  assert.equal(r.status, 1);
  assert.match(r.stdout, /SKIP/);
  assert.match(r.stdout, /게이트 실패/);
});
test('RLS test failure survives tee even when skipped count is zero', (t) => {
  const r = run(t, 'web', { fail: true, postgres: true });
  assert.equal(r.status, 1);
  assert.match(r.stdout, /FAIL  RLS/);
});


test('explicit isolated simulator is used for XCTest', (t) => {
  const r = run(t, 'ios', { simulator: '22222222-2222-2222-2222-222222222222' });
  assert.equal(r.status, 0);
  assert.match(r.stdout, /-destination id=22222222-2222-2222-2222-222222222222/);
  assert.doesNotMatch(r.stdout, /-destination id=11111111/);
});
test('missing explicit simulator does not fall back to a personal device', (t) => {
  const r = run(t, 'ios', { simulator: '33333333-3333-3333-3333-333333333333' });
  assert.equal(r.status, 2);
  assert.match(r.stdout, /SKIP  iOS/);
  assert.doesNotMatch(r.stdout, /xcodebuild test/);
});
