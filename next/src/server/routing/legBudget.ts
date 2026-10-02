// 경로 조회 예산 — 유료 경로 API를 하루에 얼마까지 부를지(2026-10-02).
//
// 그 전에는 요청당 상한(하루치 12 · 전체 60)만 있었다. 가입한 뒤 PUT으로 좌표를 바꾸고 GET /routes·/costs를
// 되풀이하면 매번 새 구간 60개를 서버 키로 조회했다 — 비용 상한이 Google 콘솔의 일일 할당량 하나뿐이었다.
// 이제 **사람마다**와 **서버 전체**의 하루 상한이 있다. 넘으면 조회하지 않고 지금처럼 추정으로 답한다 —
// 응답 모양은 그대로이고, 구간마다 `source`가 추정이라고 말한다.
//
// ⚠️ 저장소가 실패하면 0(닫힌 쪽)이다. 셀 수 없을 때 유료 조회를 열어 두지 않는다 — 추정은 틀린 답이 아니다.
import type { LegFillScope, LegFillUsageRepository } from '../repositories/types';

export interface LegFillLimits {
  /** 한 사람이 하루(UTC)에 조회를 일으킬 수 있는 구간 수 */
  perUserDaily: number;
  /** 서버 전체가 하루에 조회할 수 있는 구간 수 — 비용의 천장 */
  totalDaily: number;
}

/**
 * 기본값 — 정상 사용자가 닿지 않을 만큼 넉넉하게.
 *
 * - 사람마다 2000: 상한까지 긴 여행(`TC_LIMITS.days` 90일)을 하루 10곳씩 처음부터 짜도 구간은 900개 남짓이다
 *   (캐시는 사람 사이에 공유되고 30일 간다). 편집으로 생기는 새 구간까지 두 배를 둔 값이다.
 * - 전체 10000: 그런 사람 다섯이 같은 날 큰 여행을 새로 짜도 남는다. 오늘의 사용자 규모에서는 닿을 일이 없고,
 *   닿는다면 그것은 사용이 아니라 남용이다. 하드 리밋은 여전히 Google 콘솔의 일일 할당량이다(docs/security.md).
 *
 * ⚠️ 받아들인 대가: 전체 상한은 사람마다 상한의 5배뿐이고 가입은 무료라, 계정 몇 개로 전체 몫을 다 쓸 수 있다.
 * 그러면 그날(UTC) 남은 시간 동안 **모든 사용자**가 도로 없이 추정만 받는다(오류는 없다). 이 상한의 목적은
 * 비용의 천장이지 공정한 분배가 아니다 — 청구서는 막고, 그 대가로 기능이 하루 꺼질 수 있다. 닿으면 로그에
 * 한 줄 남으므로(`take`) 운영은 그걸 보고 남용 계정을 막거나 `LEG_FILL_USER_DAILY`를 낮춘다.
 */
export const DEFAULT_LEG_FILL_LIMITS: LegFillLimits = { perUserDaily: 2000, totalDaily: 10000 };

/** 서버 전체 갈래의 이름 */
export const TOTAL_SCOPE = 'all';

function readLimit(raw: string | undefined, fallback: number, name: string, warn: (m: string) => void): number {
  const text = (raw ?? '').trim();
  if (!text) return fallback;
  const n = Number(text);
  // 0은 유효하다 — 키를 빼지 않고 유료 조회만 멈추는 비상 스위치다
  if (Number.isInteger(n) && n >= 0) return n;
  warn(`${name}=${text}는 0 이상의 정수가 아니다 — 기본값 ${fallback}을 쓴다`);
  return fallback;
}

/** `LEG_FILL_USER_DAILY`·`LEG_FILL_TOTAL_DAILY`. 비었거나 이상하면 기본값 */
export function readLegFillLimits(env: Record<string, string | undefined>, warn: (m: string) => void = () => {}): LegFillLimits {
  return {
    perUserDaily: readLimit(env.LEG_FILL_USER_DAILY, DEFAULT_LEG_FILL_LIMITS.perUserDaily, 'LEG_FILL_USER_DAILY', warn),
    totalDaily: readLimit(env.LEG_FILL_TOTAL_DAILY, DEFAULT_LEG_FILL_LIMITS.totalDaily, 'LEG_FILL_TOTAL_DAILY', warn)
  };
}

export interface LegBudget {
  /** 오늘 남은 만큼만 `want`에서 떼어 준다(0..want) — 준 만큼은 이미 셌다 */
  take(userId: string | undefined, want: number): Promise<number>;
  /** 지금 더 조회할 수 있는 구간 수 — `legsPending`이 '곧 채워질 것'만 세도록 */
  remaining(userId: string | undefined): Promise<number>;
}

export interface LegBudgetDeps {
  repo: LegFillUsageRepository;
  limits: LegFillLimits;
  now?: () => Date;
  log?: (message: string) => void;
}

export function createLegBudget(deps: LegBudgetDeps): LegBudget {
  const now = deps.now ?? (() => new Date());
  const log = deps.log ?? (() => {});
  /** 그날 이미 알린 소진 — 소진된 뒤 요청마다 같은 줄을 남기지 않는다 */
  const announced = new Set<string>();

  /** 사용자가 없으면(내부 호출) 전체 갈래만 본다 */
  function scopesFor(userId: string | undefined): LegFillScope[] {
    const total = { scope: TOTAL_SCOPE, limit: deps.limits.totalDaily };
    return userId ? [{ scope: `user:${userId}`, limit: deps.limits.perUserDaily }, total] : [total];
  }

  const today = () => now().toISOString().slice(0, 10);

  return {
    async take(userId, want) {
      if (want <= 0) return 0;
      const day = today();
      let granted = 0;
      try {
        granted = await deps.repo.reserve(day, scopesFor(userId), want);
      } catch (error) {
        log(`경로 조회 예산을 확인하지 못했다 — 이번에는 조회하지 않는다 · ${error instanceof Error ? error.message : String(error)}`);
        return 0;
      }
      if (granted < want) {
        // 사용자 id는 남기지 않는다 — 누가가 아니라 '닿았다'는 사실이 운영에 필요한 전부다
        const key = `${day}|${userId ?? ''}`;
        if (!announced.has(key)) {
          if (announced.size > 10_000) announced.clear();
          announced.add(key);
          log(`경로 조회 하루 예산에 닿았다(사람마다 ${deps.limits.perUserDaily} · 전체 ${deps.limits.totalDaily}) — 남은 구간은 추정으로 남는다`);
        }
      }
      return granted;
    },
    async remaining(userId) {
      const scopes = scopesFor(userId);
      try {
        const used = await deps.repo.used(today(), scopes.map((s) => s.scope));
        return Math.max(0, Math.min(...scopes.map((s) => s.limit - (used.get(s.scope) ?? 0))));
      } catch {
        return 0;
      }
    }
  };
}
