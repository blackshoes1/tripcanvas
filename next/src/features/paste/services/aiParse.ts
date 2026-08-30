// AI 파싱 — 사용자 본인의 API 키로 브라우저에서 직접 호출한다(레거시와 같은 설계: 서버를 두지 않는다).
// ⚠️ 키는 이 요청 말고 어디에도 보내지 않는다. 로그·에러 메시지에도 싣지 않는다.
import legacyLib from '@legacy/lib.js';

const { extractJson } = legacyLib;

const API_URL = 'https://api.anthropic.com/v1/messages';

/** 레거시와 같은 시스템 프롬프트 — 두 앱이 같은 글을 같게 읽어야 한다 */
export const AI_SYSTEM = `너는 여행 일정 파서다. 사용자의 자유로운 여행 설명을 받아 JSON으로만 변환해라.
스키마: {"name":string,"start":"YYYY-MM-DD"|null,"days":[{"title":string,"mode":"car"|"taxi"|"transit"|"train"|"walk"|"bike"|"flight","startAt":"HH:MM"|null,"drive":string,"note":string,"spots":[{"name":string,"city":string,"desc":string,"opt":boolean,"stay":boolean,"legMode":"car"|"taxi"|"transit"|"train"|"walk"|"bike"|"flight"|null,"at":"HH:MM"|null,"stayMin":number|null,"cost":number|null,"cur":"KRW"|"USD"|"EUR"|"JPY"|"CNY","bookAt":"HH:MM"|null,"lat":number|null,"lng":number|null}]}]}
- stay는 숙소(호텔·에어비앤비 등)면 true.
- mode는 그날 주 이동수단: 렌터카/자차=car, 택시=taxi, 지하철·버스=transit, 기차·고속철(KTX·AVE·신칸센)=train, 비행기=flight, 걷기=walk, 자전거=bike. 언급 없으면 "car".
- legMode는 특정 구간만 수단이 다를 때 그 '도착 장소'에 지정(예: 공항→도심만 기차면 도심 장소에 "train"). 대개 null.
- startAt은 그날 시작 시각(예 "KTX 9시 출발"→"09:00"). 없으면 null.
- at은 '도착 시각 고정'(내가 정하는 계획): 그 시각에 도착하도록 못박고 싶을 때(예 "점심 12시"→"12:00", "3시에 도착"→"15:00"). 없으면 null.
- at과 bookAt 구분: at=내가 정한 도착 계획, bookAt=상대가 정한 약속(예매·공연·투어처럼 시각이 외부에서 정해진 것). 둘 다 24시간 표기 "HH:MM".
- stayMin은 장소 체류시간(분). "알함브라 3시간"→180, "1시간"→60. 언급 없으면 null.
- cost는 예상 비용 숫자만(통화는 cur). "입장료 2만원"→20000, "$50"→50, "5000엔"→5000. 없으면 null.
- cur는 cost의 통화: "달러/$"→"USD", "유로/€"→"EUR", "엔/¥"→"JPY", "위안/元"→"CNY", 그 외(원 포함)→"KRW".
- bookAt은 '예약·입장 시각'(상대가 정한 약속 — 예매·공연·투어·식당 예약). 예 "나스르궁 14시 입장"→"14:00". 없으면 null.
- 모든 텍스트 필드는 한국어.
- 각 장소의 실제 위도/경도를 네 지식으로 채워라. 확실하지 않으면 lat/lng를 null로 둬라.
- drive는 그날 이동 정보(예: "✈️ 인천 → 다롄"), note는 그날의 팁/메모. 없으면 빈 문자열.
- opt는 "가면 좋은" 선택 코스면 true, 필수면 false.
- JSON 외의 설명·인사·코드펜스를 절대 출력하지 마라.`;

export type AiResult = { ok: true; value: unknown } | { ok: false; error: string };

/** 자연어 → 초안 객체. 실패는 던지지 않고 이유를 돌려준다(키가 섞이지 않게 우리가 문구를 만든다) */
export async function parseWithAi(
  text: string, cfg: { apiKey: string; model: string }, fetchImpl: typeof fetch = fetch
): Promise<AiResult> {
  if (!cfg.apiKey) return { ok: false, error: 'AI 파싱을 쓰려면 API 키를 입력해주세요' };
  let res: Response;
  try {
    res = await fetchImpl(API_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': cfg.apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true'
      },
      body: JSON.stringify({
        model: cfg.model, max_tokens: 4000, system: AI_SYSTEM,
        messages: [{ role: 'user', content: text }]
      })
    });
  } catch {
    return { ok: false, error: 'AI에 연결하지 못했습니다 — 네트워크를 확인해주세요' };
  }
  if (!res.ok) {
    // 본문에 키가 되비쳐 올 수 있어 상태 코드만 보여준다
    return { ok: false, error: `AI 오류 ${res.status} — 키와 모델 이름을 확인해주세요` };
  }
  try {
    const data = await res.json() as { content?: { text?: string }[] };
    return { ok: true, value: JSON.parse(extractJson(data.content?.[0]?.text ?? '')) };
  } catch {
    return { ok: false, error: 'AI 응답을 읽지 못했습니다 — 다시 시도해주세요' };
  }
}
