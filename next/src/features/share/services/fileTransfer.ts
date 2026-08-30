// 파일 주고받기 — 브라우저 표면만. 판정·형식은 domain/tripFile이 한다(§9).

/** 텍스트를 파일로 내려받는다. objectURL은 바로 회수한다(탭이 살아 있는 동안 새면 메모리를 잡는다) */
export function downloadText(text: string, filename: string, type = 'application/json'): void {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  // click()은 동기지만 다운로드 시작은 아니라, 다음 태스크에서 회수한다
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/** data: URL을 파일로 내려받는다 (이미지 내보내기 — Blob과 달리 회수할 objectURL이 없다) */
export function downloadDataUrl(dataUrl: string, filename: string): void {
  const a = document.createElement('a');
  a.href = dataUrl;
  a.download = filename;
  a.click();
}

export type FileRead = { ok: true; text: string } | { ok: false; error: string };

/**
 * 고른 파일을 텍스트로. 크기는 **읽기 전에** 본다 — 2MB 제한을 읽고 나서 재면
 * 그 사이 메모리를 이미 다 쓴 뒤다.
 */
export function readTextFile(file: File, maxBytes: number): Promise<FileRead> {
  if (file.size > maxBytes) {
    return Promise.resolve({ ok: false, error: `파일이 너무 큽니다 (최대 ${Math.round(maxBytes / 1024 / 1024)}MB)` });
  }
  return new Promise(resolve => {
    const rd = new FileReader();
    rd.onload = () => resolve(
      typeof rd.result === 'string'
        ? { ok: true, text: rd.result }
        : { ok: false, error: '파일을 읽지 못했습니다' }
    );
    rd.onerror = () => resolve({ ok: false, error: '파일을 읽지 못했습니다' });
    rd.readAsText(file);
  });
}

/** 클립보드 복사 — 권한이 없거나 http면 실패하므로 호출측이 폴백을 준비한다 */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
