(function(root){
  'use strict';
  // 예약 가격 추적 — 순수 계산 모듈 (네트워크·DOM 무관, 단위 테스트 + tsc 대상).
  // 목표는 최저가 나열이 아니라 "지금 예약을 유지할까, 갈아탈까"의 판단 재료:
  // 실질 절약액 = 예약가 − 현재가 − (지금 취소하면 내는) 취소 수수료.
  // 판정 기준은 하드코딩하지 않고 PRICE_CFG로 분리 — 모든 함수가 cfg 재정의를 받는다.

  /** @typedef {{minSaving:number,minRate:number,goodMargin:number,goodMinObs:number,staleHours:number,maxObs:number}} PriceCfg */
  /** @typedef {{price:number,at?:string,cur?:string,provider?:string,url?:string}} PriceObs */

  /** @type {PriceCfg} */
  const PRICE_CFG=Object.freeze({
    minSaving:50000,   // ₩ 환산 절약액이 이 값을 '넘으면' 의미 있는 기회 (동일 금액은 미충족)
    minRate:0.07,      // 또는 예약가 대비 7% 이상 하락
    goodMargin:0.03,   // 현재가가 관측 최저가의 +3% 이내면 '좋은 가격'
    goodMinObs:3,      // '좋은 가격' 판정에 필요한 최소 관측 수 (데이터가 적으면 판단 보류)
    staleHours:12,     // 이보다 최근 관측이 있으면 자동 재조회 생략
    maxObs:40          // 예약당 보관하는 관측 수 상한
  });

  /** 지금 취소하면 내는 실질 수수료 — 무료취소 기한(freeCancelUntil) 안이면 0 @param {any} b @param {string=} today YYYY-MM-DD @returns {number} */
  function cancelFeeNow(b,today){
    if(!b) return 0;
    if(b.freeCancelUntil && today && today<=b.freeCancelUntil) return 0;
    const f=+(b.cancelFee||0);
    return isFinite(f)&&f>0? f:0;
  }

  /** 실질 절약액·하락률 (예약 통화 기준) @param {any} b 예약({price,cancelFee?,freeCancelUntil?}) @param {number} current 현재 확인 가격 @param {string=} today @returns {{saving:number,rate:number,fee:number}} */
  function calcSaving(b,current,today){
    const price=+((b&&b.price)||0), fee=cancelFeeNow(b,today);
    const saving=price-(+current||0)-fee;
    return {saving, rate: price>0? saving/price:0, fee};
  }

  /** 의미 있는 절약 기회인지 — ₩ 환산 금액 초과 또는 하락률 기준 @param {{saving:number,rate:number}} sv @param {number=} krwRate 통화 1단위=₩ (KRW면 1) @param {PriceCfg=} cfg @returns {boolean} */
  function savingWorth(sv,krwRate,cfg){
    const c=cfg||PRICE_CFG;
    return sv.saving>0 && (sv.saving*(krwRate||1)>c.minSaving || sv.rate>=c.minRate);
  }

  /**
   * 예약의 가격 상태. 추적 꺼짐(track:false)·관측 없음이면 null(UI는 '첫 확인 대기'로 표시).
   * SAVING_AVAILABLE(의미 있는 절약 — 가장 눈에 띄어야 함) > GOOD_PRICE(관측 최저 수준, 유지 권장) > WATCHING.
   * @param {any} b 예약 @param {PriceObs[]} obs 시간순 관측 기록 @param {{today?:string,krwRate?:number,cfg?:PriceCfg}=} opts
   * @returns {{state:string,current:number,saving:number,rate:number,fee:number}|null}
   */
  function bookingPriceStatus(b,obs,opts){
    if(!b || b.track===false || !obs || !obs.length) return null;
    const o=opts||{}, c=o.cfg||PRICE_CFG;
    const current=+obs[obs.length-1].price;
    if(!isFinite(current)||current<=0) return null;
    const sv=calcSaving(b,current,o.today);
    let state='WATCHING';
    if(savingWorth(sv,o.krwRate,c)) state='SAVING_AVAILABLE';
    else{
      let min=Infinity;
      for(const x of obs){ const p=+x.price; if(isFinite(p)&&p>0&&p<min) min=p; }
      if(obs.length>=c.goodMinObs && current<=min*(1+c.goodMargin) && current<+b.price) state='GOOD_PRICE';
    }
    return {state, current, saving:sv.saving, rate:sv.rate, fee:sv.fee};
  }

  /**
   * 여행 단위 요약(₩ 환산). saving은 '현재 절약 가능 금액' — 실제 절약(재예약 완료)과 구분해 부른다.
   * @param {any[]} bookings @param {Record<string,PriceObs[]>} obsById 예약 id → 관측 기록
   * @param {{today?:string,krwRateOf?:(cur?:string)=>number,cfg?:PriceCfg}=} opts krwRateOf로 환율 주입(순수 유지)
   * @returns {{booked:number,saving:number,count:number,byType:Record<string,number>}}
   */
  function tripSavingSummary(bookings,obsById,opts){
    const o=opts||{}, rateOf=o.krwRateOf||(()=>1);
    /** @type {{booked:number,saving:number,count:number,byType:Record<string,number>}} */
    const out={booked:0,saving:0,count:0,byType:{hotel:0,car:0,flight:0}};
    for(const b of bookings||[]){
      if(!b) continue;
      const rate=+(rateOf(b.cur)||1);
      out.booked+=Math.round((+b.price||0)*rate);
      const st=bookingPriceStatus(b,(obsById&&obsById[b.id])||[],{today:o.today,krwRate:rate,cfg:o.cfg});
      if(st&&st.state==='SAVING_AVAILABLE'){
        const krw=Math.round(st.saving*rate);
        out.saving+=krw; out.count++;
        if(out.byType[b.type]!=null) out.byType[b.type]+=krw;
      }
    }
    return out;
  }

  /**
   * 모의 시세 — (예약 id, 판매처, 날짜) 해시로 결정되는 가격. 같은 날 재조회는 같은 값(실서비스의
   * 일 단위 시세 근사), 날이 바뀌면 예약가의 0.85~1.10배 사이에서 움직인다. 실제 Provider 연동 전
   * 전체 플로우(등록→추적→절약 발견) 검증용이며, UI는 모의 시세임을 명시한다.
   * @param {string} id @param {string} provider @param {string} dayIso @param {number} base 예약가 @returns {number}
   */
  function mockDailyPrice(id,provider,dayIso,base){
    const key=`${id}|${provider}|${dayIso}`;
    let h=5381;
    for(let i=0;i<key.length;i++) h=((h*33)^key.charCodeAt(i))>>>0;   // djb2-xor
    const f=0.85+(h%1000)/1000*0.25;                                  // 0.85 ~ 1.10
    const raw=(+base||0)*f;
    const unit= raw>=100000?1000 : raw>=1000?100 : 1;                 // 실제 요금표처럼 끝자리 정리
    return Math.max(unit, Math.round(raw/unit)*unit);
  }

  const API={PRICE_CFG,cancelFeeNow,calcSaving,savingWorth,bookingPriceStatus,tripSavingSummary,mockDailyPrice};
  if(typeof module!=='undefined'&&module.exports) module.exports=API;   // Node (테스트)
  else /** @type {any} */(root).TC_PRICE=API;                           // 브라우저 전역 (sync/routing과 동일 패턴)
})(typeof window!=='undefined'?window:globalThis);
