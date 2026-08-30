// 온보딩을 닫았는지 — 레거시와 같은 키(tripcanvas_onboarded_v1)를 쓴다.
// 두 앱 중 어디서 닫든 다시 뜨지 않게 한다 (같은 사람에게 같은 소개를 두 번 보일 이유가 없다).
const ONBOARD_KEY = 'tripcanvas_onboarded_v1';

const listeners = new Set<() => void>();
/** 저장이 막힌 브라우저(사생활 보호 모드)에서도 이번 세션에는 다시 뜨지 않게 */
let dismissedThisSession = false;

export function getOnboardDismissed(): boolean {
  if (typeof window === 'undefined') return true;
  if (dismissedThisSession) return true;
  try { return !!window.localStorage.getItem(ONBOARD_KEY); } catch { return true; }
}

/** SSR에는 저장소가 없다 — 서버에서 소개 화면을 그려 두면 hydration 직후 깜빡인다 */
export function getOnboardServerDismissed(): boolean { return true; }

export function subscribeOnboard(cb: () => void): () => void {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}

/** 닫음을 기록한다. 저장에 실패해도(사생활 보호 모드 등) 이번 세션에서는 닫힌 채로 둔다 */
export function dismissOnboard(): void {
  dismissedThisSession = true;
  try { window.localStorage.setItem(ONBOARD_KEY, '1'); } catch { /* 이번 세션만 유지 */ }
  listeners.forEach(l => l());
}
