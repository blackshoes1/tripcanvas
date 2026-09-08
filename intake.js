// Trip Canvas — 유입 계층 (순수 로직: DOM·네트워크·현재시각 접근 없음)
//
// "여행 정보를 넣기 위해 앱을 얼마나 덜 조작하게 되었는가"가 이 파일의 존재 이유다.
// 밖에서 들어오는 것(공유·붙여넣기·사진·메모)을 받아 → 무엇인지 판단하고 → 예약/장소/기록 후보로
// 눕히고 → 중복과 소속 여행을 짚어 준다. **저장은 하지 않는다** — 사용자가 확인한 것만 저장된다.
//
// 순서를 지킨다: 구조화된 메타데이터 → 알려진 제공자 패턴 → 규칙 파서 → (그다음에야) AI → 수동 입력.
// AI가 첫 번째 수단이 아니고, AI 결과도 사실로 단정하지 않는다 — 항상 confidence와 함께 미리보기를 거친다.
// @ts-check
(function(root){
  'use strict';
  const LIB = (typeof module!=='undefined' && module.exports) ? require('./lib.js') : /** @type {any} */(root);

  /** @typedef {'BOOKING'|'PLACE'|'TRANSPORT'|'NOTE'|'UNKNOWN'} ShareKind */
  /** @typedef {'HOTEL'|'FLIGHT'|'TRAIN'|'CAR'|'RESTAURANT'|'TOUR'|'OTHER'} CandidateType */
  /** @typedef {{sourceType?:string,url?:string,text?:string,title?:string,receivedAt?:string,locale?:string,timeZone?:string}} SharedInput */
  /** @typedef {{lat:number,lng:number}} LatLng */

  const INTAKE_CFG = Object.freeze({
    autoFillConfidence: 0.9,    // 이 위면 대부분 자동으로 채워도 된다
    reviewConfidence: 0.6,      // 이 아래면 수동 입력을 권한다
    duplicateDays: 2,           // 날짜가 이만큼 안에서 겹치면 같은 예약일 수 있다
    tripPadDays: 1              // 여행 앞뒤 하루까지는 그 여행의 예약으로 본다(도착 전날 호텔 등)
  });

  // ── 1. 무엇이 들어왔는가 ─────────────────────────────────────────
  //
  // 도메인·패턴으로 먼저 판단한다. 모든 공유가 예약이라고 가정하지 않는다.
  const BOOKING_HOSTS = Object.freeze([
    'booking.com','agoda.com','expedia.','hotels.com','airbnb.','marriott.','hilton.','accor',
    'ihg.com','hyatt.','trip.com','yanolja.com','goodchoice.kr','interpark.com','hotelscombined.',
    'opentable.','catchtable.co.kr','tabelog.com','klook.com','getyourguide.','viator.','kkday.'
  ]);
  const TRANSPORT_HOSTS = Object.freeze([
    'koreanair.com','flyasiana.com','airbusan.com','jejuair.net','tway.com','skyscanner.','kayak.',
    'letskorail.com','korail.com','srail.co.kr','raileurope.','renfe.','trenitalia.','sncf',
    'hertz.','avis.','sixt.','rentalcars.com','discovercars.com','europcar.'
  ]);
  const PLACE_HOSTS = Object.freeze([
    'maps.apple.com','google.com/maps','goo.gl/maps','maps.app.goo.gl','map.kakao.com','place.map.kakao.com',
    'map.naver.com','naver.me','tripadvisor.'
  ]);

  /** @param {string=} url @returns {string} */
  function hostOf(url){
    const raw=String(url||'').trim();
    if(!raw) return '';
    const m=/^https?:\/\/([^/?#]+)([^?#]*)/i.exec(raw);
    return m? (m[1]+m[2]).toLowerCase() : '';
  }
  /** @param {string} haystack @param {readonly string[]} needles @returns {boolean} */
  function hasAny(haystack, needles){ return needles.some(n=>haystack.indexOf(n)>=0); }

  const RE = Object.freeze({
    confirmation: /(?:예약\s*(?:번호|확인번호)|확인\s*번호|confirmation(?:\s*(?:number|code|#))?|booking\s*(?:reference|number|id)|reservation\s*(?:number|code)|PNR)\s*[:#]?\s*([A-Z0-9][A-Z0-9-]{3,19})/i,
    flightNo: /\b([A-Z]{2}|[A-Z]\d|\d[A-Z])\s?(\d{2,4})\b(?!\s*(?:원|won|km|m\b))/,
    checkIn: /(?:체크\s*인|check[-\s]?in)/i,
    checkOut: /(?:체크\s*아웃|check[-\s]?out)/i,
    train: /(?:KTX|SRT|무궁화|새마을|신칸센|shinkansen|열차|기차|railway|renfe|eurostar|tgv)/i,
    car: /(?:렌터카|rent(?:al)?\s*car|픽업\s*장소|pick[-\s]?up\s*location|반납)/i,
    restaurant: /(?:예약\s*(?:석|시간)|reservation\s*for|table\s*for|다이닝|dinner\s*reservation)/i,
    tour: /(?:투어|tour|티켓|ticket|입장권|admission|guided)/i,
    hotel: /(?:호텔|hotel|리조트|resort|숙소|스테이|guesthouse|hostel|ryokan|1박|nights?\b)/i,
    coords: /([-+]?\d{1,2}\.\d{3,}),\s*([-+]?\d{1,3}\.\d{3,})/
  });

  /**
   * 들어온 것이 무엇인지. 확신이 없으면 UNKNOWN으로 두고 버리지 않는다 —
   * 나중에 "메모로 저장할까요?"로 이어진다.
   * @param {SharedInput} input
   * @returns {{kind:ShareKind, confidence:number, reasons:string[]}}
   */
  function classifyShare(input){
    const i=input||{};
    const host=hostOf(i.url);
    const text=String(i.text||'')+' '+String(i.title||'');
    /** @type {string[]} */ const reasons=[];
    if(!host && !text.trim()) return {kind:'UNKNOWN', confidence:0, reasons:['내용이 비어 있습니다']};

    if(host && hasAny(host, TRANSPORT_HOSTS)){ reasons.push('교통 예약 사이트 주소입니다'); return {kind:'TRANSPORT', confidence:0.9, reasons}; }
    if(host && hasAny(host, BOOKING_HOSTS)){ reasons.push('예약 사이트 주소입니다'); return {kind:'BOOKING', confidence:0.9, reasons}; }
    if(host && hasAny(host, PLACE_HOSTS)){ reasons.push('지도 링크입니다'); return {kind:'PLACE', confidence:0.85, reasons}; }

    const hasConfirmation=RE.confirmation.test(text);
    const looksTransport=RE.flightNo.test(text)||RE.train.test(text);
    if(hasConfirmation && looksTransport){ reasons.push('예약번호와 편명이 함께 있습니다'); return {kind:'TRANSPORT', confidence:0.8, reasons}; }
    if(hasConfirmation){ reasons.push('예약번호로 보이는 값이 있습니다'); return {kind:'BOOKING', confidence:0.75, reasons}; }
    if(looksTransport){ reasons.push('편명·열차 표현이 있습니다'); return {kind:'TRANSPORT', confidence:0.6, reasons}; }
    if(RE.checkIn.test(text) && RE.checkOut.test(text)){ reasons.push('체크인·체크아웃이 함께 있습니다'); return {kind:'BOOKING', confidence:0.7, reasons}; }
    if(RE.coords.test(String(i.url||'')+' '+text)){ reasons.push('좌표가 들어 있습니다'); return {kind:'PLACE', confidence:0.7, reasons}; }
    if(text.trim()){ reasons.push('예약으로 볼 만한 단서가 없습니다'); return {kind:'NOTE', confidence:0.5, reasons}; }
    return {kind:'UNKNOWN', confidence:0.2, reasons:['무엇인지 판단하지 못했습니다']};
  }

  // ── 2. 정규화 (날짜·통화·금액) ───────────────────────────────────
  /** @type {Record<string,number>} */
  const MONTHS = {jan:1,feb:2,mar:3,apr:4,may:5,jun:6,jul:7,aug:8,sep:9,oct:10,nov:11,dec:12};
  /** @type {Record<string,string>} */
  const CUR_SYMBOL = {'₩':'KRW','원':'KRW','$':'USD','€':'EUR','£':'GBP','¥':'JPY','元':'CNY'};
  const CUR_CODES = Object.freeze(['KRW','USD','EUR','JPY','CNY','GBP','AUD','CAD','CHF','HKD','SGD','THB','TWD','VND']);

  /** @param {number} y @param {number} m @param {number} d @returns {string|null} */
  function isoOf(y,m,d){
    if(!(y>=1900&&y<=2999&&m>=1&&m<=12&&d>=1&&d<=31)) return null;
    const probe=new Date(Date.UTC(y,m-1,d));
    if(probe.getUTCMonth()!==m-1||probe.getUTCDate()!==d) return null;   // 2월 30일 같은 값 거르기
    return `${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
  }

  /**
   * 날짜 한 개. **모호하면 추측하지 않는다** — 10/03이 3월 10일인지 10월 3일인지 알 수 없으면
   * ambiguous=true로 알리고 미리보기에서 확인받는다(§61·§63).
   * @param {string} raw @param {{locale?:string, year?:number}=} opts
   * @returns {{iso:string|null, ambiguous:boolean, alternative:string|null}}
   */
  function normalizeDate(raw, opts){
    const s=String(raw||'').trim();
    const o=opts||{};
    if(!s) return {iso:null, ambiguous:false, alternative:null};

    let m=/(\d{4})[-./](\d{1,2})[-./](\d{1,2})/.exec(s);           // 2026-10-30 (ISO — 모호하지 않다)
    if(m) return {iso:isoOf(+m[1],+m[2],+m[3]), ambiguous:false, alternative:null};

    m=/(\d{1,2})\s*[월]\s*(\d{1,2})\s*[일]/.exec(s);               // 10월 30일
    if(m){ const y=o.year||new Date().getUTCFullYear(); return {iso:isoOf(y,+m[1],+m[2]), ambiguous:false, alternative:null}; }

    m=/(\d{1,2})\s*([A-Za-z]{3,})\.?\s*(\d{4})/.exec(s);            // 30 Oct 2026
    if(m){ const mo=MONTHS[m[2].slice(0,3).toLowerCase()]; if(mo) return {iso:isoOf(+m[3],mo,+m[1]), ambiguous:false, alternative:null}; }

    m=/([A-Za-z]{3,})\.?\s*(\d{1,2}),?\s*(\d{4})/.exec(s);          // Oct 30, 2026
    if(m){ const mo=MONTHS[m[1].slice(0,3).toLowerCase()]; if(mo) return {iso:isoOf(+m[3],mo,+m[2]), ambiguous:false, alternative:null}; }

    m=/(\d{1,2})[/.](\d{1,2})[/.](\d{4})/.exec(s);                  // 10/30/2026 또는 30/10/2026
    if(m){
      const a=+m[1], b=+m[2], y=+m[3];
      const mdy=isoOf(y,a,b), dmy=isoOf(y,b,a);
      if(mdy && !dmy) return {iso:mdy, ambiguous:false, alternative:null};
      if(dmy && !mdy) return {iso:dmy, ambiguous:false, alternative:null};
      if(!mdy && !dmy) return {iso:null, ambiguous:false, alternative:null};
      // 둘 다 말이 되면 지역 관습으로 고르되 '모호했다'고 반드시 남긴다.
      const locale=String(o.locale||'').toLowerCase();
      const preferMDY = locale.indexOf('en-us')>=0 || locale==='us';
      return {iso: preferMDY? mdy : dmy, ambiguous:true, alternative: preferMDY? dmy : mdy};
    }
    return {iso:null, ambiguous:false, alternative:null};
  }

  /**
   * 통화. 기호만 보고 단정하지 않는다 — $는 USD·AUD·CAD·SGD 전부 가능하다(§62).
   * @param {string} raw @param {{hint?:string}=} opts
   * @returns {{code:string|null, ambiguous:boolean}}
   */
  function normalizeCurrency(raw, opts){
    const s=String(raw||'').toUpperCase();
    for(const code of CUR_CODES) if(new RegExp('\\b'+code+'\\b').test(s)) return {code, ambiguous:false};
    const src=String(raw||'');
    for(const sym of Object.keys(CUR_SYMBOL)){
      if(src.indexOf(sym)>=0){
        const code=CUR_SYMBOL[sym];
        // 자국 기호가 확실한 것(₩·원·€·£)은 단정해도 되지만 $·¥는 나라가 갈린다.
        const ambiguous = (sym==='$'||sym==='¥');
        const hint=String((opts&&opts.hint)||'').toUpperCase();
        if(ambiguous && CUR_CODES.indexOf(hint)>=0) return {code:hint, ambiguous:false};
        return {code, ambiguous};
      }
    }
    return {code:null, ambiguous:false};
  }

  /** 금액 하나. 천 단위 구분·소수점을 함께 본다. @param {string} raw @returns {number|null} */
  function normalizeAmount(raw){
    const s=String(raw||'');
    const m=/([\d]{1,3}(?:[,\s]\d{3})+(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?)/.exec(s.replace(/[^\d.,\s]/g,' '));
    if(!m) return null;
    const n=+m[1].replace(/[,\s]/g,'');
    return isFinite(n)&&n>0? n : null;
  }

  // ── 3. 제공자 어댑터 ─────────────────────────────────────────────
  //
  // 핵심 파서를 제공자별 코드로 오염시키지 않는다(§52). 어댑터는 '힌트'만 준다 —
  // 실패해도 generic 파서가 그대로 돌아간다(§53).
  const PROVIDER_ADAPTERS = Object.freeze([
    Object.freeze({id:'booking.com', hosts:['booking.com'], type:'HOTEL', name:'Booking.com'}),
    Object.freeze({id:'agoda', hosts:['agoda.com'], type:'HOTEL', name:'Agoda'}),
    Object.freeze({id:'airbnb', hosts:['airbnb.'], type:'HOTEL', name:'Airbnb'}),
    Object.freeze({id:'yanolja', hosts:['yanolja.com'], type:'HOTEL', name:'야놀자'}),
    Object.freeze({id:'koreanair', hosts:['koreanair.com'], type:'FLIGHT', name:'대한항공'}),
    Object.freeze({id:'asiana', hosts:['flyasiana.com'], type:'FLIGHT', name:'아시아나항공'}),
    Object.freeze({id:'korail', hosts:['letskorail.com','korail.com'], type:'TRAIN', name:'코레일'}),
    Object.freeze({id:'srt', hosts:['srail.co.kr'], type:'TRAIN', name:'SRT'}),
    Object.freeze({id:'renfe', hosts:['renfe.'], type:'TRAIN', name:'Renfe'}),
    Object.freeze({id:'hertz', hosts:['hertz.'], type:'CAR', name:'Hertz'}),
    Object.freeze({id:'sixt', hosts:['sixt.'], type:'CAR', name:'Sixt'}),
    Object.freeze({id:'discovercars', hosts:['discovercars.com'], type:'CAR', name:'DiscoverCars'}),
    Object.freeze({id:'catchtable', hosts:['catchtable.co.kr'], type:'RESTAURANT', name:'캐치테이블'}),
    Object.freeze({id:'opentable', hosts:['opentable.'], type:'RESTAURANT', name:'OpenTable'}),
    Object.freeze({id:'klook', hosts:['klook.com'], type:'TOUR', name:'Klook'}),
    Object.freeze({id:'getyourguide', hosts:['getyourguide.'], type:'TOUR', name:'GetYourGuide'})
  ]);

  /** @param {string=} url @returns {any} */
  function providerFor(url){
    const host=hostOf(url);
    if(!host) return null;
    return PROVIDER_ADAPTERS.filter(a=>hasAny(host, a.hosts))[0]||null;
  }

  /** 본문에서 종류를 짚는다. 어댑터가 이미 알려줬으면 그것이 이긴다. @param {string} text @returns {CandidateType} */
  function typeFromText(text){
    const s=String(text||'');
    if(RE.flightNo.test(s) && /(?:항공|flight|airline|탑승|boarding)/i.test(s)) return 'FLIGHT';
    if(RE.train.test(s)) return 'TRAIN';
    if(RE.car.test(s)) return 'CAR';
    if(RE.hotel.test(s)||(RE.checkIn.test(s)&&RE.checkOut.test(s))) return 'HOTEL';
    if(RE.restaurant.test(s)) return 'RESTAURANT';
    if(RE.tour.test(s)) return 'TOUR';
    return 'OTHER';
  }

  /** 종류별로 반드시 있어야 하는 것 — 없으면 missingFields로 알려 사용자가 채우게 한다. */
  const REQUIRED = Object.freeze({
    HOTEL:['title','startAt','endAt'], FLIGHT:['title','startAt'], TRAIN:['title','startAt'],
    CAR:['title','startAt','endAt'], RESTAURANT:['title','startAt'], TOUR:['title','startAt'], OTHER:['title']
  });

  /**
   * 공유 입력 → 예약 후보. **저장하지 않는다.** confidence와 missingFields를 함께 돌려줘
   * 미리보기가 "무엇을 못 읽었는지"를 그대로 보여줄 수 있게 한다(§16·§49).
   * @param {SharedInput} input @param {{locale?:string, year?:number, currencyHint?:string}=} opts
   * @returns {any}
   */
  function parseBookingCandidate(input, opts){
    const i=input||{}, o=opts||{};
    const text=[i.title,i.text].filter(Boolean).join('\n');
    const adapter=providerFor(i.url);
    /** @type {string[]} */ const reasons=[];
    /** @type {string[]} */ const ambiguities=[];

    const type=/** @type {CandidateType} */(adapter? adapter.type : typeFromText(text));
    if(adapter) reasons.push(adapter.name+' 예약으로 보입니다');

    // 제목: 공유 제목이 가장 믿을 만하다. 사이트 이름 꼬리는 떼어낸다.
    let title=String(i.title||'').replace(/\s*[|·—-]\s*(?:booking\.com|agoda|airbnb|expedia|hotels\.com)\s*$/i,'').trim();
    if(!title){
      const line=String(i.text||'').split(/\r?\n/).map(x=>x.trim()).filter(Boolean)[0]||'';
      title=line.slice(0,120);
    }

    const conf=RE.confirmation.exec(text);
    const confirmationNumber=conf? conf[1].toUpperCase() : null;
    if(confirmationNumber) reasons.push('예약번호를 찾았습니다');

    // 날짜: 체크인/체크아웃 라벨이 있으면 그 줄에서, 없으면 본문에서 앞의 두 개.
    const dates=collectDates(text, {locale:o.locale, year:o.year});
    dates.ambiguous.forEach(a=>ambiguities.push(a));
    const startAt=dates.start, endAt=dates.end;
    if(startAt) reasons.push('날짜를 찾았습니다');

    const currency=normalizeCurrency(text, {hint:o.currencyHint});
    if(currency.ambiguous) ambiguities.push('통화 기호만으로는 어느 나라 통화인지 확실하지 않습니다');
    const amountText=/(?:총액|합계|total|amount|가격|price)[^\n]{0,40}/i.exec(text);
    const amount=normalizeAmount(amountText? amountText[0] : (currency.code? text : ''));

    /** @type {any} */
    const candidate={
      type, title:title||null,
      provider: adapter? adapter.name : (hostOf(i.url).split('/')[0]||null),
      providerId: adapter? adapter.id : null,
      confirmationNumber, startAt, endAt,
      location: locationFrom(text),
      amount, currency: currency.code,
      sourceUrl: i.url||null,
      sourceTitle: i.title||null,
      receivedAt: i.receivedAt||null,
      reasons, ambiguities,
      missingFields: [],
      confidence: 0
    };
    candidate.missingFields=(REQUIRED[type]||REQUIRED.OTHER).filter(f=>!candidate[f]);
    candidate.confidence=scoreCandidate(candidate, !!adapter);
    return candidate;
  }

  /** @param {string} text @param {any} opts @returns {{start:string|null,end:string|null,ambiguous:string[]}} */
  function collectDates(text, opts){
    const lines=String(text||'').split(/\r?\n/);
    /** @type {string[]} */ const ambiguous=[];
    /** @type {(string|null)} */ let start=null, end=null;
    for(const line of lines){
      const parsed=normalizeDate(line, opts);
      if(!parsed.iso) continue;
      if(parsed.ambiguous) ambiguous.push(`"${line.trim().slice(0,40)}"의 날짜가 ${parsed.iso}인지 ${parsed.alternative}인지 확실하지 않습니다`);
      if(RE.checkIn.test(line) && !start){ start=parsed.iso; continue; }
      if(RE.checkOut.test(line) && !end){ end=parsed.iso; continue; }
      if(!start) start=parsed.iso;
      else if(!end && parsed.iso>=start) end=parsed.iso;
    }
    return {start, end, ambiguous};
  }

  /** @param {string} text @returns {string|null} */
  function locationFrom(text){
    const m=/(?:주소|위치|장소|address|location)\s*[:：]\s*([^\n]{4,120})/i.exec(String(text||''));
    return m? m[1].trim() : null;
  }

  /**
   * 얼마나 믿을 만한가. ≥0.9 대부분 자동 · 0.6~0.9 확인 필요 · <0.6 수동 입력 권장(§49).
   * @param {any} c @param {boolean} known 알려진 제공자인가
   * @returns {number}
   */
  function scoreCandidate(c, known){
    let score=known? 0.45 : 0.2;
    if(c.title) score+=0.15;
    if(c.confirmationNumber) score+=0.2;
    if(c.startAt) score+=0.15;
    if(c.endAt) score+=0.05;
    if(c.amount && c.currency) score+=0.05;
    if(c.ambiguities.length) score-=0.15;           // 모호한 것이 있으면 자동으로 넘기지 않는다
    if(c.missingFields.length) score-=0.1*Math.min(2, c.missingFields.length);
    return Math.max(0, Math.min(1, Math.round(score*100)/100));
  }

  /** 후보를 어떻게 다룰지 — 문구가 아니라 판단만 돌려준다. @param {any} c @param {any=} opts @returns {'AUTO'|'REVIEW'|'MANUAL'} */
  function candidateDisposition(c, opts){
    const cfg=(opts&&opts.cfg)||INTAKE_CFG;
    if(!c) return 'MANUAL';
    if(c.confidence>=cfg.autoFillConfidence && !c.missingFields.length && !c.ambiguities.length) return 'AUTO';
    if(c.confidence>=cfg.reviewConfidence) return 'REVIEW';
    // 무엇인지는 아는데 값이 덜 채워진 경우(알려진 예약처 + 이름)는 MANUAL이 아니다.
    // 여기서 직접 입력으로 보내면 사용자가 이름부터 다시 치게 되어 공유의 의미가 사라진다 —
    // 빈 칸 두어 개를 채우는 미리보기가 훨씬 적은 조작이다.
    if(c.providerId && c.title) return 'REVIEW';
    return 'MANUAL';
  }

  // ── 4. 중복 · 여행 매칭 ──────────────────────────────────────────
  /** @param {any} a @param {any} b @returns {boolean} */
  function sameCode(a,b){
    const x=String(a||'').replace(/[^A-Z0-9]/gi,'').toUpperCase();
    const y=String(b||'').replace(/[^A-Z0-9]/gi,'').toUpperCase();
    return !!x && x===y;
  }
  /** @param {string} a @param {string} b @returns {number} 0~1 */
  function titleSimilarity(a,b){
    const norm=(/**@type{string}*/s)=>String(s||'').toLowerCase().replace(/[^a-z0-9가-힣]/g,'');
    const x=norm(a), y=norm(b);
    if(!x||!y) return 0;
    if(x===y) return 1;
    if(x.indexOf(y)>=0||y.indexOf(x)>=0) return 0.8;
    const grams=(/**@type{string}*/s)=>{ const out=new Set(); for(let i=0;i<s.length-1;i++) out.add(s.slice(i,i+2)); return out; };
    const gx=grams(x), gy=grams(y);
    let hit=0; gx.forEach(g=>{ if(gy.has(g)) hit++; });
    return gx.size? Math.round((hit/Math.max(gx.size,gy.size))*100)/100 : 0;
  }
  /** @param {string|null} a @param {string|null} b @returns {number} 일수 차이 (모르면 999) */
  function dayGap(a,b){
    if(!a||!b) return 999;
    const x=Date.parse(a+'T00:00:00Z'), y=Date.parse(b+'T00:00:00Z');
    if(!isFinite(x)||!isFinite(y)) return 999;
    return Math.abs(Math.round((x-y)/86400000));
  }

  /**
   * 같은 예약을 여러 번 공유했을 수 있다(§19). 확신이 있을 때만 '중복'이라 말한다 —
   * 아니면 사용자가 정상적인 두 번째 예약을 못 넣게 된다.
   * @param {any} candidate @param {any[]} bookings @param {any=} opts
   * @returns {{booking:any, score:number, reasons:string[]}|null}
   */
  function findDuplicateBooking(candidate, bookings, opts){
    const cfg=(opts&&opts.cfg)||INTAKE_CFG;
    if(!candidate) return null;
    /** @type {any} */ let best=null;
    (bookings||[]).forEach((b)=>{
      if(!b) return;
      /** @type {string[]} */ const reasons=[];
      let score=0;
      if(candidate.confirmationNumber && sameCode(candidate.confirmationNumber, b.confirmation||b.confirmationNumber)){
        score+=0.7; reasons.push('예약번호가 같습니다');
      }
      if(candidate.sourceUrl && b.url && String(candidate.sourceUrl)===String(b.url)){ score+=0.5; reasons.push('같은 예약 페이지입니다'); }
      const sim=titleSimilarity(candidate.title, b.title);
      if(sim>=0.7){ score+=0.25; reasons.push('이름이 거의 같습니다'); }
      if(candidate.startAt && b.start && dayGap(candidate.startAt, b.start)<=cfg.duplicateDays){ score+=0.25; reasons.push('날짜가 겹칩니다'); }
      if(score>=0.7 && (!best||score>best.score)) best={booking:b, score:Math.min(1,Math.round(score*100)/100), reasons};
    });
    return best;
  }

  /**
   * 어느 여행의 예약인가(§20). **단정하지 않는다** — 후보와 이유를 점수순으로 돌려주고 고르게 한다.
   * @param {any} candidate @param {any[]} trips @param {any=} opts
   * @returns {{tripId:string, name:string, score:number, reasons:string[]}[]}
   */
  function matchTripForBooking(candidate, trips, opts){
    const cfg=(opts&&opts.cfg)||INTAKE_CFG;
    /** @type {any[]} */ const out=[];
    (trips||[]).forEach((t)=>{
      if(!t||!t.id) return;
      /** @type {string[]} */ const reasons=[];
      let score=0;
      const days=(t.days||[]).length;
      if(t.start && candidate.startAt && days){
        const first=t.start;
        const lastMs=Date.parse(first+'T00:00:00Z')+(days-1)*86400000;
        const last=new Date(lastMs).toISOString().slice(0,10);
        const startMs=Date.parse(candidate.startAt+'T00:00:00Z');
        const padded=cfg.tripPadDays*86400000;
        if(isFinite(startMs) && startMs>=Date.parse(first+'T00:00:00Z')-padded && startMs<=lastMs+padded){
          score+=0.6; reasons.push(`여행 기간(${first} ~ ${last})과 겹칩니다`);
        }
      }
      const cities=new Set();
      (t.days||[]).forEach((/**@type{any}*/d)=>((d&&d.spots)||[]).forEach((/**@type{any}*/s)=>{ if(s&&s.city) cities.add(String(s.city)); }));
      const haystack=[candidate.location, candidate.title].filter(Boolean).join(' ');
      for(const city of cities){ if(haystack && haystack.indexOf(city)>=0){ score+=0.25; reasons.push(`${city} 일정이 있습니다`); break; } }
      if(candidate.providerId && (t.bookings||[]).some((/**@type{any}*/b)=>b&&b.provider&&titleSimilarity(b.provider, candidate.provider)>=0.8)){
        score+=0.1; reasons.push('같은 예약처를 쓴 적이 있습니다');
      }
      if(score>0) out.push({tripId:t.id, name:String(t.name||'여행'), score:Math.min(1,Math.round(score*100)/100), reasons});
    });
    out.sort((a,b)=> (b.score-a.score) || (a.tripId<b.tripId? -1 : (a.tripId>b.tripId? 1 : 0)));
    return out;
  }

  /**
   * 후보 → 저장 가능한 예약. 여기서도 확정하지 않는다 — 호출측이 사용자 확인 뒤에 부른다.
   * 모르는 값은 넣지 않는다(빈 문자열로 채워 '입력된 것처럼' 보이게 하지 않는다).
   * @param {any} candidate @param {string} id @returns {any}
   */
  function candidateToBooking(candidate, id){
    const c=candidate||{};
    /** @type {Record<string,string>} */
    const map={HOTEL:'hotel', FLIGHT:'flight', TRAIN:'flight', CAR:'car', RESTAURANT:'hotel', TOUR:'hotel', OTHER:'hotel'};
    /** @type {any} */
    const b={ id, type: map[String(c.type)]||'hotel', title: c.title||'예약', track:true };
    if(c.provider) b.provider=c.provider;
    if(c.sourceUrl) b.url=c.sourceUrl;
    if(c.startAt) b.start=c.startAt;
    if(c.endAt) b.end=c.endAt;
    if(c.amount) b.price=Math.round(c.amount);
    if(c.currency) b.cur=c.currency;
    if(c.confirmationNumber) b.confirmation=c.confirmationNumber;
    // 열차는 예약 스키마에 별도 종류가 없어 flight로 두되, 무엇이었는지는 남긴다.
    if(c.type==='TRAIN'||c.type==='RESTAURANT'||c.type==='TOUR') b.importedType=c.type;
    return b;
  }

  // ── 5. 공유 대기열 ───────────────────────────────────────────────
  const SHARE_STATES = Object.freeze(['PENDING','PROCESSING','PARSED','NEEDS_REVIEW','FAILED','SAVED','DISCARDED']);

  /**
   * 같은 공유가 여러 번 처리되지 않게 하는 키(§57). 내용이 같으면 키가 같다.
   * @param {SharedInput} input @returns {string}
   */
  function shareIdempotencyKey(input){
    const i=input||{};
    const raw=[String(i.url||'').trim(), String(i.title||'').trim(), String(i.text||'').trim().slice(0,500)].join('|');
    let h=5381;
    for(let k=0;k<raw.length;k++){ h=((h*33)^raw.charCodeAt(k))>>>0; }
    return 'sh'+h.toString(36);
  }

  /**
   * 대기열 상태 전이(§56). 네트워크가 없어 파싱을 못 해도 원본은 남는다 — 나중에 다시 시도한다.
   * @param {string} state @param {string} event
   * @returns {string} 다음 상태 (알 수 없는 전이는 현재 상태 유지)
   */
  function shareQueueNext(state, event){
    const from=SHARE_STATES.indexOf(state)>=0? state : 'PENDING';
    /** @type {any} */
    const table={
      PENDING:{start:'PROCESSING', discard:'DISCARDED'},
      PROCESSING:{parsed:'PARSED', review:'NEEDS_REVIEW', fail:'FAILED', discard:'DISCARDED'},
      PARSED:{save:'SAVED', review:'NEEDS_REVIEW', discard:'DISCARDED'},
      NEEDS_REVIEW:{save:'SAVED', discard:'DISCARDED', retry:'PROCESSING'},
      FAILED:{retry:'PROCESSING', discard:'DISCARDED'},
      SAVED:{}, DISCARDED:{}
    };
    return (table[from]&&table[from][event])||from;
  }

  // ── 6. 여행 기록 (Trip Memory) ───────────────────────────────────
  //
  // SNS가 아니다. 일정과 실제 흔적을 이어 붙이는 것이 전부다.
  // 사용자에게 "어디였죠?"를 다시 묻지 않기 위해 시각과 위치로 자동 연결한다(§27).
  const MEMORY_TYPES = Object.freeze(['PHOTO','NOTE','VISIT','MOMENT']);
  const MEMORY_CFG = Object.freeze({ windowMin: 15, nearKm: 0.5 });

  /**
   * 기록 하나를 어느 일정에 붙일지. 시각이 먼저고, 시각으로 못 고르면 위치로 고른다.
   * 아무것도 못 고르면 그 날에만 붙인다 — 억지로 고르지 않는다.
   * @param {{atMinutes:number, location?:LatLng|null}} capture
   * @param {any[]} activities TripItem 또는 ActivitySummary (startMinutes/endMinutes/location)
   * @param {any=} opts
   * @returns {{activityId:string|null, reason:string}}
   */
  function associateMemory(capture, activities, opts){
    const cfg=(opts&&opts.cfg)||MEMORY_CFG;
    const at=Math.round(Number(capture&&capture.atMinutes));
    const list=(activities||[]).filter(Boolean);
    if(!list.length||!isFinite(at)) return {activityId:null, reason:'연결할 일정이 없어 날짜에만 남깁니다'};

    const startOf=(/**@type{any}*/a)=>Number(a.startMinutes!=null? a.startMinutes : a.depart);
    const endOf=(/**@type{any}*/a)=>Number(a.endMinutes!=null? a.endMinutes : a.end);
    const idOf=(/**@type{any}*/a)=>String(a.id||'');

    const inWindow=list.filter(a=>{
      const s=startOf(a), e=endOf(a);
      return isFinite(s)&&isFinite(e)&&at>=s-cfg.windowMin&&at<=e+cfg.windowMin;
    });
    if(inWindow.length===1) return {activityId:idOf(inWindow[0]), reason:'그 시간에 있던 일정입니다'};

    const here=capture&&capture.location;
    if(inWindow.length>1 && here){
      let best=null, bestKm=Infinity;
      inWindow.forEach(a=>{
        if(!a.location) return;
        const km=LIB.haversine({lat:+here.lat,lng:+here.lng},{lat:+a.location.lat,lng:+a.location.lng});
        if(km<bestKm){ bestKm=km; best=a; }
      });
      if(best && bestKm<=cfg.nearKm) return {activityId:idOf(best), reason:'그 시간에 가장 가까이 있던 일정입니다'};
      if(best) return {activityId:idOf(best), reason:'그 시간대의 일정 중 가장 가까운 곳입니다'};
    }
    if(inWindow.length>1) return {activityId:idOf(inWindow[0]), reason:'그 시간대의 첫 일정입니다'};

    if(here){
      let best=null, bestKm=Infinity;
      list.forEach(a=>{
        if(!a.location) return;
        const km=LIB.haversine({lat:+here.lat,lng:+here.lng},{lat:+a.location.lat,lng:+a.location.lng});
        if(km<bestKm){ bestKm=km; best=a; }
      });
      if(best && bestKm<=cfg.nearKm) return {activityId:idOf(best), reason:'바로 근처의 일정입니다'};
    }
    return {activityId:null, reason:'어느 일정인지 확실하지 않아 날짜에만 남깁니다'};
  }

  /**
   * 기록을 일정에 붙여 시간순으로. 일정표와 실제 흔적이 나란히 보이게 한다(§30).
   * @param {any[]} events @param {any[]} activities
   * @returns {{activityId:string|null, title:string, atMinutes:number, photos:number, notes:number, events:any[]}[]}
   */
  function memoryTimeline(events, activities){
    /** @type {any} */ const byId=Object.create(null);
    (activities||[]).forEach((a)=>{ if(a&&a.id) byId[a.id]=a; });
    /** @type {any} */ const groups=Object.create(null);
    /** @type {any[]} */ const order=[];
    (events||[]).forEach((e)=>{
      if(!e) return;
      const key=e.activityId||'__day__';
      if(!groups[key]){
        const a=byId[key];
        groups[key]={
          activityId:e.activityId||null,
          title:a? String(a.name||a.title||'') : '일정과 연결되지 않음',
          atMinutes:a? Number(a.startMinutes!=null? a.startMinutes : a.depart) : Number(e.atMinutes||0),
          photos:0, notes:0, events:[]
        };
        order.push(key);
      }
      const g=groups[key];
      g.events.push(e);
      if(e.type==='PHOTO') g.photos+=(Array.isArray(e.assetRefs)? e.assetRefs.length : 1);
      else if(e.type==='NOTE') g.notes+=1;
    });
    return order.map(k=>groups[k]).sort((a,b)=>(a.atMinutes-b.atMinutes)||(a.title<b.title?-1:1));
  }

  /**
   * 계획과 실제를 나란히(§31). 이번 단계에서는 비교 데이터만 만든다 — 판단하지 않는다.
   * @param {any[]} activities @param {any[]} events
   * @returns {{planned:string[], visited:string[], missed:string[], unplanned:number}}
   */
  function plannedVsActual(activities, events){
    const planned=(activities||[]).filter(Boolean).map(a=>String(a.name||a.title||''));
    /** @type {any} */ const touched=Object.create(null);
    let unplanned=0;
    (events||[]).forEach((e)=>{ if(!e) return; if(e.activityId) touched[e.activityId]=1; else unplanned++; });
    /** @type {string[]} */ const visited=[];
    /** @type {string[]} */ const missed=[];
    (activities||[]).filter(Boolean).forEach((a)=>{
      const name=String(a.name||a.title||'');
      const done=touched[String(a.id||'')] || a.status==='COMPLETED';
      (done? visited : missed).push(name);
    });
    return {planned, visited, missed, unplanned};
  }


  // ── 6. 붙여넣은 일정 글 → 초안 ──────────────────────────────────
  //
  // 사람이 쓴 글(또는 AI가 준 일정)을 읽는다. 우리 형식(`장소 | 도시 | 설명 @09:00`)도 그대로 읽힌다.
  //
  // ⚠️ **확정하지 않는다.** 이 줄이 장소인지 활동인지는 `kind` **힌트**일 뿐이고, 무엇을 담을지는
  // 미리보기에서 사람이 고른다(§밖에서 들어온 것은 확인 없이 저장하지 않는다).
  // ⚠️ 이름을 고쳐 쓰지 않는다 — 분류할 때만 낱말을 걷어내고, 이름은 원문 그대로 남긴다.
  //   ("가루이자와 프린스 쇼핑 플라자"에서 '쇼핑'을 지우면 지도가 못 찾는다)

  /** @typedef {'PLACE'|'ACTIVITY'|'MOVE'|'STAY'} ItemKind */
  /** @typedef {{raw:string,name:string,city:string,desc:string,at:string|null,endAt:string|null,stayMin:number|null,url:string|null,cost:number|null,cur:string|null,opt:boolean,stay:boolean,lat:number|null,lng:number|null,kind:ItemKind,reasons:string[]}} DraftItem */
  /** @typedef {{title:string,date:string|null,drive:string,note:string,items:DraftItem[]}} DraftDay */

  /** 숙소에 관한 말 */
  const STAY_WORDS = ['체크인','체크아웃','체크 인','체크 아웃','숙소','호텔','료칸','민박','게스트하우스','짐','복귀','휴식'];
  /** 이동에 관한 말 */
  const MOVE_WORDS = ['이동','출발','도착','귀국','입국','경유','환승','왕복','픽업','반납','탑승','귀가'];
  /** 행동에 관한 말 — 장소 이름에도 흔히 붙는다(산책·관람) */
  const ACT_WORDS = ['아침','조식','점심','중식','저녁','석식','야식','디저트','브런치','간식','식사','먹기','자유시간','자유 시간','쇼핑','구경','관람','산책','투어','체험','카페','티타임','사진','촬영','주변','근처','일대','지역'];
  /** 시간대를 가리키는 말 — 시각으로 못박지 않는다(내가 정하지 않은 시각을 계획에 넣지 않는다) */
  const PART_WORDS = ['새벽','아침','오전','점심','정오','오후','저녁','밤','종일','하루종일','늦은','이른','식후','이후','전','후'];

  /** 끼니·구분을 가리키는 라벨 — 뒤에 오는 것이 진짜 이름이다 */
  const LABEL_DASH = ['아침','조식','점심','중식','저녁','석식','브런치','간식','디저트','야식','숙소','호텔','카페','티타임'];
  /** 괄호 안이 '이름'이 아니라 '설명'임을 알려주는 말 */
  const PAREN_META = /\d+\s*(?:분|시간|일|박|원|엔|달러|위안|바트|km|m|명|인)|도보|버스|지하철|차로|택시|입장료|무료|유료|예약|휴무|정기휴일|추천|소요|왕복|편도|맛집|명소|유명|인기|현지|근처|주변/;

  /**
   * 마크다운 꾸밈과 앞머리 이모지를 지운다. **AI 글이 우리 형식과 갈리는 가장 큰 이유다** —
   * `**09:00**`는 시각으로 읽히지 않고 `🍱 점심`은 이름에 그림이 남는다.
   * ⚠️ 밑줄(`_`)은 건드리지 않는다 — 이름·주소에 그대로 쓰인다.
   * @param {string} s @returns {string}
   */
  function stripDecor(s){
    let out=String(s||'').replace(/\*\*|__|`/g,'').replace(/\*/g,'');
    out=out.replace(/^[\p{Extended_Pictographic}\uFE0F\u200D\s]+/u,'');
    return out.replace(/[\p{Extended_Pictographic}\uFE0F\u200D\s]+$/u,'').replace(/\s{2,}/g,' ').trim();
  }

  /** @param {number} h @param {number} mi @returns {string} */
  function hhmm(h, mi){ return `${String(h).padStart(2,'0')}:${String(mi).padStart(2,'0')}`; }

  /**
   * `오전 9시`·`저녁 7시 30분`처럼 사람이 쓰는 시각. AI 글에는 `09:00`보다 이 꼴이 흔하다.
   * ⚠️ **오전/오후 표시가 없는 `7시`는 그대로 7시로 읽는다** — 저녁 7시일 수 있으므로
   * 지어내지 않고 `ambiguous`로 알린다(§모호하면 추측하지 않는다).
   * @param {string} s @returns {{at:string,len:number,ambiguous:boolean}|null}
   */
  function koTime(s){
    const m=/^(오전|오후|아침|점심|저녁|밤|새벽)?\s*(\d{1,2})\s*시(?:\s*(\d{1,2})\s*분)?(?:\s*경)?/.exec(String(s||''));
    if(!m) return null;
    let h=+m[2]; const mi=m[3]? +m[3] : 0;
    if(h>24||mi>59) return null;
    const part=m[1]||'';
    const pm=(part==='오후'||part==='저녁'||part==='밤');
    const am=(part==='오전'||part==='아침'||part==='새벽');
    if(pm && h<12) h+=12;
    if(am && h===12) h=0;
    if(h>23) return null;
    return {at:hhmm(h,mi), len:m[0].length, ambiguous:!part && h<12};
  }

  /**
   * 앞에 붙은 라벨과 뒤에 붙은 설명을 이름에서 떼어낸다.
   * `점심: 카와카미안` → 이름은 `카와카미안` · `하루니레 테라스 — 산책하기 좋아요` → 설명은 뒤쪽.
   * ⚠️ 괄호는 **안이 설명일 때만** 뗀다 — `이시노쿄카이 (돌의 교회)`의 괄호는 다른 이름이라 남긴다.
   * @param {string} text @returns {{name:string,desc:string,stay:boolean}}
   */
  function splitNameDesc(text){
    let s=String(text||'').trim(); const bits=[]; let stay=false;
    // `X: Y` — X가 장소로 안 보이면 그건 라벨이고 이름은 Y다
    let m=/^([^:：]{1,12})\s*[:：]\s*(\S.*)$/.exec(s);
    if(m){
      const left=classifyItem(stripDecor(m[1]));
      if(left.kind!=='PLACE'){ bits.push(m[1].trim()); if(left.kind==='STAY') stay=true; s=m[2].trim(); }
    }
    // `점심 - 트라토리아` — 줄표는 애매해서 아는 라벨일 때만
    m=/^([^-–—]{1,10})\s+[-–—]\s+(\S.*)$/.exec(s);
    if(m && LABEL_DASH.indexOf(m[1].trim())>=0){ bits.push(m[1].trim()); s=m[2].trim(); }
    // `이름 — 설명` — 긴 줄표는 설명을 붙이는 자리다
    m=/^(\S.*?)\s+[—–]\s+(\S.*)$/.exec(s);
    if(m){ s=m[1].trim(); bits.push(m[2].trim()); }
    // `이름 (도보 20분)` — 안이 설명일 때만
    m=/^(\S.*?)\s*\(([^()]*)\)\s*$/.exec(s);
    if(m && PAREN_META.test(m[2])){ s=m[1].trim(); bits.push(m[2].trim()); }
    const tidy=(/**@type{string}*/v)=>v.replace(/^[\s,·]+|[\s,·]+$/g,'').trim();
    return {name:tidy(s), desc:tidy(bits.filter(Boolean).join(' · ')), stay};
  }

  /** @param {string} line @returns {string[]|null} 표의 한 줄이면 칸들, 아니면 null */
  function tableCells(line){
    const s=String(line||'').trim();
    if(!/^\|.*\|$/.test(s) || s.indexOf('|',1)<0) return null;
    return s.slice(1,-1).split('|').map((c)=>c.trim());
  }
  /** @param {string[]} cells @returns {boolean} `|---|---|` 구분선인가 */
  function isRule(cells){ return cells.length>0 && cells.every((c)=>/^:?-{2,}:?$/.test(c)); }

  const TH_TIME=/시간|시각|time/i, TH_CITY=/도시|지역|city|area/i;
  const TH_NOTE=/메모|비고|설명|참고|note|remark/i, TH_COST=/비용|요금|가격|예산|cost|price/i;

  /**
   * 마크다운 표를 우리 불릿으로 편다. **표를 모르면 그 날이 통째로 사라진다** —
   * AI가 하루를 표로 정리하는 일이 흔하다(2026-09-08에 하루치 4곳을 전부 잃었다).
   * 구분선(`|---|`)이 있는 표만 편다 — 그냥 세로줄이 든 문장을 표로 오해하지 않기 위해서다.
   * @param {string[]} lines @returns {string[]}
   */
  function expandTables(lines){
    /** @type {string[]} */ const out=[];
    for(let i=0;i<lines.length;i++){
      const head=tableCells(lines[i]);
      const rule=head? tableCells(lines[i+1]||'') : null;
      if(!head || !rule || !isRule(rule)){ out.push(lines[i]); continue; }
      const cols=head.map((h)=>stripDecor(h));
      let iTime=-1, iCity=-1, iNote=-1, iCost=-1;
      cols.forEach((h,ix)=>{
        if(iTime<0 && TH_TIME.test(h)) iTime=ix;
        else if(iCity<0 && TH_CITY.test(h)) iCity=ix;
        else if(iNote<0 && TH_NOTE.test(h)) iNote=ix;
        else if(iCost<0 && TH_COST.test(h)) iCost=ix;
      });
      let iName=cols.findIndex((h,ix)=>ix!==iTime&&ix!==iCity&&ix!==iNote&&ix!==iCost&&/장소|명소|일정|내용|코스|목적지|activity|place|spot/i.test(h));
      if(iName<0) iName=cols.findIndex((_h,ix)=>ix!==iTime&&ix!==iCity&&ix!==iNote&&ix!==iCost);
      if(iName<0){ out.push(lines[i]); continue; }
      i++;                                              // 구분선을 건너뛴다
      for(let j=i+1;j<lines.length;j++){
        const row=tableCells(lines[j]);
        if(!row){ i=j-1; break; }
        i=j;
        const cell=(/**@type{number}*/ix)=>(ix>=0 && ix<row.length)? stripDecor(row[ix]) : '';
        const name=cell(iName);
        if(!name) continue;
        const note=[cell(iNote), cell(iCost)].filter(Boolean).join(' ');
        let bullet=`- ${name} | ${cell(iCity)} | ${note}`;
        const t=cell(iTime);
        const clock=/^\d{1,2}\s*:\s*\d{2}$/.test(t)? t.replace(/\s/g,'') : (koTime(t)||{}).at;
        if(clock) bullet+=` @${clock}`;
        else if(t) bullet+=(note? ' ':'')+t;
        out.push(bullet);
      }
    }
    return out;
  }

  /** @param {string} line @returns {{title:string}|null} 일자 머리글이면 제목, 아니면 null */
  function dayHeader(line){
    let s=String(line||'').trim(), heading=false;
    const h=/^#{1,6}\s*(.*)$/.exec(s);
    if(h){ s=stripDecor(h[1]); heading=true; }
    let m=/^\[?\s*day\s*(\d+)\s*\]?\s*[-–—:.)|｜]?\s*(.*)$/i.exec(s);
    if(m) return {title:String(m[2]||'').trim()};
    m=/^(\d+)\s*일\s*차\s*[-–—:.)|｜]?\s*(.*)$/.exec(s);
    if(m) return {title:String(m[2]||'').trim()};
    return heading? {title:s} : null;
  }

  /** @param {string} line @returns {string|null} 불릿이면 본문, 아니면 null */
  function bulletBody(line){
    const m=/^\s*(?:[-•*·▪◦‣]|\d{1,2}[.)]|[①-⑩])\s+(.+)$/.exec(String(line||''));
    return m? m[1].trim() : null;
  }

  /** @param {string} t @returns {string|null} */
  function hm(t){
    const m=/^(\d{1,2})\s*:\s*(\d{2})$/.exec(String(t||'').trim());
    if(!m) return null;
    const h=+m[1], mi=+m[2];
    return (h>=0&&h<=23&&mi>=0&&mi<=59)? `${String(h).padStart(2,'0')}:${String(mi).padStart(2,'0')}` : null;
  }

  /**
   * 이름 앞에 붙은 시간 표시를 떼어낸다. `08:00~09:00｜아침 식사` → `아침 식사`
   * ⚠️ '오후'·'저녁' 같은 말은 시각으로 바꾸지 않는다 — 구분자가 뒤따를 때만 떼어낸다.
   * @param {string} body @returns {{rest:string,at:string|null,endAt:string|null,ambiguous?:boolean}}
   */
  function stripTimePrefix(body){
    let s=String(body||'');
    let m=/^(\d{1,2}\s*:\s*\d{2})\s*[~\-–—]\s*(\d{1,2}\s*:\s*\d{2})\s*[|:：]?\s*/.exec(s);
    if(m){ const a=hm(m[1]), b=hm(m[2]); if(a) return {rest:s.slice(m[0].length).trim(), at:a, endAt:b}; }
    m=/^(\d{1,2}\s*:\s*\d{2})\s*(?:이후|부터|~|-|–|—)\s*[|:：]?\s*/.exec(s);
    if(m){ const a=hm(m[1]); if(a) return {rest:s.slice(m[0].length).trim(), at:a, endAt:null}; }
    m=/^(\d{1,2}\s*:\s*\d{2})\s*[|:：]\s*/.exec(s);
    if(m){ const a=hm(m[1]); if(a) return {rest:s.slice(m[0].length).trim(), at:a, endAt:null}; }
    m=/^(\d{1,2}\s*:\s*\d{2})\s+/.exec(s);
    if(m){ const a=hm(m[1]); if(a) return {rest:s.slice(m[0].length).trim(), at:a, endAt:null}; }
    // '오전 9시'·'저녁 7시 30분' — AI 글에는 이 꼴이 더 흔하다
    const ko=koTime(s);
    if(ko){
      let rest=s.slice(ko.len);
      const r2=/^\s*[~\-–—]\s*/.exec(rest);
      let end=null;
      if(r2){
        const ko2=koTime(rest.slice(r2[0].length));
        if(ko2){ end=ko2.at; rest=rest.slice(r2[0].length+ko2.len); }
      }
      rest=rest.replace(/^\s*[|:：·,]\s*/,'').trim();
      if(rest) return {rest, at:ko.at, endAt:end, ambiguous:ko.ambiguous};
    }
    // '오전~오후|이동' — 시간대 낱말만으로 이루어진 접두사는 버리고 순서만 남긴다
    m=/^([^|]{1,14})\|\s*/.exec(s);
    if(m){
      const words=m[1].split(/[~\-–—·,\s]+/).filter(Boolean);
      if(words.length && words.every((w)=>PART_WORDS.indexOf(w)>=0)) return {rest:s.slice(m[0].length).trim(), at:null, endAt:null};
    }
    return {rest:s.trim(), at:null, endAt:null};
  }

  /**
   * 마크다운 링크와 맨 URL을 떼어낸다. 링크 문구는 남기고 문법만 지운다.
   * ⚠️ http(s)만 받는다 — `javascript:` 같은 스킴을 문서에 들이지 않는다(§safeUrl과 같은 기준).
   * @param {string} text @returns {{text:string,url:string|null}}
   */
  function pullLinks(text){
    /** @type {string|null} */ let url=null;
    let out=String(text||'').replace(/\[([^\]]*)\]\(\s*([^)\s]+)\s*\)/g, (_all, label, href)=>{
      if(!url && /^https?:\/\//i.test(String(href))) url=String(href);
      return String(label||'');
    });
    if(!url){
      const m=/https?:\/\/\S+/i.exec(out);
      if(m){ url=m[0]; out=out.replace(m[0],''); }
    }
    return {text: out.replace(/\s{2,}/g,' ').trim(), url};
  }

  /**
   * 이 줄이 장소인가 — **힌트일 뿐이다.** 아는 낱말을 다 걷어낸 뒤 남는 말이 있으면 장소로 본다.
   * 그래서 "쿠모바 연못 산책"은 장소('쿠모바 연못'이 남는다)이고 "아침 식사"는 아니다.
   * @param {string} name @returns {{kind:ItemKind,reasons:string[]}}
   */
  function classifyItem(name){
    const text=String(name||'').trim();
    if(!text) return {kind:'ACTIVITY', reasons:['이름이 없어요']};
    if(/→|->|~>/.test(text)) return {kind:'MOVE', reasons:['옮겨 가는 과정으로 보여요']};
    let residue=text;
    /** @type {string[]} */ const hitStay=[];
    /** @type {string[]} */ const hitMove=[];
    /** @type {string[]} */ const hitAct=[];
    const strike=(/**@type{string[]}*/words, /**@type{string[]}*/hits)=>{
      for(const w of words) if(residue.indexOf(w)>=0){ hits.push(w); residue=residue.split(w).join(' '); }
    };
    strike(STAY_WORDS, hitStay); strike(MOVE_WORDS, hitMove); strike(ACT_WORDS, hitAct); strike(PART_WORDS, hitAct);
    residue=residue.replace(/[\s·,.\-–—|()[\]/]+/g,'').trim();
    if(residue) return {kind:'PLACE', reasons:['장소 이름으로 보여요']};
    const quoted=(/**@type{string[]}*/h)=>h.slice(0,2).map((w)=>`'${w}'`).join('·');
    if(hitStay.length) return {kind:'STAY', reasons:[`${quoted(hitStay)} 같은 말뿐이라 숙소 관련으로 보여요`]};
    if(hitMove.length) return {kind:'MOVE', reasons:[`${quoted(hitMove)} 같은 말뿐이라 이동으로 보여요`]};
    if(hitAct.length) return {kind:'ACTIVITY', reasons:[`${quoted(hitAct)} 같은 말뿐이라 장소가 아니라 행동으로 보여요`]};
    return {kind:'PLACE', reasons:['장소 이름으로 보여요']};
  }

  /** @param {string} title @param {number} year @returns {string|null} */
  function dayDateOf(title, year){
    const d=normalizeDate(title, {year});
    if(d.iso) return d.iso;
    const m=/(\d{1,2})\s*\/\s*(\d{1,2})(?!\s*[/\d])/.exec(String(title||''));
    return m? isoOf(year, +m[1], +m[2]) : null;
  }

  /**
   * 붙여넣은 일정 글 → 초안. **저장하지 않는다** — 미리보기에 쓸 후보를 만들 뿐이다.
   * @param {string} text
   * @param {{year?:number}=} opts 연도가 없는 글(`7월 21일`)에 쓸 연도. 없으면 올해
   * @returns {{name:string,start:string|null,startAmbiguous:boolean,days:DraftDay[]}}
   */
  function parseItinerary(text, opts){
    const o=opts||{};
    const year=o.year || new Date().getUTCFullYear();
    const raw=String(text||'');
    const hasYear=/(19|20)\d{2}\s*[-./년]/.test(raw);
    /** @type {{name:string,start:string|null,startAmbiguous:boolean,days:DraftDay[]}} */
    const out={name:'', start:null, startAmbiguous:false, days:[]};
    /** @type {DraftDay|null} */ let day=null;
    /** @type {DraftItem|null} */ let item=null;   // 바로 앞 불릿 — 다음 줄 설명이 여기 붙는다
    let lastCity='';

    const newDay=(/**@type{string}*/title)=>{
      day={title:String(title||'').trim(), date:null, drive:'', note:'', items:[]};
      day.date=dayDateOf(day.title, year);
      out.days.push(day); item=null;
      return day;
    };
    /** 지금 쓰고 있는 일자 — 머리글이 없는 글도 하루짜리로 읽힌다 */
    const curDay=()=> day || newDay('');
    const addNote=(/**@type{string}*/line)=>{ const d=curDay(); d.note=(d.note? d.note+'\n':'')+line; };

    expandTables(raw.split(/\r?\n/)).forEach((rawLine)=>{
      const line=rawLine.trim();
      if(!line){ item=null; return; }     // 빈 줄이 설명을 닫는다 — 그 뒤 문단은 그 날의 메모다
      let m;
      if(m=/^여행\s*이름\s*[:：]\s*(.+)$/.exec(line)){ out.name=m[1].trim(); return; }
      if(m=/^시작일\s*[:：]\s*(.+)$/.exec(line)){ out.start=dayDateOf(m[1], year)||null; return; }
      const head=dayHeader(stripDecor(line));
      if(head){ newDay(head.title); return; }
      const d=curDay();
      if(m=/^이동\s*[:：]\s*(.+)$/.exec(line)){ d.drive=m[1].trim(); item=null; return; }
      if(m=/^메모\s*[:：]\s*(.+)$/.exec(line)){ addNote(m[1].trim()); item=null; return; }

      const body=bulletBody(line);
      if(body==null){
        // 불릿 바로 다음 줄은 그 항목의 설명, 그 밖은 일자 메모
        if(item){
          const pulled=pullLinks(line);
          if(pulled.text) item.desc=(item.desc? item.desc+' ':'')+pulled.text;
          if(pulled.url && !item.url) item.url=pulled.url;
        } else addNote(line);
        return;
      }

      // ── 불릿 한 줄 ──
      let text2=body.split('｜').join('|');          // 전각 세로줄도 같은 구분자다
      const pulled=pullLinks(text2); text2=pulled.text;
      text2=stripDecor(text2);                       // `**09:00**`·`🍱 `를 걷어야 그 뒤가 읽힌다
      let opt=false, stay=false;
      // ⚠️ 시각보다 먼저 찾는다 — `15:00 (선택) …`처럼 뒤에 오기도 한다
      if(/\(선택\)/.test(text2)){ opt=true; text2=text2.replace(/\(선택\)\s*/g,''); }
      if(/\(숙소\)/.test(text2)){ stay=true; text2=text2.replace(/\(숙소\)\s*/g,''); }
      const timed=stripTimePrefix(text2); text2=timed.rest;
      let at=timed.at;
      const atM=/@\s*(\d{1,2}:\d{2})/.exec(text2);
      if(atM){ const v=hm(atM[1]); if(v) at=v; text2=text2.replace(atM[0],''); }   // 우리 형식의 @는 앞선 표시를 이긴다
      const money=LIB.parseMoney? LIB.parseMoney(text2) : null;
      if(money){
        text2=text2.replace(money.raw,'');
        // `(수타 소바, 약 )`처럼 금액을 뺀 자리에 남는 찌꺼기를 걷는다
        text2=text2.replace(/[,·]?\s*(?:약|대략|정도)?\s*([)）])/g,'$1').replace(/[(（]\s*[)）]/g,'');
      }
      text2=text2.replace(/\s{2,}/g,' ').trim();

      const p=text2.split('|').map((x)=>x.trim());
      if(p[1]) lastCity=p[1];
      let lat=null, lng=null;
      if(p[3]){ const c=/(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)/.exec(p[3]); if(c){ lat=+c[1]; lng=+c[2]; } }
      const split=splitNameDesc(p[0]||'');
      const name=split.name;
      if(split.stay) stay=true;
      const verdict=classifyItem(name);
      if(timed.ambiguous && timed.at) verdict.reasons=verdict.reasons.concat([`'${+timed.at.slice(0,2)}시'가 오전인지 오후인지 안 적혀 있어 그대로 읽었어요`]);
      const stayMin=(at&&timed.endAt)? Math.max(0, LIB.parseHM(timed.endAt)-LIB.parseHM(at)) : null;
      /** @type {DraftItem} */
      const next={
        raw:body, name, city:p[1]||lastCity||'', desc:[p[2]||'', split.desc].filter(Boolean).join(' · '),
        at, endAt:timed.endAt, stayMin, url:pulled.url,
        cost:money? money.cost : null, cur:(money&&money.cur!=='KRW')? money.cur : null,
        opt, stay, lat, lng,
        kind:verdict.kind, reasons:verdict.reasons
      };
      d.items.push(next); item=next;
    });

    // 맨 앞의 제목·인사말은 일자가 아니다. AI 글은 거의 늘 이걸로 시작한다 —
    // 그냥 두면 장소가 하나도 없는 1일차가 생겨 일정이 하루씩 밀린다.
    if(out.days.length>1 && !out.days[0].items.length && !out.days[0].date){
      const head=/** @type {DraftDay} */(out.days.shift());
      if(head.title && !out.name) out.name=head.title;
      if(head.note) out.days[0].note=(head.note+'\n'+out.days[0].note).trim();
    }
    const dated=out.days.filter((d)=>!!d.date)[0];
    if(!out.start && dated) out.start=dated.date;
    out.startAmbiguous=!!out.start && !hasYear;
    return out;
  }

  const API={INTAKE_CFG, MEMORY_CFG, SHARE_STATES, MEMORY_TYPES, PROVIDER_ADAPTERS,
    classifyShare, normalizeDate, normalizeCurrency, normalizeAmount, providerFor,
    parseBookingCandidate, candidateDisposition, findDuplicateBooking, matchTripForBooking,
    candidateToBooking, shareIdempotencyKey, shareQueueNext, titleSimilarity,
    associateMemory, memoryTimeline, plannedVsActual,
    parseItinerary, classifyItem, stripTimePrefix, pullLinks, dayHeader,
    stripDecor, koTime, splitNameDesc, expandTables};
  if(typeof module!=='undefined' && module.exports) module.exports=API;   // Node (테스트)
  else /** @type {any} */(root).TC_INTAKE=API;                            // 브라우저 전역
})(typeof window!=='undefined'?window:globalThis);
