// scripts/nas-deploy.sh — NAS 운영 배포 스크립트.
//
// 가짜 docker·curl을 PATH에 깔고 임시 deploy 디렉터리에서 **스크립트를 통째로** 돌린다
// (test/backup.test.js와 같은 방식). 가짜 curl의 /api/health는 실제 구조를 흉내 낸다 —
// compose의 `env_file: .env`가 이미지의 ENV를 덮어쓰므로, .env에 TC_REVISION이 있으면
// 그 값이, 없으면 띄운 TC_IMAGE_TAG가 revision으로 나온다.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { spawnSync } = require('node:child_process');

const SCRIPT = join(__dirname, '../scripts/nas-deploy.sh');
const TARGET = 'd9851955a5afe73e6b308b6ec4b327ec3938f34b';
const STALE = '29adc677e0188a5a893b64ef72b2b89fecbdd8b0';
const SECRET = 'pw-must-survive-and-never-be-printed';

const FAKE_CURL = `#!/bin/sh
# -o가 있으면 파일로, 없으면 표준출력으로. URL로 무엇을 묻는지 가른다.
url=''; out=''
while [ $# -gt 0 ]; do
  case "$1" in
    -o) out="$2"; shift 2 ;;
    http*) url="$1"; shift ;;
    *) shift ;;
  esac
done
echo "$url" >> "$TC_TEST_ROOT/curl.log"
emit() { if [ -n "$out" ]; then cat > "$out"; else cat; fi; }
case "$url" in
  */git/ref/tags/production)
    printf '{"ref":"refs/tags/production","object":{"sha":"%s","type":"commit"}}' "$TC_TEST_TARGET_SHA" | emit ;;
  */deploy/docker-compose.yml)
    printf 'services:\\n  api: {}\\n' | emit ;;
  */deploy/backup.sh)
    printf '#!/bin/sh\\necho backup\\n' | emit ;;
  */scripts/nas-deploy.sh)
    cat "\${TC_TEST_SERVE_SCRIPT:-$TC_TEST_SCRIPT}" | emit ;;
  *:3000/api/health)
    # env_file이 이미지의 ENV를 덮어쓰는 실제 동작을 흉내 낸다
    rev="\${TC_TEST_HEALTH_REVISION:-}"
    if [ -z "$rev" ]; then rev=$(sed -n 's/^TC_REVISION=//p' "$TC_TEST_ENV" | tail -1); fi
    if [ -z "$rev" ]; then rev=$(sed -n 's/^TC_IMAGE_TAG=//p' "$TC_TEST_ENV" | tail -1); fi
    printf '{"status":"ok","database":"ok","revision":"%s"}' "$rev" | emit ;;
  *:3001/health)
    rev=$(sed -n 's/^TC_IMAGE_TAG=//p' "$TC_TEST_ENV" | tail -1)
    printf '{"ok":true,"revision":"%s"}' "$rev" | emit ;;
  *) exit 22 ;;
esac
exit 0
`;

const FAKE_DOCKER = `#!/bin/sh
echo "$@" >> "$TC_TEST_ROOT/docker.log"
if [ "$1" = "compose" ]; then
  shift; while [ "$1" = "-f" ]; do shift 2; done
  case "$1" in
    ps) echo "fake-container-id" ;;
    *) : ;;
  esac
  exit 0
fi
if [ "$1" = "inspect" ]; then
  fmt="$3"
  case "$fmt" in
    *Config.Labels*)
      if [ -n "\${TC_TEST_IMAGE_REVISION:-}" ]; then echo "$TC_TEST_IMAGE_REVISION"
      else sed -n 's/^TC_IMAGE_TAG=//p' "$TC_TEST_ENV" | tail -1; fi ;;
    *) echo "sha256:fake-image-id" ;;
  esac
  exit 0
fi
exit 0
`;

