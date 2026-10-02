// 파리티 테스트 전용 — 저장소 파일을 **체크아웃의 줄바꿈과 무관하게** 읽고 쓴다. 앱 코드는 이걸 부르지 않는다.
//
// Windows(core.autocrlf=true)에서는 Swift 소스와 iOS 픽스처가 CRLF로 체크아웃된다. 그러면
//   - Contract.swift 파서의 정규식이 `var x: T? = nil\r` 줄을 놓쳐(`.`은 `\r`을 넘지 못한다) 계약이 갈린 것처럼 보였고,
//   - 픽스처를 LF로 다시 써서, 내용은 같은데 작업 트리가 더러워졌다(CI의 "픽스처가 커밋됐는가" 검사와 같은 판정이 깨진다).
// 리눅스(CI)에서는 둘 다 예전과 완전히 같다 — LF 파일은 LF로 읽고 LF로 쓴다.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const lf = (text: string): string => text.replace(/\r\n/g, '\n');

/** 소스 파일을 LF로 읽는다. */
export function readSourceText(file: string): string {
  return lf(readFileSync(file, 'utf8'));
}

/**
 * 픽스처를 쓴다(`text`는 LF). 줄바꿈만 다르고 내용이 같으면 **건드리지 않고**, 바뀌었으면 지금 체크아웃의
 * 줄바꿈(CRLF면 CRLF)을 지켜 쓴다 — 줄바꿈 때문에 생긴 차이가 커밋할 차이처럼 보이지 않게.
 */
export function writeFixture(file: string, text: string): void {
  if (existsSync(file)) {
    const current = readFileSync(file, 'utf8');
    if (lf(current) === lf(text)) return;
    if (current.includes('\r\n')) {
      writeFileSync(file, lf(text).replace(/\n/g, '\r\n'));
      return;
    }
  }
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, text);
}
