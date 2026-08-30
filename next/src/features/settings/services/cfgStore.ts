// 앱 설정 — 레거시와 같은 localStorage(tripcanvas_cfg). AI 파싱 on/off·API 키·모델.
//
// ⚠️ API 키는 사용자 본인 것이고, 이 저장소와 api.anthropic.com 말고는 어디에도 보내지 않는다.
// (레거시와 같은 설계 — 서버를 두지 않으려고 브라우저에서 직접 호출한다)
const CFG_KEY = 'tripcanvas_cfg';

export interface AppCfg {
  /** 자연어를 AI로 파싱할지 — 끄면 직접 형식만 읽는다 */
  aiParse: boolean;
  apiKey: string;
  model: string;
}

export const CFG_DEFAULT: Readonly<AppCfg> =
  Object.freeze({ aiParse: false, apiKey: '', model: 'claude-sonnet-5' });

const listeners = new Set<() => void>();
let cached: AppCfg = { ...CFG_DEFAULT };
let cachedRaw: string | null | undefined;

export function getCfgSnapshot(): AppCfg {
  if (typeof window === 'undefined') return cached;
  const raw = window.localStorage.getItem(CFG_KEY);
  if (cachedRaw === undefined || raw !== cachedRaw) {
    cachedRaw = raw;
    let parsed: Partial<AppCfg> = {};
    try { parsed = (JSON.parse(raw ?? 'null') as Partial<AppCfg>) ?? {}; } catch { parsed = {}; }
    cached = {
      aiParse: !!parsed.aiParse,
      apiKey: typeof parsed.apiKey === 'string' ? parsed.apiKey : '',
      model: typeof parsed.model === 'string' && parsed.model ? parsed.model : CFG_DEFAULT.model
    };
  }
  return cached;
}

export function getCfgServerSnapshot(): AppCfg {
  return cached;
}

export function subscribeCfg(cb: () => void): () => void {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}

/** 설정 일부 갱신 — 레거시가 읽는 모양 그대로 되쓴다 */
export function saveCfg(patch: Partial<AppCfg>): boolean {
  if (typeof window === 'undefined') return false;
  try {
    window.localStorage.setItem(CFG_KEY, JSON.stringify({ ...getCfgSnapshot(), ...patch }));
    cachedRaw = undefined;
    listeners.forEach(l => l());
    return true;
  } catch {
    return false;
  }
}
