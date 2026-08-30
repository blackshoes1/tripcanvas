// LZString 어댑터 — 도메인은 압축기를 주입받고 여기서만 라이브러리를 안다(§9).
// ⚠️ 레거시는 CDN lz-string 1.4.4, 여기는 npm 1.5.0을 쓴다. 두 버전의
// compressToEncodedURIComponent 출력은 바이트 단위로 같아 링크가 양쪽에서 열린다
// (검증함) — 메이저를 올릴 때는 이 왕복을 다시 확인할 것.
import LZString from 'lz-string';

export const compressShare = (text: string): string => LZString.compressToEncodedURIComponent(text);

/** 풀리지 않으면 null — 도메인이 '해석 불가'로 다룬다 */
export const decompressShare = (encoded: string): string | null =>
  LZString.decompressFromEncodedURIComponent(encoded);
