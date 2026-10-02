// 셸 스크립트를 **통째로** 돌리는 테스트(backup·nas-deploy·verify-all)가 쓰는 셸 찾기.
//
// 그 테스트들은 `/bin/bash`·`/bin/sh`를 직접 불렀다. 리눅스(CI·NAS)에서는 맞지만 Windows의 Node는
// `/bin/bash`를 `D:\bin\bash`로 읽어 ENOENT를 내고, 결과는 `status: null` — 스크립트가 아니라
// **테스트가 셸을 못 찾아** 수십 건이 빨개졌다. 그래서 집·회사 Windows에서 게이트를 돌릴 때마다
// 진짜 실패가 그 소음 속에 묻혔다.
//
// 그래서:
//   - 리눅스·macOS는 예전 그대로 `/bin/bash`·`/bin/sh`다. **찾지 못해도 건너뛰지 않는다** — CI에서
//     이 테스트들이 조용히 skip되면 배포 스크립트가 검사되지 않은 채 초록이 된다.
//   - Windows는 Git for Windows의 bash(MSYS)로 돌린다. `bin/bash.exe`(래퍼)가 아니라 `usr/bin/bash.exe`를
//     쓴다 — 래퍼는 PATH 맨 앞에 진짜 curl이 있는 디렉터리를 끼워 넣어 테스트의 가짜 curl·docker를 가린다.
//   - Windows에서 Git Bash를 못 찾을 때만 **이유를 달고** 건너뛴다.
const { spawnSync } = require('node:child_process');
const { existsSync } = require('node:fs');
const path = require('node:path');

const WIN = process.platform === 'win32';

/** Git for Windows의 설치 루트(`…/Git`). 못 찾으면 null. */
function gitRoot() {
  const roots = [];
  // `git --exec-path` → <Git>/mingw64/libexec/git-core — 설치 위치가 바뀌어도 git이 안다
  const r = spawnSync('git', ['--exec-path'], { encoding: 'utf8' });
  if (r.status === 0 && r.stdout.trim()) roots.push(path.resolve(r.stdout.trim(), '..', '..', '..'));
  for (const base of [process.env.ProgramFiles, process.env['ProgramFiles(x86)'], process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Programs')]) {
    if (base) roots.push(path.join(base, 'Git'));
  }
  return roots.find((root) => existsSync(path.join(root, 'usr', 'bin', 'bash.exe'))) || null;
}

const GIT_ROOT = WIN ? gitRoot() : null;
const USR_BIN = GIT_ROOT ? path.join(GIT_ROOT, 'usr', 'bin') : null;

/** bash 경로. Windows에서 못 찾으면 null. */
const BASH = WIN ? (USR_BIN && path.join(USR_BIN, 'bash.exe')) : '/bin/bash';
/** sh 경로. Windows에서 못 찾으면 null. */
const SH = WIN ? (USR_BIN && path.join(USR_BIN, 'sh.exe')) : '/bin/sh';

/** `test(name, { skip }, fn)`에 그대로 넣는다 — 리눅스·macOS에서는 언제나 false다. */
const skip = WIN && !BASH
  ? 'Windows에서 Git Bash(Git for Windows의 usr/bin/bash.exe)를 찾지 못했다 — 셸 스크립트 테스트는 CI(ubuntu)가 돌린다'
  : false;

/**
 * 가짜 명령 디렉터리를 PATH 맨 앞에 둔 환경. Windows는 구분자가 `;`이고, MSYS 도구(sed·awk·mktemp…)가
 * 있는 `usr/bin`을 PATH에 넣어 둔다(PowerShell에서 띄운 Node의 PATH에는 보통 없다).
 * ⚠️ Windows의 환경변수 이름은 대소문자를 가리지 않아 `Path`로 들어 있을 수 있다 — 그대로 펼치고
 *    `PATH`를 더하면 둘이 함께 넘어가 어느 쪽이 이길지 모른다. 그래서 변형을 지우고 하나만 둔다.
 * @param {string} fakeBin
 * @param {Record<string, string>} [extra]
 */
function shellEnv(fakeBin, extra = {}) {
  const env = {};
  let rest = '';
  for (const [key, value] of Object.entries(process.env)) {
    if (key.toUpperCase() === 'PATH') { rest = rest || value || ''; continue; }
    env[key] = value;
  }
  env.PATH = WIN
    ? [fakeBin, USR_BIN, rest].filter(Boolean).join(path.delimiter)
    : `${fakeBin}:${rest}`;
  return { ...env, ...extra };
}

module.exports = { BASH, SH, skip, shellEnv };
