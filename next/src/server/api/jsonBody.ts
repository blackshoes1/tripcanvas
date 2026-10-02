// JSON 요청 본문 읽기 — **파싱 전에** 크기를 센다(2026-10-02).
//
// 그 전에는 라우트마다 `request.json()`을 그대로 불러 본문을 끝까지 메모리에 올렸다. 로그인만 하면 수백 MB를
// 보내 API 프로세스(NAS 한 대)를 세울 수 있었다. Content-Length만 보면 청크 전송(길이 헤더 없음)이 지나가므로
// 스트림을 읽으며 직접 세고, 넘는 순간 읽기를 멈춘다(`readPlanPreviewBody`가 하던 방식을 일반화했다).
//
// ⚠️ 덮는 범위는 **우리가 직접 본문을 읽는 라우트**다(/api/v1 · 소셜 로그인 교환). better-auth가 스스로 읽는
// `/api/auth/*`와 레거시 프록시(`lib/legacy/nodeHandler.ts`)는 여기를 지나지 않는다 — 어디서나 막혔다고 읽지 말 것.
import lib from '@legacy/lib.js';

/**
 * 기본 상한 — 여행 문서 상한(`TC_LIMITS.jsonBytes`, 2 MiB)의 **두 배**.
 *
 * 여행 문서 PUT이 가장 큰 정상 요청이다. 문서 크기는 서버가 다시 직렬화한 UTF-8로 재는데(`validateTripPayload`),
 * 보내는 쪽 인코딩은 그보다 클 수 있다 — iOS가 쓰는 Foundation 인코더(`JSONEncoder`·`JSONSerialization`)는
 * 기본으로 `/`를 `\/`로 쓰고, 비ASCII를 `\uXXXX`로 쓰는 인코더면 한글 한 글자가 3바이트가 아니라 6바이트다.
 * 거기에 봉투(`expectedRevision`·`force`)가 붙는다.
 * 그래서 상한에 닿은 문서도 여유 있게 지나가고, 막히는 것은 어차피 문서 검증에서 거절될 크기뿐이다.
 */
export const REQUEST_BODY_MAX_BYTES: number = lib.TC_LIMITS.jsonBytes * 2;

/** 너무 큰 본문을 거절할 때의 문장 — 화면에 그대로 나간다 */
export const BODY_TOO_LARGE_MESSAGE = '보낸 내용이 너무 커요 — 줄여서 다시 시도해 주세요.';

export type JsonBody =
  | { ok: true; value: unknown }
  /** TOO_LARGE: 상한을 넘었다(읽기를 멈췄다) · INVALID: 본문이 없거나 JSON이 아니다 */
  | { ok: false; reason: 'TOO_LARGE' | 'INVALID' };

/** 본문을 상한까지만 읽어 JSON으로 푼다. 던지지 않는다 — 어떻게 답할지는 라우트의 오류 계약이 정한다 */
export async function readJsonBody(request: Request, maxBytes: number = REQUEST_BODY_MAX_BYTES): Promise<JsonBody> {
  // 길이를 밝힌 요청은 읽기 전에 거절한다. 밝히지 않았거나 거짓이어도 아래에서 다시 센다
  if (Number(request.headers.get('content-length')) > maxBytes) return { ok: false, reason: 'TOO_LARGE' };
  if (!request.body) return { ok: false, reason: 'INVALID' };
  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let size = 0;
  let text = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel().catch(() => undefined);
        return { ok: false, reason: 'TOO_LARGE' };
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
  } catch {
    return { ok: false, reason: 'INVALID' };
  } finally {
    reader.releaseLock();
  }
  try { return { ok: true, value: JSON.parse(text) }; } catch { return { ok: false, reason: 'INVALID' }; }
}
