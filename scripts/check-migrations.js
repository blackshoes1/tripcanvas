#!/usr/bin/env node
/**
 * 마이그레이션이 **하위호환인지** 본다 — `main` 머지가 운영 DB에 자동으로 적용되기 때문이다(2026-09-19).
 *
 * 자동 배포에서는 새 스키마가 적용된 **뒤에** 새 코드가 뜬다. 그 사이(그리고 롤백했을 때)
 * 옛 코드가 새 스키마 위에서 돌아야 한다. 그래서 쓰던 컬럼을 지우거나 이름을 바꾸는 변경은
 * 한 배포에 담지 않는다 — expand → deploy → backfill → contract로 나눈다(docs/migration-policy.md).
 *
 * ⚠️ 이미지 롤백은 **스키마를 되돌리지 않는다.** 파괴적 변경이 한 번 적용되면 옛 코드로 돌아갈 길이 없다.
 *
 * 트리거·함수·정책·인덱스의 `drop`은 막지 않는다 — 같은 파일에서 다시 만드는 코드 객체다(0004가 그렇다).
 * 막는 것은 **데이터가 들어 있는 것**뿐이다.
 *
 * 정말 필요하면 그 파일에 한 줄로 밝힌다(사람이 PR에서 판단한 것이라는 표시):
 *   -- tc:allow-destructive 0014에서 옮겨 심고 두 배포 뒤에 지운다
 */
/* global __dirname */
const fs = require('node:fs');
const path = require('node:path');

const DIR = path.join(__dirname, '..', 'next', 'src', 'server', 'infrastructure', 'database', 'migrations');
const ALLOW = /--\s*tc:allow-destructive\b/i;

/** 데이터를 잃거나 옛 코드를 깨는 구문. 이름은 오류 문구에 그대로 쓴다. */
const RULES = [
  [/\bdrop\s+table\b/i, '테이블 삭제'],
  [/\bdrop\s+schema\b/i, '스키마 삭제'],
  [/\bdrop\s+column\b/i, '컬럼 삭제'],
  [/\bdrop\s+type\b/i, '타입 삭제'],
  [/\btruncate\b/i, '데이터 비우기'],
  [/\brename\s+column\b/i, '컬럼 이름 변경'],
  [/\balter\s+table\s+[^;]*\brename\s+to\b/i, '테이블 이름 변경'],
  [/\balter\s+column\s+[^;]*\bset\s+not\s+null\b/i, '기존 컬럼에 NOT NULL 추가'],
  [/\balter\s+column\s+[^;]*\btype\b/i, '기존 컬럼 타입 변경'],
];

/** `--` 주석을 지운다. 따옴표 안의 `--`는 남긴다(문자열 속 하이픈을 주석으로 보지 않게). */
function stripComments(sql) {
  let out = '', quote = null;
  for (let i = 0; i < sql.length; i++) {
    const c = sql[i];
    if (quote) {
      out += c;
      if (c === quote) quote = null;
      continue;
    }
    if (c === "'" || c === '"') { quote = c; out += c; continue; }
    if (c === '-' && sql[i + 1] === '-') {
      while (i < sql.length && sql[i] !== '\n') i++;
      out += '\n';
      continue;
    }
    if (c === '/' && sql[i + 1] === '*') {
      i += 2;
      while (i < sql.length && !(sql[i] === '*' && sql[i + 1] === '/')) i++;
      i++;
      continue;
    }
    out += c;
  }
  return out;
}

/**
 * @param {string} sql 마이그레이션 한 파일의 내용
 * @returns {{rule:string, line:number, text:string}[]} 걸린 것들. 허용 표시가 있으면 빈 배열
 */
function findDestructive(sql) {
  if (ALLOW.test(sql)) return [];
  const body = stripComments(sql);
  const lines = body.split('\n');
  /** @type {{rule:string, line:number, text:string}[]} */
  const hits = [];
  lines.forEach((line, i) => {
    for (const [re, name] of RULES) {
      if (re.test(line)) hits.push({ rule: name, line: i + 1, text: line.trim().slice(0, 120) });
    }
  });
  return hits;
}

function main() {
  if (!fs.existsSync(DIR)) {
    console.log('마이그레이션 폴더가 없다 — 건너뛴다');
    return 0;
  }
  const files = fs.readdirSync(DIR).filter((f) => f.endsWith('.sql')).sort();
  let bad = 0;
  for (const file of files) {
    const hits = findDestructive(fs.readFileSync(path.join(DIR, file), 'utf8'));
    for (const hit of hits) {
      bad++;
      console.error(`✗ ${file}:${hit.line} ${hit.rule}\n    ${hit.text}`);
    }
  }
  if (bad) {
    console.error(`\n파괴적 마이그레이션 ${bad}건. main 머지는 운영 DB에 자동 적용되고, 이미지 롤백으로는 되돌아가지 않는다.`);
    console.error('나눠서 하거나(docs/migration-policy.md), 판단했다면 그 파일에 한 줄 남긴다:');
    console.error('    -- tc:allow-destructive <왜 안전한지>');
    return 1;
  }
  console.log(`마이그레이션 ${files.length}개 — 하위호환 확인`);
  return 0;
}

if (require.main === module) process.exit(main());
module.exports = { findDestructive, stripComments, RULES };
