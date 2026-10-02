// 파리티 테스트의 파일 읽기·쓰기는 체크아웃의 줄바꿈과 무관해야 한다.
// Windows(core.autocrlf=true)에서는 Swift 소스·픽스처가 CRLF로 체크아웃된다 — 그때 파서가 `= nil` 줄을
// 놓쳐 7건이 빨개지고, 픽스처를 LF로 다시 써서 작업 트리가 더러워졌다(내용은 그대로인데).
import { mkdtempSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { readSourceText, writeFixture } from './parityFiles';

const dirs: string[] = [];
function tempDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'tc-parity-'));
  dirs.push(dir);
  return dir;
}
afterEach(() => { while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true }); });

describe('파리티 파일 — 줄바꿈과 무관하게', () => {
  it('소스는 CRLF로 체크아웃돼도 LF로 읽는다', () => {
    const file = path.join(tempDir(), 'Contract.swift');
    writeFileSync(file, 'struct A: Codable {\r\n  var x: String? = nil\r\n}\r\n');
    expect(readSourceText(file)).toBe('struct A: Codable {\n  var x: String? = nil\n}\n');
  });

  it('내용이 같으면(줄바꿈만 다르면) 픽스처를 다시 쓰지 않는다', () => {
    const file = path.join(tempDir(), 'today.json');
    writeFileSync(file, '{\r\n  "a": 1\r\n}\r\n');
    const past = new Date('2020-01-01T00:00:00Z');
    utimesSync(file, past, past);

    writeFixture(file, '{\n  "a": 1\n}\n');

    expect(readFileSync(file, 'utf8')).toBe('{\r\n  "a": 1\r\n}\r\n');
    expect(statSync(file).mtimeMs).toBe(past.getTime());
  });

  it('내용이 바뀌면 쓰되, 체크아웃의 줄바꿈(CRLF)을 지킨다', () => {
    const file = path.join(tempDir(), 'today.json');
    writeFileSync(file, '{\r\n  "a": 1\r\n}\r\n');
    writeFixture(file, '{\n  "a": 2\n}\n');
    expect(readFileSync(file, 'utf8')).toBe('{\r\n  "a": 2\r\n}\r\n');
  });

  it('LF 체크아웃(리눅스·CI)이나 새 파일은 LF로 쓴다', () => {
    const dir = tempDir();
    const lf = path.join(dir, 'lf.json');
    writeFileSync(lf, '{\n  "a": 1\n}\n');
    writeFixture(lf, '{\n  "a": 2\n}\n');
    expect(readFileSync(lf, 'utf8')).toBe('{\n  "a": 2\n}\n');

    const fresh = path.join(dir, 'nested', 'fresh.json');
    writeFixture(fresh, '{\n  "b": 1\n}\n');
    expect(readFileSync(fresh, 'utf8')).toBe('{\n  "b": 1\n}\n');
  });
});
