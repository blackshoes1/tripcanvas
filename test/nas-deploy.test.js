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
  tag=$(sed -n 's/^TC_IMAGE_TAG=//p' "$TC_TEST_ENV" | tail -1)
  case "$1" in
    ps) echo "fake-container-id" ;;
    # 망가진 커밋: 이미지를 못 받거나(교체 전) 띄우다 죽는다(교체 뒤 — 마이그레이션 실패·부팅 실패)
    pull) if [ -n "\${TC_TEST_PULL_FAIL_SHA:-}" ] && [ "$tag" = "$TC_TEST_PULL_FAIL_SHA" ]; then exit 1; fi ;;
    up) if [ -n "\${TC_TEST_BROKEN_SHA:-}" ] && [ "$tag" = "$TC_TEST_BROKEN_SHA" ]; then exit 1; fi ;;
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
function runDeploy(t, { envLines, args = [], state = null, disabled = null, env = {}, serveScript } = {}) {
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
  if (disabled !== null) writeFileSync(join(deployDir, '.deploy-disabled'), disabled);
  const disabledFile = join(deployDir, '.deploy-disabled');

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
    deployLog: read(join(deployDir, 'deploy.log')),
    disabledText: existsSync(disabledFile) ? readFileSync(disabledFile, 'utf8') : null,
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

// ── 실패한 커밋을 기억한다(2026-10-02) ──
// production 태그가 부팅에 실패하는 커밋을 가리키면 '교체 → 헬스체크 실패 → 롤백'이 5분마다 되풀이됐다 —
// 실패 한 번이 5분마다 오는 운영 중단이 된다. 교체까지 간 실패는 적어 두고 자동 경로는 다시 시도하지 않는다.
const OTHER = '5b1f3c2a9e8d7c6b5a4f3e2d1c0b9a8f7e6d5c4b';
const stateOf = (fields) => Object.entries(fields).map(([k, v]) => `${k}=${v}`).join('\n') + '\n';

test('교체 뒤에 실패한 커밋은 적어 두고 직전 SHA로 되돌린다', (t) => {
  const { r, out, stateText } = runDeploy(t, {
    state: stateOf({ CURRENT_SHA: STALE, PREVIOUS_SHA: '' }),
    env: { TC_TEST_BROKEN_SHA: TARGET },
  });
  assert.equal(r.status, 1, out);
  assert.match(out, /롤백 성공/);
  assert.match(stateText, new RegExp(`^FAILED_SHA=${TARGET}$`, 'm'));
  assert.match(stateText, new RegExp(`^CURRENT_SHA=${STALE}$`, 'm'), '도는 것은 여전히 직전 SHA다');
  assert.match(out, /--force/, '다시 시도하는 법을 기록에 남긴다');
});

test('실패로 적힌 production 커밋은 자동 경로가 다시 시도하지 않는다 — 5분마다 운영을 내리지 않는다', (t) => {
  const { r, out, docker, curl, deployLog } = runDeploy(t, {
    state: stateOf({ CURRENT_SHA: STALE, PREVIOUS_SHA: '', FAILED_SHA: TARGET }),
  });
  assert.equal(r.status, 0, '스케줄러의 오류 알림이 5분마다 오지 않는다');
  assert.equal(docker, '', 'docker를 한 번도 부르지 않는다');
  assert.doesNotMatch(curl, /scripts\/nas-deploy\.sh/, '스크립트를 받지도 않는다');
  assert.match(out, /--force/, '왜 건너뛰는지와 다시 하는 법을 한 줄로 말한다');
  assert.equal(deployLog, '', '5분마다 배포 기록에 줄이 쌓이지 않는다');
});

test('--force는 실패로 적힌 커밋도 다시 시도하고, 성공하면 기록을 지운다', (t) => {
  const { r, out, docker, stateText } = runDeploy(t, {
    args: ['--force'],
    state: stateOf({ CURRENT_SHA: STALE, PREVIOUS_SHA: '', FAILED_SHA: TARGET }),
  });
  assert.equal(r.status, 0, out);
  assert.match(docker, /compose .*up -d/);
  assert.match(stateText, new RegExp(`^CURRENT_SHA=${TARGET}$`, 'm'));
  assert.doesNotMatch(stateText, new RegExp(`FAILED_SHA=${TARGET}`));
});

test('--sha로 실패한 production 커밋을 짚으면 시도한다 — production과 같으니 고정하지 않는다', (t) => {
  const { r, out, stateText, disabledText } = runDeploy(t, {
    args: ['--sha', TARGET],
    state: stateOf({ CURRENT_SHA: STALE, PREVIOUS_SHA: '', FAILED_SHA: TARGET }),
  });
  assert.equal(r.status, 0, out);
  assert.match(stateText, new RegExp(`^CURRENT_SHA=${TARGET}$`, 'm'));
  assert.doesNotMatch(stateText, new RegExp(`FAILED_SHA=${TARGET}`));
  assert.equal(disabledText, null);
});

test('새 production 커밋이 오면 지난 실패 기록과 상관없이 배포하고 기록을 지운다', (t) => {
  const { r, out, stateText } = runDeploy(t, {
    state: stateOf({ CURRENT_SHA: STALE, PREVIOUS_SHA: '', FAILED_SHA: OTHER }),
  });
  assert.equal(r.status, 0, out);
  assert.match(stateText, new RegExp(`^CURRENT_SHA=${TARGET}$`, 'm'));
  assert.doesNotMatch(stateText, new RegExp(`FAILED_SHA=${OTHER}`));
});

test('교체 전에 실패하면(이미지 pull) 적지 않는다 — 운영은 그대로였고 다음 차례에 다시 해 볼 일이다', (t) => {
  const { r, out, stateText } = runDeploy(t, {
    state: stateOf({ CURRENT_SHA: STALE, PREVIOUS_SHA: '' }),
    env: { TC_TEST_PULL_FAIL_SHA: TARGET },
  });
  assert.equal(r.status, 1, out);
  assert.match(out, /이미지 pull 실패/);
  assert.doesNotMatch(stateText, new RegExp(`FAILED_SHA=${TARGET}`));
});

// ── 손 롤백은 고정한다 ──
// 예전에는 `--sha <옛 SHA>`로 되돌려도 production 태그는 그대로라 다음 cron이 5분 안에 다시 올렸다.
test('--sha로 production이 아닌 커밋을 띄우면 자동 배포를 멈추고 다시 켜는 법을 남긴다', (t) => {
  const { r, out, stateText, disabledText, deployLog } = runDeploy(t, {
    args: ['--sha', STALE],
    state: stateOf({ CURRENT_SHA: TARGET, PREVIOUS_SHA: '' }),
  });
  assert.equal(r.status, 0, out);
  assert.match(stateText, new RegExp(`^CURRENT_SHA=${STALE}$`, 'm'));
  assert.notEqual(disabledText, null, 'deploy/.deploy-disabled가 생긴다');
  assert.match(disabledText, new RegExp(`^PINNED_SHA=${STALE}$`, 'm'));
  assert.match(deployLog, /rm .*\.deploy-disabled/, '다시 켜는 법을 배포 기록에 남긴다');
});

test('고정된 뒤의 cron은 production으로 되돌리지 않는다', (t) => {
  const { r, out, docker } = runDeploy(t, {
    state: stateOf({ CURRENT_SHA: STALE, PREVIOUS_SHA: TARGET }),
    disabled: `PINNED_SHA=${STALE}\n`,
  });
  assert.equal(r.status, 0);
  assert.equal(docker, '');
  assert.match(out, new RegExp(STALE.slice(0, 7)), '무엇에 고정돼 있는지 말한다');
  assert.match(out, /rm .*\.deploy-disabled/, '다시 켜는 법을 말한다');
});

test('손 롤백은 그 커밋의 옛 스크립트로 갈아 끼우지 않는다 — 옛 스크립트는 고정을 모른다', (t) => {
  const { r, out, scriptText, curl, disabledText } = runDeploy(t, {
    args: ['--sha', STALE],
    state: stateOf({ CURRENT_SHA: TARGET, PREVIOUS_SHA: '' }),
    serveScript: (src) => src + `\n${MARKER}\n`,
  });
  assert.equal(r.status, 0, out);
  assert.doesNotMatch(scriptText, new RegExp(MARKER));
  assert.doesNotMatch(curl, /scripts\/nas-deploy\.sh/);
  assert.notEqual(disabledText, null);
});

test('멈춰 있어도 손으로 준 명령은 진행하고, 멈춤은 사람이 푼다', (t) => {
  const { r, out, docker, disabledText } = runDeploy(t, {
    args: ['--sha', TARGET],
    state: stateOf({ CURRENT_SHA: STALE, PREVIOUS_SHA: '' }),
    disabled: '',
  });
  assert.equal(r.status, 0, out);
  assert.match(docker, /compose .*up -d/);
  assert.equal(disabledText, '', '멈춤 파일을 스스로 지우지 않는다');
  assert.match(out, /rm .*\.deploy-disabled/, '아직 멈춰 있다는 것을 말한다');
});

// 고정한 뒤 손으로 production에 돌아와도(--force·--sha <production>) 멈춤은 사람이 푼다 — 그런데 그때
// "X에 고정했다"만 말하면 돌지 않는 커밋을 가리키고, 고정이 풀렸다고 믿은 사이 다음 머지들이 조용히 멈춘다.
test('고정된 채 손으로 production을 띄우면 멈춤은 남기고, 배포 기록 끝에서 아직 멈춰 있다고 말한다', (t) => {
  const { r, out, stateText, disabledText, deployLog } = runDeploy(t, {
    args: ['--force'],
    state: stateOf({ CURRENT_SHA: STALE, PREVIOUS_SHA: TARGET }),
    disabled: `PINNED_SHA=${STALE}\n`,
  });
  assert.equal(r.status, 0, out);
  assert.match(stateText, new RegExp(`^CURRENT_SHA=${TARGET}$`, 'm'));
  assert.equal(disabledText, `PINNED_SHA=${STALE}\n`, '멈춤 파일을 스스로 지우거나 고치지 않는다');
  const tail = deployLog.slice(deployLog.lastIndexOf('✔ 배포 성공'));
  assert.match(tail, /멈춤은 그대로다/, '성공 뒤에 다시 말한다 — 시작할 때 한 줄로는 묻힌다');
  assert.match(tail, new RegExp(`${STALE.slice(0, 7)}에 고정했지만 지금은 ${TARGET.slice(0, 7)}가 돈다`));
  assert.match(tail, /rm .*\.deploy-disabled/);
});

test('고정 기록과 다른 커밋이 돌면 --status와 cron이 그 사실을 말한다 — 돌지 않는 커밋을 고정이라 하지 않는다', (t) => {
  const pinnedElsewhere = { state: stateOf({ CURRENT_SHA: TARGET, PREVIOUS_SHA: STALE }), disabled: `PINNED_SHA=${STALE}\n` };
  const status = runDeploy(t, { args: ['--status'], envLines: ['TC_IMAGE_TAG=' + TARGET], ...pinnedElsewhere });
  assert.equal(status.r.status, 0, status.out);
  assert.match(status.r.stdout, new RegExp(`자동 배포.*${STALE.slice(0, 7)}에 고정했지만 지금은 ${TARGET.slice(0, 7)}가 돈다`));
  assert.doesNotMatch(status.r.stdout, new RegExp(`${STALE.slice(0, 7)}에 고정했다\\.`));

  const cron = runDeploy(t, pinnedElsewhere);
  assert.equal(cron.r.status, 0, cron.out);
  assert.equal(cron.docker, '', '여전히 멈춰 있다');
  assert.match(cron.out, /지금은 .*가 돈다/);
});

test('손 롤백이 실패해도 production의 실패 기록을 덮어쓰지 않는다', (t) => {
  const { r, out, stateText, disabledText } = runDeploy(t, {
    args: ['--sha', STALE],
    state: stateOf({ CURRENT_SHA: OTHER, PREVIOUS_SHA: '', FAILED_SHA: TARGET }),
    env: { TC_TEST_BROKEN_SHA: STALE },
  });
  assert.equal(r.status, 1, out);
  assert.match(stateText, new RegExp(`^FAILED_SHA=${TARGET}$`, 'm'), 'production을 다시 시도하지 않는다는 기억은 남는다');
  assert.match(stateText, new RegExp(`^CURRENT_SHA=${OTHER}$`, 'm'));
  assert.equal(disabledText, null, '띄우지 못한 커밋에 고정하지 않는다');
});

test('--status는 실패 기록과 멈춤을, 다시 하는 법과 함께 말한다', (t) => {
  const { r, out } = runDeploy(t, {
    args: ['--status'],
    envLines: ['TC_IMAGE_TAG=' + STALE],
    state: stateOf({ CURRENT_SHA: STALE, PREVIOUS_SHA: '', FAILED_SHA: TARGET }),
    disabled: `PINNED_SHA=${STALE}\n`,
  });
  assert.equal(r.status, 0, out);
  assert.match(r.stdout, new RegExp(`실패.*${TARGET.slice(0, 7)}`));
  assert.match(r.stdout, /--force/);
  assert.match(r.stdout, /rm .*\.deploy-disabled/);
});

// 상태 파일은 다른 판의 이 스크립트도 읽는다(자기 갱신이 판을 오간다). 옛 판은 `. 파일`로 읽으므로
// 새 키는 그냥 변수로 남아야 하고, set -u 아래에서도 죽지 않아야 한다.
test('새 상태 파일을 옛 판(2026-09-20)의 read_state가 그대로 읽는다', (t) => {
  const { stateText, deployDir } = runDeploy(t, {
    state: stateOf({ CURRENT_SHA: STALE, PREVIOUS_SHA: '' }),
    env: { TC_TEST_BROKEN_SHA: TARGET },
  });
  assert.match(stateText, /^FAILED_SHA=/m);
  const OLD_READ_STATE = `set -euo pipefail
STATE_FILE="$1"
read_state() {
  CURRENT_SHA=""; PREVIOUS_SHA=""
  [ -f "$STATE_FILE" ] && . "$STATE_FILE" || true
  CURRENT_SHA="\${CURRENT_SHA:-}"; PREVIOUS_SHA="\${PREVIOUS_SHA:-}"
}
read_state
echo "current=$CURRENT_SHA previous=$PREVIOUS_SHA"`;
  const old = spawnSync('/bin/bash', ['-c', OLD_READ_STATE, 'old', join(deployDir, '.deploy-state')], { encoding: 'utf8' });
  assert.equal(old.status, 0, old.stderr);
  assert.equal(old.stdout.trim(), `current=${STALE} previous=`);
});
