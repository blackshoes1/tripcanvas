// API 오류 계약(§29·§30). HTTP 상태와 도메인 오류를 구분한다 — 도메인 코드는 ApiError를 던지고, 라우트 경계가 Response로 바꾼다.
//
// 본문: { code, message, details?, error }
//   error 는 code와 같은 값이다 — 기존 iOS APIErrorBody 가 읽는 필드라 구버전 앱 호환을 위해 함께 싣는다(§27).
//   details.revision 이 있으면 최상위 revision 으로도 올린다(기존 REVISION_CONFLICT 계약과 같은 자리).

export type ErrorCode =
  | 'UNAUTHORIZED' | 'FORBIDDEN' | 'NOT_FOUND' | 'VALIDATION_ERROR'
  | 'CONFLICT' | 'STALE_VERSION' | 'RATE_LIMITED' | 'UPSTREAM_ERROR' | 'INTERNAL_ERROR';

const STATUS: Record<ErrorCode, number> = {
  UNAUTHORIZED: 401, FORBIDDEN: 403, NOT_FOUND: 404, VALIDATION_ERROR: 400,
  CONFLICT: 409, STALE_VERSION: 409, RATE_LIMITED: 429, UPSTREAM_ERROR: 502, INTERNAL_ERROR: 500
};

const MESSAGE: Record<ErrorCode, string> = {
  UNAUTHORIZED: '로그인이 필요합니다.',
  FORBIDDEN: '이 여행을 바꿀 권한이 없습니다 — 주최자에게 편집 권한을 요청해 주세요.',
  NOT_FOUND: '그 여행을 찾을 수 없습니다.',
  VALIDATION_ERROR: '요청 형식이 올바르지 않습니다.',
  CONFLICT: '이미 있는 항목입니다.',
  STALE_VERSION: '다른 기기에서 먼저 바뀌었습니다 — 최신 일정을 불러온 뒤 다시 시도해 주세요.',
  RATE_LIMITED: '요청이 너무 잦습니다 — 잠시 뒤 다시 시도해 주세요.',
  UPSTREAM_ERROR: '바깥 서비스가 지금 응답하지 않습니다 — 잠시 뒤 다시 시도해 주세요.',
  INTERNAL_ERROR: '서버에서 문제가 생겼습니다 — 잠시 뒤 다시 시도해 주세요.'
};

export interface ErrorBody {
  code: ErrorCode;
  error: ErrorCode;
  message: string;
  details?: Record<string, unknown>;
  revision?: number;
}

export class ApiError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details?: Record<string, unknown>;
  constructor(code: ErrorCode, opts: { message?: string; details?: Record<string, unknown> } = {}) {
    super(opts.message ?? MESSAGE[code]);
    this.name = 'ApiError';
    this.code = code;
    this.status = STATUS[code];
    this.details = opts.details;
  }
}

export const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' };

export function errorResponse(error: unknown): Response {
  const err = error instanceof ApiError ? error : new ApiError('INTERNAL_ERROR');
  const body: ErrorBody = { code: err.code, error: err.code, message: err.message };
  if (err.details) {
    body.details = err.details;
    if (typeof err.details.revision === 'number') body.revision = err.details.revision;
  }
  return new Response(JSON.stringify(body), { status: err.status, headers: JSON_HEADERS });
}
