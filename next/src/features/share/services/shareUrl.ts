// 주소창의 공유 해시 = 외부 시스템. useSyncExternalStore로 구독해 **렌더에서 파생**한다
// (마운트 이펙트로 한 번만 읽으면, 주소창에 새 공유 링크를 붙여넣어도 화면이 따라가지 않는다).
//
// 이 세션에서 처리한 결과(구버전 #t= 링크를 저장했다 등)도 같은 스냅샷에 담는다 —
// 해시를 지우고 나면 URL만으로는 무슨 일이 있었는지 알 수 없어서, 알림이 사라져 버린다.

export type ShareOutcome =
  | { kind: 'claimed'; name: string }
  /** 열지 못한 링크 — 해시를 지운 뒤에도 이유는 남겨야 한다(안 그러면 한 프레임 스치고 사라진다) */
  | { kind: 'error'; message: string }
  | null;

export interface ShareUrlSnapshot {
  hash: string;
  outcome: ShareOutcome;
}

const EMPTY: ShareUrlSnapshot = { hash: '', outcome: null };

/**
 * 문서가 열릴 때의 해시를 붙잡아 둔다 — 레거시가 스크립트 로드 시점에 location.hash를
 * 읽어 두는 것과 같다.
 * ⚠️ Next 라우터는 hydration 중 history.replaceState로 주소를 다시 쓴다. 지금 버전은
 * 해시를 그대로 두지만(실측), hydration이 도는 사이에 해시가 바뀌면 라우터가 붙잡아 둔
 * 예전 주소로 덮여 해시가 사라지는 것을 확인했다. 링크 하나가 통째로 증발하는 실패라
 * 라이브 해시에만 기대지 않는다. 우리가 걷어낼 때(clearShareHash) 함께 버린다.
 */
let openedWith: string = typeof window === 'undefined' ? '' : window.location.hash;

let outcome: ShareOutcome = null;
/** 스냅샷 캐시 — 값이 그대로면 같은 객체를 돌려준다(useSyncExternalStore 계약) */
let cached: ShareUrlSnapshot = EMPTY;
const listeners = new Set<() => void>();

function emit(): void {
  listeners.forEach(l => l());
}

export function subscribeShareUrl(cb: () => void): () => void {
  listeners.add(cb);
  if (typeof window !== 'undefined') {
    window.addEventListener('hashchange', cb);
    window.addEventListener('popstate', cb);
  }
  return () => {
    listeners.delete(cb);
    if (typeof window !== 'undefined') {
      window.removeEventListener('hashchange', cb);
      window.removeEventListener('popstate', cb);
    }
  };
}

export function getShareUrlSnapshot(): ShareUrlSnapshot {
  if (typeof window === 'undefined') return EMPTY;
  // 라우터가 흘렸을 수 있으므로, 주소창이 비었으면 열릴 때 들고 온 해시로 되짚는다
  const hash = window.location.hash || openedWith;
  if (cached.hash !== hash || cached.outcome !== outcome) cached = { hash, outcome };
  return cached;
}

/** SSR에는 주소창이 없다 — hydration 후 실제 해시로 다시 그린다 */
export function getShareUrlServerSnapshot(): ShareUrlSnapshot {
  return EMPTY;
}

/**
 * 공유 해시를 걷어내고(새로고침해도 다시 열리지 않게) 결과를 남긴다.
 * replaceState는 hashchange를 일으키지 않으므로 우리가 직접 알린다.
 */
export function clearShareHash(next: ShareOutcome = null): void {
  openedWith = '';           // 걷어낸 링크가 되살아나지 않게
  outcome = next;
  window.history.replaceState(null, '', window.location.pathname + window.location.search);
  emit();
}
