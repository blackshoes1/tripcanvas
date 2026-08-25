(function(root){
  'use strict';
  // 예약 가격 추적 — 순수 계산 모듈 (네트워크·DOM 무관, 단위 테스트 + tsc 대상).
  // 목표는 최저가 나열이 아니라 "지금 예약을 유지할까, 갈아탈까"의 판단 재료:
  // 실질 절약액 = 예약가 − 현재가 − (지금 취소하면 내는) 취소 수수료.
  // 판정 기준은 하드코딩하지 않고 PRICE_CFG로 분리 — 모든 함수가 cfg 재정의를 받는다.

  /** @typedef {{minSaving:number,minRate:number,goodMargin:number,goodMinObs:number,staleHours:number,cooldownMin:number,errBackoffMin:number,staleNoticeHours:number,maxObs:number}} PriceCfg */
  /** @typedef {{price:number,at?:string,cur?:string,provider?:string,seller?:string,quality?:string,verified?:boolean,url?:string}} PriceObs */
  /** @typedef {{seller:string,price:number,total?:number,cur?:string,roomName?:string,refundable?:boolean,breakfast?:boolean,link?:string,verified?:boolean,verifiedBy?:string,quality?:string}} HotelOffer */

  /** @type {PriceCfg} */
  const PRICE_CFG=Object.freeze({
    minSaving:50000,      // ₩ 환산 절약액이 이 값을 '넘으면' 의미 있는 기회 (동일 금액은 미충족)
    minRate:0.07,         // 또는 예약가 대비 7% 이상 하락
    goodMargin:0.03,      // 현재가가 관측 최저가의 +3% 이내면 '좋은 가격'
    goodMinObs:3,         // '좋은 가격' 판정에 필요한 최소 관측 수 (데이터가 적으면 판단 보류)
    staleHours:24,        // 이보다 최근 성공 조회가 있으면 자동 재조회 생략 (기본 하루 1회 — API 비용)
    cooldownMin:15,       // 수동 '지금 확인' 최소 간격(분) — 그 안에는 저장값 반환
    errBackoffMin:60,     // 실패 후 자동 재시도 대기(분) — 소스 미연결 상태에서 매번 두드리지 않게
    staleNoticeHours:48,  // 마지막 성공 조회가 이보다 오래되면 '가격 정보가 오래됨' 안내
    maxObs:60             // 예약당 보관하는 관측 수 상한
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

  // ── Offer Matching Engine — 가격 비교 전 '같은 상품인가'를 먼저 판단한다 ──

  /** 객실명 비교용 정규화 (소문자·공백/기호 제거) @param {any} s @returns {string} */
  function _normRoom(s){ return String(s==null?'':s).toLowerCase().replace(/[^a-z0-9가-힣]/g,''); }

  /** 오퍼 실효가 — 총액(totalPrice) 우선, 없으면 1박가 @param {any} o @returns {number} */
  function offerPrice(o){
    const t=+(o&&o.total), p=+(o&&o.price);
    return isFinite(t)&&t>0? t : (isFinite(p)&&p>0? p:0);
  }

  /**
   * 상품 동등성 등급. 검색 자체가 같은 호텔·날짜·인원으로 던져지므로 여기선 '조건'을 본다.
   * - UNMATCHED: 비교 불가(통화 불일치·가격 없음)
   * - EXACT: 객실명·환불·조식이 양쪽 모두 '알려져 있고' 전부 일치
   * - EQUIVALENT: 예약에 선언된 조건(환불·조식·객실명)이 오퍼에서 모두 '일치 확인'됨 (선언 안 한 조건은 묻지 않음, 최소 1개 선언)
   * - SIMILAR: 같은 호텔이지만 조건이 다르거나(선언 조건 불일치) 확인 불가 — 확정 절약으로 쓰지 않는다
   * @param {any} b 예약 @param {any} o 오퍼 @returns {'EXACT'|'EQUIVALENT'|'SIMILAR'|'UNMATCHED'}
   */
  function matchQuality(b,o){
    if(!b||!o||offerPrice(o)<=0) return 'UNMATCHED';
    if(((o.cur)||'KRW')!==((b.cur)||'KRW')) return 'UNMATCHED';
    const known=(/**@type {any}*/v)=>v!==undefined&&v!==null;
    const bRoom=String(b.roomName||'').trim(), oRoom=String(o.roomName||'').trim();
    const roomEq= (bRoom&&oRoom)? _normRoom(bRoom)===_normRoom(oRoom) : null;     // null=비교 불가
    const refEq= (known(b.refundable)&&known(o.refundable))? !!b.refundable===!!o.refundable : null;
    const bfEq= (known(b.breakfast)&&known(o.breakfast))? !!b.breakfast===!!o.breakfast : null;
    if(refEq===false||bfEq===false||roomEq===false) return 'SIMILAR';             // 선언 조건이 '다름'으로 확인
    if(roomEq===true&&refEq===true&&bfEq===true) return 'EXACT';
    const declared=[[known(b.refundable),refEq],[known(b.breakfast),bfEq],[!!bRoom,roomEq]];
    if(declared.every(([d,eq])=>!d||eq===true) && declared.some(([d])=>d)) return 'EQUIVALENT';
    return 'SIMILAR';
  }

  /** §20 신뢰 사다리 — 검증EXACT(0) > 검증EQUIV(1) > 메타EXACT(2) > 메타EQUIV(3) > SIMILAR(4) @param {string} q @param {boolean} verified @returns {number} */
  function offerRank(q,verified){
    if(q==='EXACT') return verified?0:2;
    if(q==='EQUIVALENT') return verified?1:3;
    return q==='SIMILAR'?4:9;
  }

  /**
   * Saving Decision Engine — 확정과 잠재를 절대 섞지 않는다.
   * 확정(EXACT/EQUIVALENT): 실질 절약 = 예약가 − 실효가 − 취소수수료. 사다리 상위 등급 우선, 같은 등급은 저가.
   * 잠재(SIMILAR): '최대 차액'만 — 수수료 미반영, 단정 금지("조건 확인 필요"). 확정보다 더 쌀 때만 의미.
   * @param {any} b @param {any[]} offers (quality 미계산 항목은 여기서 계산)
   * @param {{today?:string}=} opts
   * @returns {{confirmed:{offer:any,saving:number,rate:number}|null, potential:{offer:any,delta:number}|null, fee:number}}
   */
  function decideSaving(b,offers,opts){
    const today=opts&&opts.today, fee=cancelFeeNow(b,today), price=+((b&&b.price)||0);
    /** @type {any} */ let best=null; let bestRank=9,bestEff=Infinity;
    /** @type {any} */ let pot=null; let potEff=Infinity;
    for(const o of offers||[]){
      if(!o) continue;
      const q=o.quality||matchQuality(b,o), eff=offerPrice(o);
      if(q==='UNMATCHED'||eff<=0) continue;
      const r=offerRank(q,!!o.verified);
      if(r<=3){ if(r<bestRank||(r===bestRank&&eff<bestEff)){ best=o; bestRank=r; bestEff=eff; } }
      else if(r===4&&eff<potEff){ pot=o; potEff=eff; }
    }
    const saving=best? price-bestEff-fee : 0;
    const confirmed= best&&saving>0? {offer:best, saving, rate:price>0?saving/price:0} : null;
    const potential= pot&&price-potEff>0&&(!best||potEff<bestEff)? {offer:pot, delta:price-potEff} : null;
    return {confirmed, potential, fee};
  }

  /**
   * 추적 상태 — 카드 배지·상세 헤더·요약이 공유하는 단일 판정.
   * SAVING_AVAILABLE(확정 절약, threshold 충족) > CHEAPER_UNVERIFIED(잠재 — 조건 확인 필요) >
   * GOOD_PRICE(관측 최저 수준) > WATCHING. 성공 조회가 한 번도 없고 실패만 있으면 ERROR.
   * @param {any} b @param {{obs?:PriceObs[],offers?:any[],at?:string|null,err?:any}|null|undefined} rec
   * @param {{today?:string,krwRate?:number,cfg?:PriceCfg}=} opts
   * @returns {{state:string,confirmed:any,potential:any,fee:number,at:string|null,err:any}|null}
   */
  function hotelTrackState(b,rec,opts){
    if(!b||b.track===false) return null;
    const r=rec||{}, o=opts||{}, c=o.cfg||PRICE_CFG;
    const d=decideSaving(b,r.offers||[],{today:o.today});
    let state='WATCHING';
    if(d.confirmed && savingWorth({saving:d.confirmed.saving,rate:d.confirmed.rate},o.krwRate,c)) state='SAVING_AVAILABLE';
    else if(d.potential && savingWorth({saving:d.potential.delta,rate:(+b.price>0? d.potential.delta/+b.price:0)},o.krwRate,c)) state='CHEAPER_UNVERIFIED';
    else{ const st=bookingPriceStatus(b,r.obs||[],{today:o.today,krwRate:o.krwRate,cfg:c}); if(st&&st.state==='GOOD_PRICE') state='GOOD_PRICE'; }
    if(!r.at&&r.err) state='ERROR';
    return {state, confirmed:d.confirmed, potential:d.potential, fee:d.fee, at:r.at||null, err:r.err||null};
  }

  // ── Hotel Identity Matching — 메타서치 결과가 '내 호텔'인지 점수화 ──

  /** 이름 토큰화 (관용어 제거, 전부 관용어면 원본 유지) @param {any} s @returns {string[]} */
  function _nameTokens(s){
    const all=String(s==null?'':s).toLowerCase().replace(/[^a-z0-9가-힣\s]/g,' ').split(/\s+/).filter(t=>t.length>1);
    const stop=['the','hotel','and','resort','spa','inn','suites','호텔','리조트','스파'];
    const kept=all.filter(t=>stop.indexOf(t)<0);
    return kept.length?kept:all;
  }
  /** 근사 거리(km) — 호텔 식별용 단거리라 등장방형 근사면 충분 @param {any} a @param {any} b @returns {number} */
  function _distKm(a,b){
    const dLat=(+a.lat-+b.lat)*111.32;
    const dLng=(+a.lng-+b.lng)*111.32*Math.cos(((+a.lat)+(+b.lat))/2*Math.PI/180);
    return Math.sqrt(dLat*dLat+dLng*dLng);
  }
  /**
   * 호텔 동일성 점수(0~1). placeId가 양쪽에 있으면 그 일치가 전부. 없으면 이름 유사도(0.7)
   * + 좌표 거리(0.3 — 300m 이내 만점, 3km 밖 0점). 낮은 점수는 자동 확정하지 않는다(호출측 threshold).
   * @param {{name?:string,placeId?:string,lat?:number,lng?:number}} idn 일정의 호텔
   * @param {{name?:string,placeId?:string,lat?:number,lng?:number}} prop Provider 매물
   * @returns {number}
   */
  function identityScore(idn,prop){
    if(!idn||!prop) return 0;
    if(idn.placeId&&prop.placeId) return idn.placeId===prop.placeId?1:0;
    const a=_nameTokens(idn.name), b=_nameTokens(prop.name);
    let sim=0;
    if(a.length&&b.length){ const inter=a.filter(t=>b.indexOf(t)>=0).length; sim=inter/Math.max(a.length,b.length); }
    const hasCoord=isFinite(Number(idn.lat))&&isFinite(Number(idn.lng))&&isFinite(Number(prop.lat))&&isFinite(Number(prop.lng));
    if(!hasCoord) return sim;
    const d=_distKm(idn,prop);
    const near= d<=0.3?1 : d>=3?0 : 1-(d-0.3)/2.7;
    return sim*0.7+near*0.3;
  }

  /**
   * 여행 단위 요약(₩ 환산) — 확정 절약·잠재 절약(조건 확인 필요, 최대)·실제 절약(재예약 기록 b.saved)을
   * 절대 섞지 않고 따로 합산한다.
   * @param {any[]} bookings @param {Record<string,any>} recById 예약 id → {obs,offers,at,err}
   * @param {{today?:string,krwRateOf?:(cur?:string)=>number,cfg?:PriceCfg}=} opts
   * @returns {{booked:number,confirmed:number,potential:number,actual:number,count:number}}
   */
  function tripHotelSummary(bookings,recById,opts){
    const o=opts||{}, rateOf=o.krwRateOf||(()=>1);
    const out={booked:0,confirmed:0,potential:0,actual:0,count:0};
    for(const b of bookings||[]){
      if(!b) continue;
      const rate=+(rateOf(b.cur)||1);
      out.booked+=Math.round((+b.price||0)*rate);
      out.actual+=Math.round((+((b&&b.saved)||0))*rate);
      const st=hotelTrackState(b,(recById&&recById[b.id])||null,{today:o.today,krwRate:rate,cfg:o.cfg});
      if(st&&st.state==='SAVING_AVAILABLE'&&st.confirmed){ out.confirmed+=Math.round(st.confirmed.saving*rate); out.count++; }
      // 잠재(조건 확인 필요)는 확정과 병기 — 같은 예약이 둘 다 가질 수 있다 (§21: 확정 170,000 + 잠재 190,000)
      if(st&&st.potential){
        const delta=st.potential.delta;
        if(savingWorth({saving:delta, rate:(+b.price>0? delta/+b.price:0)},rate,o.cfg)) out.potential+=Math.round(delta*rate);
      }
    }
    return out;
  }

  const API={PRICE_CFG,cancelFeeNow,calcSaving,savingWorth,bookingPriceStatus,offerPrice,matchQuality,offerRank,decideSaving,hotelTrackState,identityScore,tripHotelSummary};
  if(typeof module!=='undefined'&&module.exports) module.exports=API;   // Node (테스트)
  else /** @type {any} */(root).TC_PRICE=API;                           // 브라우저 전역 (sync/routing과 동일 패턴)
})(typeof window!=='undefined'?window:globalThis);
