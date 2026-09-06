// 서버 환경(§57). 비밀은 여기서만 읽고 도메인 코드는 모른다. 값이 없으면 오늘의 배포(Supabase 레거시)와 같은 동작이다.
import { readAllowedOrigins } from '../api/cors';
import { readRegistry, type MigrationRegistry } from './migrationRegistry';

export interface SmtpConfig {
  host: string;
  port: number;
  secure: boolean;
  user: string | null;
  password: string | null;
  /** From 헤더 — 없으면 SMTP를 쓰지 않는다(받는 쪽에서 거절당한다) */
  from: string;
}

export interface ServerEnv {
  /** 독립 PostgreSQL. 없으면 새 backend 경로를 쓰지 않는다 */
  databaseUrl: string | null;
  /** Supabase 프로젝트 URL — JWT issuer(`${url}/auth/v1`)와 JWKS 위치의 근거 */
  supabaseUrl: string;
  /** 구형 HS256 토큰 검증용 JWT secret(있을 때만). 새 프로젝트의 비대칭 키는 JWKS로 받는다 */
  supabaseJwtSecret: string | null;
  /** 자체 Auth의 서명·암호화 비밀. 짧거나 없으면 null — 약한 값으로 조용히 켜지 않는다 */
  authSecret: string | null;
  /** 이 API의 공개 주소(인증·재설정 링크가 여기로 만들어진다) */
  apiBaseUrl: string;
  /** 브라우저에서 이 API를 부르는 출처(§72). 비어 있으면 baseURL만 신뢰한다 */
  trustedOrigins: string[];
  /** 자체 실시간 사이드카의 공개 주소(wss://…/ws). 없으면 자체 실시간을 쓰지 않는다 */
  realtimeUrl: string | null;
  /** 메일 속 링크가 도착할 웹 주소. API 호스트에는 사람이 볼 화면이 없다 */
  webBaseUrl: string;
  smtp: SmtpConfig | null;
  /** 국내 장소 검색(카카오 로컬)·국내 경로(카카오 내비)용 **서버 전용** REST 키. 없으면 그 기능이 '미연결'이다 */
  kakaoRestKey: string;
  /**
   * 해외 경로(Google Routes)용 **서버 전용** 키. 웹 키(리퍼러 제한)·iOS 키(번들 제한)는 서버에서 거절된다.
   * 없으면 해외 구간은 직선 추정으로 남는다 — 동작이 달라지지 않는다.
   */
  googleRoutesKey: string;
  /** 자체 Auth를 켤 수 있는가 — 비밀과 DB가 둘 다 있어야 한다 */
  newAuthEnabled: boolean;
  registry: MigrationRegistry;
}

const LEGACY_SUPABASE_URL = 'https://gdnhrwtfidjimtabgovh.supabase.co';
/** 32자 미만은 받지 않는다 — 라이브러리도 낮은 엔트로피를 경고한다 */
const MIN_SECRET_LENGTH = 32;

function readSmtp(env: Record<string, string | undefined>): SmtpConfig | null {
  const host = (env.SMTP_HOST ?? '').trim();
  const from = (env.MAIL_FROM ?? '').trim();
  // 반쯤 설정된 채로 켜지 않는다 — 조용히 삼켜진 메일보다 콘솔로 떨어지는 편이 낫다
  if (!host || !from) return null;
  const port = Number(env.SMTP_PORT) || 587;
  return {
    host, port,
    secure: env.SMTP_SECURE ? env.SMTP_SECURE !== 'false' : port === 465,
    user: env.SMTP_USER || null,
    password: env.SMTP_PASSWORD || null,
    from
  };
}

export function parseEnv(env: Record<string, string | undefined>, warn?: (m: string) => void): ServerEnv {
  const notify = warn ?? (() => {});
  const rawUrl = env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL || LEGACY_SUPABASE_URL;
  const databaseUrl = env.DATABASE_URL || null;

  const rawSecret = (env.AUTH_SECRET ?? '').trim();
  let authSecret: string | null = null;
  if (rawSecret && rawSecret.length < MIN_SECRET_LENGTH) {
    notify(`AUTH_SECRET이 ${MIN_SECRET_LENGTH}자보다 짧다 — 자체 Auth를 켜지 않는다`);
  } else if (rawSecret) {
    authSecret = rawSecret;
  }

  return {
    databaseUrl,
    supabaseUrl: rawUrl.replace(/\/+$/, ''),
    supabaseJwtSecret: env.SUPABASE_JWT_SECRET || null,
    authSecret,
    apiBaseUrl: (env.API_BASE_URL || 'http://localhost:3000').replace(/\/+$/, ''),
    // CORS와 같은 목록을 쓴다 — 설정이 없으면 이 앱의 알려진 웹 주소
    trustedOrigins: readAllowedOrigins(env),
    realtimeUrl: (env.REALTIME_URL ?? '').trim() || null,
    // 설정이 없으면 허용 출처의 첫 번째 — 이 앱의 웹 주소다. 그래야 배포에 값을 하나 더 넣지 않아도 링크가 산다
    webBaseUrl: ((env.WEB_BASE_URL ?? '').trim() || readAllowedOrigins(env)[0] || '').replace(/\/+$/, ''),
    // 카카오내비 프록시가 이미 쓰는 이름을 그대로 쓴다 — 같은 키다
    kakaoRestKey: (env.KAKAO_REST_API_KEY ?? '').trim(),
    googleRoutesKey: (env.GOOGLE_ROUTES_API_KEY ?? '').trim(),
    smtp: readSmtp(env),
    newAuthEnabled: !!authSecret && !!databaseUrl,
    registry: readRegistry(env, warn)
  };
}

let cached: ServerEnv | null = null;
export function getEnv(): ServerEnv {
  if (!cached) cached = parseEnv(process.env, (m) => console.warn(`[tripcanvas-api] ${m}`));
  return cached;
}
