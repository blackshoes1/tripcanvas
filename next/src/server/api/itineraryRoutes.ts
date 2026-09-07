// POST /api/v1/itineraries/parse — 붙여넣은 일정 글을 초안으로 읽는다.
//
// 앱이 이 라우트를 쓰는 이유는 하나다: **파서를 Swift로 복제하지 않기 위해서다.**
// 규칙(시간 접두사·전각 구분자·다음 줄 설명·링크·날짜·장소 힌트)은 `intake.js` 하나에 있고,
// 복제하면 웹과 앱이 같은 글을 다르게 읽기 시작한다(§엔진은 하나다).
//
// ⚠️ **아무것도 저장하지 않는다.** 초안만 돌려주고, 담을 것을 고른 뒤 `POST /api/v1/trips`로 만든다.
import intake from '@legacy/intake.js';

import type {
  ItineraryDraft, ItineraryDraftItem, ItineraryItemKind, ItineraryParseResponse
} from '@/features/trip-state/domain/contract';
import { CONTRACT_SCHEMA_VERSION } from '@/features/trip-state/domain/contract';

import { authenticate } from '../auth/authenticate';
import type { TokenVerifier } from '../auth/types';
import { ApiError, errorResponse, JSON_HEADERS } from './errors';

/** 웹의 붙여넣기 칸과 같은 상한 — 그보다 긴 글은 일정이 아니라 문서다 */
const MAX_TEXT_LENGTH = 20000;
const KINDS: ItineraryItemKind[] = ['PLACE', 'ACTIVITY', 'MOVE', 'STAY'];

type RawItem = Record<string, unknown>;
type RawDay = { title?: unknown; date?: unknown; note?: unknown; items?: unknown };

function text(value: unknown): string { return typeof value === 'string' ? value : ''; }
function nullableText(value: unknown): string | null {
  const s = text(value).trim();
  return s ? s : null;
}
function nullableNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function toItem(raw: RawItem): ItineraryDraftItem {
  const lat = nullableNumber(raw.lat);
  const lng = nullableNumber(raw.lng);
  const kind = KINDS.includes(raw.kind as ItineraryItemKind) ? (raw.kind as ItineraryItemKind) : 'PLACE';
  return {
    raw: text(raw.raw),
    name: text(raw.name),
    city: text(raw.city),
    desc: text(raw.desc),
    at: nullableText(raw.at),
    endAt: nullableText(raw.endAt),
    // ⚠️ 계약의 '분'은 정수다 — 소수를 보내면 Swift가 Int 디코딩에서 죽는다.
    stayMinutes: raw.stayMin == null ? null : Math.round(Number(raw.stayMin)) || 0,
    url: nullableText(raw.url),
    cost: nullableNumber(raw.cost),
    currency: nullableText(raw.cur),
    optional: raw.opt === true,
    stay: raw.stay === true,
    location: lat != null && lng != null ? { lat, lng } : null,
    kind,
    reasons: Array.isArray(raw.reasons) ? raw.reasons.map(String).slice(0, 3) : []
  };
}

export function toDraft(parsed: { name?: unknown; start?: unknown; startAmbiguous?: unknown; days?: unknown }): ItineraryDraft {
  const days = Array.isArray(parsed.days) ? (parsed.days as RawDay[]) : [];
  return {
    name: text(parsed.name),
    start: nullableText(parsed.start),
    startAmbiguous: parsed.startAmbiguous === true,
    days: days.map((day, index) => ({
      index,
      title: text(day.title),
      date: nullableText(day.date),
      note: text(day.note),
      items: (Array.isArray(day.items) ? (day.items as RawItem[]) : []).map(toItem)
    }))
  };
}

export interface ItineraryRouteDeps {
  verifier: TokenVerifier;
  /** 연도가 없는 글(`7월 21일`)에 쓸 연도 */
  now?: () => Date;
}

export function createItineraryRoutes(deps: ItineraryRouteDeps) {
  const now = deps.now ?? (() => new Date());
  return {
    async parse(request: Request): Promise<Response> {
      try {
        await authenticate(request, deps.verifier);

        let body: { text?: unknown; year?: unknown };
        try { body = (await request.json()) as typeof body; }
        catch { throw new ApiError('VALIDATION_ERROR', { message: '요청 형식이 올바르지 않습니다.' }); }

        const source = text(body.text);
        if (!source.trim()) throw new ApiError('VALIDATION_ERROR', { message: '읽을 내용이 없습니다.' });
        if (source.length > MAX_TEXT_LENGTH) {
          throw new ApiError('VALIDATION_ERROR', { message: '글이 너무 깁니다 — 나눠서 붙여넣어 주세요.' });
        }

        const year = Number(body.year);
        const parsed = intake.parseItinerary(source, {
          year: Number.isInteger(year) && year >= 1900 && year <= 2999 ? year : now().getUTCFullYear()
        });

        const payload: ItineraryParseResponse = {
          schemaVersion: CONTRACT_SCHEMA_VERSION,
          draft: toDraft(parsed as Parameters<typeof toDraft>[0])
        };
        return new Response(JSON.stringify(payload), { status: 200, headers: JSON_HEADERS });
      } catch (e) {
        return errorResponse(e);
      }
    }
  };
}
