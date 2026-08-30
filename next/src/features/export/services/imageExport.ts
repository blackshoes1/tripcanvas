'use client';
// html2canvas 지연 로드 + 캡처. 레거시와 같은 버전·같은 SRI를 쓴다.
// 실패는 던지지 않고 이유를 돌려준다 — 네트워크가 없다고 앱이 멈출 이유는 없다.
const SRC = 'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js';
const SRI = 'sha384-ZZ1pncU3bQe8y31yfZdMFdSpttDoPmOZg2wguVK9almUodir1PghgT0eY7Mrty8H';

type H2C = (el: HTMLElement, opts: Record<string, unknown>) => Promise<HTMLCanvasElement>;

let loading: Promise<boolean> | null = null;

/** 한 번만 받아온다 — 실패해도 다시 시도할 수 있게 실패는 캐시하지 않는다 */
export function loadHtml2Canvas(): Promise<boolean> {
  if (typeof window === 'undefined') return Promise.resolve(false);
  if ((window as { html2canvas?: H2C }).html2canvas) return Promise.resolve(true);
  if (loading) return loading;
  loading = new Promise<boolean>(res => {
    const s = document.createElement('script');
    s.src = SRC;
    s.integrity = SRI;
    s.crossOrigin = 'anonymous';
    s.onload = () => res(true);
    s.onerror = () => { loading = null; res(false); };
    document.head.appendChild(s);
  });
  return loading;
}

export type CaptureResult = { ok: true; dataUrl: string } | { ok: false; error: string };

/** 노드를 PNG data URL로. scale 2는 레거시와 같다(레티나에서도 또렷하게) */
export async function captureNode(el: HTMLElement, background: string): Promise<CaptureResult> {
  if (!(await loadHtml2Canvas())) {
    return { ok: false, error: '이미지 모듈을 불러오지 못했습니다 — 네트워크를 확인해주세요' };
  }
  const h2c = (window as unknown as { html2canvas: H2C }).html2canvas;
  try {
    const canvas = await h2c(el, { backgroundColor: background, scale: 2 });
    return { ok: true, dataUrl: canvas.toDataURL('image/png') };
  } catch {
    return { ok: false, error: '이미지를 만들지 못했습니다' };
  }
}
