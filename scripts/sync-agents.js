#!/usr/bin/env node
// AGENTS.md를 CLAUDE.md에서 만든다 — **작업 지침의 원본은 CLAUDE.md 하나다.**
//
// 왜 필요한가: 두 파일이 같은 내용을 따로 들고 있었고, 그대로 갈라졌다. CLAUDE.md는 오늘까지
// 갱신되는데 AGENTS.md는 몇 달 전에 멈춰 있어 **NAS 배포 절차가 자동화 이전 내용**으로 남았다.
// 어느 쪽을 읽었느냐로 따르는 절차가 달라지면, 그건 지침이 아니라 함정이다.
//
// 둘 다 실제로 쓰인다 — Claude Code는 CLAUDE.md를, 다른 도구와 저장소의 작업 프롬프트 문서들은
// AGENTS.md를 먼저 읽는다. 그래서 하나를 지우는 대신 **한쪽을 생성물로** 만들고 게이트가 검사한다.
//
//   node scripts/sync-agents.js           # AGENTS.md를 다시 만든다
//   node scripts/sync-agents.js --check   # 최신인지 검사만 한다 (게이트)

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const SOURCE = path.join(root, 'CLAUDE.md');
const TARGET = path.join(root, 'AGENTS.md');

/** 사람이 이 파일을 고치려다 잃지 않도록, 생성물이라는 사실을 맨 위에 둔다. */
const BANNER = [
  '<!-- 이 파일은 `CLAUDE.md`에서 생성된다 — 직접 고치지 말 것. -->',
  '<!-- 고칠 곳은 CLAUDE.md이고, `npm run sync:agents`로 이 파일을 다시 만든다. -->',
  '<!-- 게이트가 둘이 같은지 검사한다(`scripts/verify-all.sh`). -->',
  ''
].join('\n');

function build() {
  return BANNER + '\n' + fs.readFileSync(SOURCE, 'utf8');
}

const wanted = build();

if (process.argv.includes('--check')) {
  const actual = fs.existsSync(TARGET) ? fs.readFileSync(TARGET, 'utf8') : '';
  if (actual === wanted) {
    console.log('AGENTS.md sync passed (CLAUDE.md 기준).');
    process.exit(0);
  }
  console.error('AGENTS.md가 CLAUDE.md와 다릅니다 — `npm run sync:agents`로 다시 만드세요.');
  console.error('⚠️ AGENTS.md를 직접 고쳤다면 그 변경은 CLAUDE.md로 옮겨야 합니다(원본은 CLAUDE.md입니다).');
  process.exit(1);
}

fs.writeFileSync(TARGET, wanted);
console.log(`AGENTS.md written from CLAUDE.md (${wanted.split('\n').length} lines).`);
