/** 분류(무엇에 쓴 돈)와 다른 축이다 — 같은 '숙박'도 예약만 해 둔 것과 결제한 것이 있다. */
export type CostPayState = 'RESERVED' | 'PAID' | 'NONE';

export interface CostDetails {
  items: {
    /** TRIP은 여행 단위 준비 비용(`trip.costItems`) — 어느 날에도 속하지 않는다. */
    source: 'SPOT' | 'EXTRA' | 'BOOKING' | 'TRANSPORT' | 'TRIP';
    key: string;
    title: string;
    kind: string;
    amount: number | null;
    currency: string;
    basis: 'ENTERED' | 'TOTAL' | 'PER_PERSON';
    people: number;
    totalKRW: number | null;
    state: 'UNKNOWN' | 'PARTIAL' | 'FREE' | 'KNOWN' | 'BOOKING';
    /** 예약해 둔 돈인가 이미 낸 돈인가. 고르지 않았으면 NONE — 어느 쪽으로도 단정하지 않는다.
     *  결제일(`paidOn`)이 있으면 서버의 오늘(여행 시간대)이 정한 값이다 — 손으로 고른 표시가 아니다. */
    payState: CostPayState;
    /** 결제(예정)일 `YYYY-MM-DD`. 없으면 null. 있으면 이 날부터 결제함이다 — 화면은 이 날짜를 보이고 상태는 `payState`를 쓴다. */
    paidOn: string | null;
    /** 영수증·품목 사진의 **참조**(기기 사진 식별자). 원본 이미지는 문서에 넣지 않는다. */
    photos: string[];
  }[];
  budget: {
    amount: number;
    currency: string;
    basis: 'ENTERED' | 'TOTAL' | 'PER_PERSON';
    people: number;
    totalKRW: number;
    differenceKRW: number;
  } | null;
  unknownCount: number;
  transportUnpriced: boolean;
  undatedBookings: number;
  hasForeignCurrency: boolean;
  fxRates: Record<string, number>;
  fxSource: string;
  fxAsOf: string | null;
}

export interface DayCostSummary {
  total: number;
  /** 가서 쓰는 돈(장소·추가 비용·교통)만. 예약 하루치는 가기 전에 낸 돈의 배분이라 뺀다. 옛 서버에는 없다. */
  onSiteKRW?: number;
  parts: { label: string; amount: number }[];
  /** 결제 상태별 원화 합계. 셋을 더하면 total과 같다. */
  payTotals?: Record<CostPayState, number>;
  /** Optional while older API servers and cached responses remain in use. */
  details?: CostDetails;
}