/** 임시 deploy 디렉터리와 가짜 docker·curl을 깔고 nas-deploy.sh를 돌린다 */
function runDeploy(t, { envLines, args = [], state = null, env = {}, serveScript } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'tc-nasdeploy-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const deployDir = join(root, 'deploy');
  mkdirSync(join(root, 'bin'));
  mkdirSync(deployDir);
  writeFileSync(join(root, 'bin/curl'), FAKE_CURL, { mode: 0o755 });
  writeFileSync(join(root, 'bin/docker'), FAKE_DOCKER, { mode: 0o755 });

  // ⚠️ 저장소의 스크립트를 그대로 돌리면 자기 갱신이 저장소 파일을 덮어쓴다.
  //    NAS도 자기 사본을 돌리므로 복사본을 돌리는 편이 실제와도 같다.
  mkdirSync(join(root, 'scripts'));
  const script = join(root, 'scripts', 'nas-deploy.sh');
  writeFileSync(script, readFileSync(SCRIPT, 'utf8'), { mode: 0o755 });

  // 저장소가 내려주는(=그 커밋의) 스크립트. 기본은 지금 것과 같아서 갱신이 일어나지 않는다.
  let serve = script;
  if (serveScript !== undefined) {
    serve = join(root, 'served-nas-deploy.sh');
    writeFileSync(serve, typeof serveScript === 'function'
      ? serveScript(readFileSync(SCRIPT, 'utf8'))
      : serveScript);
  }

  const envFile = join(deployDir, '.env');
  writeFileSync(envFile, (envLines ?? [
    'POSTGRES_USER=tripcanvas',
    `POSTGRES_PASSWORD=${SECRET}`,
    'TC_IMAGE_TAG=',
  ]).join('\n') + '\n');
  if (state) writeFileSync(join(deployDir, '.deploy-state'), state);

  const r = spawnSync('/bin/bash', [script, ...args], {
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${root}/bin:${process.env.PATH}`,
      TC_DEPLOY_DIR: deployDir,
      TC_DOCKER: `${root}/bin/docker`,
      TC_HEALTH_TIMEOUT: '10',
      TC_TEST_ROOT: root,
      TC_TEST_ENV: envFile,
      TC_TEST_SCRIPT: script,
      TC_TEST_SERVE_SCRIPT: serve,
      TC_TEST_TARGET_SHA: TARGET,
      ...env,
    },
  });
  const read = (p) => (existsSync(p) ? readFileSync(p, 'utf8') : '');
  return {
    r,
    script,
    scriptText: readFileSync(script, 'utf8'),
    out: `${r.stdout}${r.stderr}`,
    envText: read(envFile),
    stateText: read(join(deployDir, '.deploy-state')),
    docker: read(join(root, 'docker.log')),
    curl: read(join(root, 'curl.log')),
    deployDir,
  };
}

test('.env에 남은 TC_REVISION을 지우고 배포한다 — 이미지의 revision을 덮어쓰는 값이다', (t) => {
  const { r, out, envText, stateText } = runDeploy(t, {
    envLines: [
      'POSTGRES_USER=tripcanvas',
      `POSTGRES_PASSWORD=${SECRET}`,
      `TC_REVISION=${STALE}`,
      'TC_IMAGE_TAG=',
    ],
  });
  assert.equal(r.status, 0, out);
  assert.doesNotMatch(envText, /^TC_REVISION=/m, '이미지가 주인인 값은 .env에 남지 않는다');
  assert.match(envText, new RegExp(`^TC_IMAGE_TAG=${TARGET}$`, 'm'));
  assert.match(envText, new RegExp(`^POSTGRES_PASSWORD=${SECRET}$`, 'm'), '다른 줄은 건드리지 않는다');
  assert.match(out, /TC_REVISION 줄을 지운다/, '조용히 지우지 않고 로그에 남긴다');
  assert.match(stateText, new RegExp(`CURRENT_SHA=${TARGET}`));
});

test('TC_REVISION이 남아 있으면 /api/health가 옛 커밋을 말한다 — 시뮬레이션이 실제와 같은지', (t) => {
  // 지우기 전의 세상을 흉내 낸다: 배포 뒤에도 .env에 TC_REVISION이 있으면 revision이 그 값이다.
  const { r, out } = runDeploy(t, { env: { TC_TEST_HEALTH_REVISION: STALE } });
  assert.equal(r.status, 1);
  assert.match(out, /api revision 불일치/);
  assert.match(out, /deploy\/\.env에 TC_REVISION/, '이미지가 맞을 때는 .env를 지목한다');
});

test('도는 컨테이너가 다른 커밋의 이미지면 실패한다 — 환경변수를 거치지 않는 두 번째 증인', (t) => {
  const { r, out } = runDeploy(t, { env: { TC_TEST_IMAGE_REVISION: STALE } });
  assert.equal(r.status, 1);
  assert.match(out, /다른 커밋의 이미지다/);
  assert.doesNotMatch(r.stdout + r.stderr, new RegExp(`✔ 배포 성공`));
});

test('바뀐 게 없으면 아무것도 하지 않는다 — 5분마다 도는 경로다', (t) => {
  const { r, docker } = runDeploy(t, { state: `CURRENT_SHA=${TARGET}\nPREVIOUS_SHA=\n` });
  assert.equal(r.status, 0);
  assert.equal(docker, '', 'docker를 한 번도 부르지 않는다');
});

test('--force는 같은 SHA라도 다시 띄운다', (t) => {
  const { r, docker } = runDeploy(t, { args: ['--force'], state: `CURRENT_SHA=${TARGET}\nPREVIOUS_SHA=\n` });
  assert.equal(r.status, 0);
  assert.match(docker, /compose .*pull/);
  assert.match(docker, /compose .*up -d/);
});

test('비밀은 어디에도 찍지 않는다', (t) => {
  const { out } = runDeploy(t, {
    envLines: ['POSTGRES_USER=tripcanvas', `POSTGRES_PASSWORD=${SECRET}`, `TC_REVISION=${STALE}`, 'TC_IMAGE_TAG='],
  });
  assert.doesNotMatch(out, new RegExp(SECRET));
});

test('--status는 도는 revision과 컨테이너 이미지를 함께 말한다', (t) => {
  const { r, out } = runDeploy(t, {
    args: ['--status'],
    envLines: ['TC_IMAGE_TAG=' + TARGET],
  });
  assert.equal(r.status, 0, out);
  assert.match(r.stdout, /도는 revision/);
  assert.match(r.stdout, /컨테이너 이미지/);
  assert.match(r.stdout, new RegExp(TARGET));
});

// ── 자기 갱신(2026-09-20) ──
// 예전에는 바뀐 스크립트를 `deploy/nas-deploy.sh.new`로 받아 두고 사람이 복사하기를 기다렸다.
// 그 한 단계를 잊어 **옛 스크립트가 5분마다 돌며 같은 실패를 되풀이하는** 일이 실제로 났다.
const MARKER = '# TC_TEST_SELF_UPDATE_MARKER';

test('배포 스크립트가 바뀌면 갈아 끼우고 새 스크립트로 이어서 배포한다', (t) => {
  const { r, out, scriptText, stateText } = runDeploy(t, {
    serveScript: (src) => src + `\n${MARKER}\n`
  });
  assert.equal(r.status, 0, out);
  assert.match(scriptText, new RegExp(MARKER), '받은 스크립트로 바뀌어 있다');
  assert.match(out, /갈아 끼웠다/, '조용히 바꾸지 않고 로그에 남긴다');
  assert.equal((out.match(/갈아 끼웠다/g) || []).length, 1, '한 번만 갈아 끼운다 — 다시 시작이 반복되지 않는다');
  assert.match(stateText, new RegExp(`CURRENT_SHA=${TARGET}`), '갈아 끼운 뒤 배포가 끝까지 간다');
});

test('받은 스크립트에 문법 오류가 있으면 갈아 끼우지 않고 지금 것으로 계속한다', (t) => {
  const { r, out, scriptText, stateText } = runDeploy(t, {
    serveScript: '#!/usr/bin/env bash\nif [ ; then\n'
  });
  assert.equal(r.status, 0, out);
  assert.doesNotMatch(scriptText, /if \[ ; then/, '깨진 스크립트로 바뀌지 않았다');
  assert.match(out, /문법 오류/, '왜 안 바꿨는지 말한다');
  assert.match(stateText, new RegExp(`CURRENT_SHA=${TARGET}`), '지금 스크립트로 배포는 끝까지 간다');
});

test('이미 갈아 끼우고 다시 온 차례에는 또 갈아 끼우지 않는다', (t) => {
  const { r, out, scriptText } = runDeploy(t, {
    serveScript: (src) => src + `\n${MARKER}\n`,
    env: { TC_SELF_UPDATED: '1' }
  });
  assert.equal(r.status, 0, out);
  assert.doesNotMatch(scriptText, new RegExp(MARKER), '두 번째 차례에는 건드리지 않는다');
  assert.doesNotMatch(out, /갈아 끼웠다/);
});

test('바뀐 게 없는 주기에는 스크립트를 받지도 않는다 — 5분마다 요청을 늘리지 않는다', (t) => {
  const { r, curl } = runDeploy(t, { state: `CURRENT_SHA=${TARGET}\nPREVIOUS_SHA=\n` });
  assert.equal(r.status, 0);
  assert.doesNotMatch(curl, /scripts\/nas-deploy\.sh/, 'production 태그만 보고 끝낸다');
});
