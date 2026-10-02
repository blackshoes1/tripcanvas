const { test: nodeTest } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, readFileSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { spawnSync } = require('node:child_process');
const { BASH, skip, shellEnv } = require('./posix-shell');

// 셸을 못 찾는 Windows에서만 이유를 달고 건너뛴다 — 리눅스(CI)에서 skip은 언제나 false다
const test = (name, fn) => nodeTest(name, { skip }, fn);

function run(t, scope, { next = false, fail = false, postgres = false, simulator = null } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'tc-gate-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, 'scripts'));
  mkdirSync(join(root, 'bin'));
  if (next) mkdirSync(join(root, 'next/node_modules'), { recursive: true });
  copyFileSync(join(__dirname, '../scripts/verify-all.sh'), join(root, 'scripts/verify-all.sh'));
  writeFileSync(join(root, 'bin/npm'), `#!/bin/sh\necho "npm $*"\necho '# skipped 0'\nexit ${fail ? 1 : 0}\n`, { mode: 0o755 });
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
  return spawnSync(BASH, [join(root, 'scripts/verify-all.sh'), scope], {
    encoding: 'utf8', env: shellEnv(join(root, 'bin'), { TC_IOS_SIMULATOR_ID: simulator ?? '' })
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
// 운영 API 이미지에 실리는 것은 next의 런타임 의존성이다 — 루트 감사만으로는 next·nodemailer 취약점이 안 보였다
test('next scope audits the runtime dependencies at high severity', (t) => {
  const r = run(t, 'next', { next: true });
  assert.equal(r.status, 0);
  assert.match(r.stdout, /npm --prefix next audit --omit=dev --audit-level=high/);
  assert.match(r.stdout, /PASS  next: 의존성 감사\(high\)/);
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

// CI 워크플로도 같은 함정이다 — shell을 적지 않은 run 스텝은 `bash -e {0}`(pipefail 없음)로 돌아
// `npm audit … | tee`의 종료 코드가 tee의 0이 된다. 취약점이 있어도 감사 단계가 초록이었다(2026-10-02).
const CI = readFileSync(join(__dirname, '../.github/workflows/ci.yml'), 'utf8').replace(/\r\n/g, '\n');

/** ci.yml에서 이름으로 스텝의 `run: |` 본문을 꺼낸다 */
function ciRunBlock(name) {
  const lines = CI.split('\n');
  const at = lines.findIndex((l) => l.trim() === `- name: ${name}`);
  assert.notEqual(at, -1, `ci.yml에 '${name}' 스텝이 있다`);
  const runAt = lines.findIndex((l, i) => i > at && /^\s+run: \|$/.test(l));
  const indent = lines[runAt + 1].match(/^\s*/)[0];
  const body = [];
  for (let i = runAt + 1; i < lines.length && (lines[i].startsWith(indent) || lines[i] === ''); i++) {
    body.push(lines[i].slice(indent.length));
  }
  return body.join('\n');
}

test('CI runs steps under pipefail so tee cannot swallow a failed audit', (t) => {
  assert.match(CI, /^defaults:\n {2}run:\n {4}shell: bash$/m, '워크플로 전체가 shell: bash(-eo pipefail)로 돈다');
  assert.doesNotMatch(CI, /^\s+shell:(?! bash$)/m, '잡·스텝이 pipefail 없는 셸로 되돌리지 않는다');

  const root = mkdtempSync(join(tmpdir(), 'tc-ci-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, 'bin'));
  writeFileSync(join(root, 'bin/npm'), '#!/bin/sh\necho "1 critical severity vulnerability"\nexit 1\n', { mode: 0o755 });
  for (const step of ['Dependency audit (high severity)', 'Dependency audit (runtime, high severity)']) {
    // `shell: bash`가 실제로 부르는 셸 그대로
    const r = spawnSync(BASH, ['--noprofile', '--norc', '-eo', 'pipefail', '-c', ciRunBlock(step)], {
      cwd: root, encoding: 'utf8', env: shellEnv(join(root, 'bin'))
    });
    assert.equal(r.status, 1, `${step}: 취약점이면 실패한다\n${r.stdout}${r.stderr}`);
    assert.match(r.stdout, /재시도하지 않는다/);
  }
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
