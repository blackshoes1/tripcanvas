// Trip Canvas — 순수 로직 (브라우저 전역 + Node 모듈 겸용, 유닛 테스트 대상)
// @ts-check
/** @typedef {{lat:number, lng:number}} LatLng */
(function(root){
  'use strict';

  /** 로컬 날짜 → YYYY-MM-DD (타임존 밀림 방지) @param {Date} d @returns {string} */
  function toISO(d){ return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; }

  /** 직선거리(하버사인, km) @param {LatLng} a @param {LatLng} b @returns {number} */
  function haversine(a,b){
    const R=6371, toRad=(/**@type {number}*/x)=>x*Math.PI/180;
    const dLat=toRad(b.lat-a.lat), dLng=toRad(b.lng-a.lng);
    const h=Math.sin(dLat/2)**2 + Math.cos(toRad(a.lat))*Math.cos(toRad(b.lat))*Math.sin(dLng/2)**2;
    return 2*R*Math.asin(Math.sqrt(h));
  }

  /** 구간 캐시 키 (좌표 4자리) @param {LatLng} a @param {LatLng} b @returns {string} */
  function legId(a,b){ return `${(+a.lat).toFixed(4)},${(+a.lng).toFixed(4)}>${(+b.lat).toFixed(4)},${(+b.lng).toFixed(4)}`; }
  /** @param {LatLng} a @param {LatLng} b @param {string=} mode @returns {string} */
  function legKey(a,b,mode){ return legId(a,b)+'#'+(mode||'car'); }

  /** p 주변 반경 r(m) 8방위 후보점 (도로 스냅) @param {LatLng} p @param {number} r @returns {LatLng[]} */
  function ringPts(p,r){
    const dLat=r/111320, dLng=r/(111320*Math.cos(p.lat*Math.PI/180));
    /** @type {LatLng[]} */
    const out=[];
    for(let k=0;k<8;k++){ const th=k*Math.PI/4; out.push({lat:p.lat+dLat*Math.sin(th), lng:p.lng+dLng*Math.cos(th)}); }
    return out;
  }

  /** HH:MM → 분 (형식 불일치 시 09:00) @param {string=} t @returns {number} */
  function parseHM(t){ const m=/^(\d{1,2}):(\d{2})$/.exec(t||''); return m? (+m[1])*60+(+m[2]) : 9*60; }
  /** 분 → HH:MM (24h 래핑) @param {number} min @returns {string} */
  function hm(min){ min=((Math.round(min)%1440)+1440)%1440; return `${String(Math.floor(min/60)).padStart(2,'0')}:${String(min%60).padStart(2,'0')}`; }

  /** 한국 영역 여부 @param {LatLng=} p @returns {boolean} */
  function inKorea(p){ return !!p && p.lat>=33 && p.lat<=39 && p.lng>=124.5 && p.lng<=132; }

  /** 서술형 꼬리말 제거 ("감포 바다"→"감포", 괄호 제거) @param {string=} n @returns {string} */
  function simplifyName(n){
    return String(n||'').replace(/\([^)]*\)/g,'')
      .replace(/\s*(앞바다|바다|해변|해수욕장|일대|근처|주변|전경|야경|거리|풍경)\s*$/,'').trim();
  }

  // 통화 기호/접미사가 붙은 금액 하나 추출 → {cost:number,cur:'KRW'|'USD'|'JPY'|'CNY',raw:string} | null
  /** @param {string=} str */
  function parseMoney(str){
    str=String(str||''); let m;
    const num=(/**@type{string}*/s)=>+String(s).replace(/,/g,'');
    if(m=str.match(/[$＄]\s*([\d,]+)/))        return {cost:num(m[1]),cur:'USD',raw:m[0]};
    if(m=str.match(/€\s*([\d,]+)/))            return {cost:num(m[1]),cur:'EUR',raw:m[0]};
    if(m=str.match(/[¥￥]\s*([\d,]+)/))        return {cost:num(m[1]),cur:'JPY',raw:m[0]};
    if(m=str.match(/元\s*([\d,]+)/))           return {cost:num(m[1]),cur:'CNY',raw:m[0]};
    if(m=str.match(/₩\s*([\d,]+)/))           return {cost:num(m[1]),cur:'KRW',raw:m[0]};
    if(m=str.match(/([\d,]+)\s*(?:달러|불)/))   return {cost:num(m[1]),cur:'USD',raw:m[0]};
    if(m=str.match(/([\d,]+)\s*유로/))          return {cost:num(m[1]),cur:'EUR',raw:m[0]};
    if(m=str.match(/([\d,]+)\s*엔/))           return {cost:num(m[1]),cur:'JPY',raw:m[0]};
    if(m=str.match(/([\d,]+)\s*(?:위안|元)/))   return {cost:num(m[1]),cur:'CNY',raw:m[0]};
    if(m=str.match(/([\d,]+)\s*원/))           return {cost:num(m[1]),cur:'KRW',raw:m[0]};
    return null;
  }
  /** 붙여넣기 직접 형식 → 구조화 @param {string=} text @returns {{name:string,start:string,days:any[]}} */
  function parseDirect(text){
    /** @type {{name:string,start:string,days:any[]}} */
    const out={name:'',start:'',days:[]};
    /** @type {any} */
    let cur=null, lastCity='';
    String(text||'').split(/\r?\n/).forEach(raw=>{
      const line=raw.trim(); if(!line) return; let m;
      if(m=line.match(/^여행\s*이름\s*[:：]\s*(.+)$/)){ out.name=m[1].trim(); return; }
      if(m=line.match(/^시작일\s*[:：]\s*(.+)$/)){ out.start=m[1].trim(); return; }
      if(m=line.match(/^\[?\s*day\s*\d+\s*\]?\s*(.*)$/i)){ cur={title:m[1].trim(),drive:'',note:'',spots:[]}; out.days.push(cur); return; }
      if(line.startsWith('#')){ cur={title:line.slice(1).trim(),drive:'',note:'',spots:[]}; out.days.push(cur); return; }
      if(!cur){ cur={title:'',drive:'',note:'',spots:[]}; out.days.push(cur); }
      if(m=line.match(/^이동\s*[:：]\s*(.+)$/)){ cur.drive=m[1].trim(); return; }
      if(m=line.match(/^메모\s*[:：]\s*(.+)$/)){ cur.note=(cur.note?cur.note+'\n':'')+m[1].trim(); return; }
      if(m=line.match(/^[-•*·]\s*(.+)$/)){
        let body=m[1].trim(), opt=false, stay=false;
        if(/^\(선택\)/.test(body)){ opt=true; body=body.replace(/^\(선택\)\s*/,''); }
        if(/^\(숙소\)/.test(body)){ stay=true; body=body.replace(/^\(숙소\)\s*/,''); }
        // 도착 시각 @HH:MM
        let at; const atM=body.match(/@\s*(\d{1,2}:\d{2})/); if(atM){ at=atM[1]; body=body.replace(atM[0],''); }
        // 비용(통화 기호/접미사)
        const money=parseMoney(body); if(money) body=body.replace(money.raw,'');
        body=body.replace(/\s{2,}/g,' ').trim();
        const p=body.split('|').map(x=>x.trim());
        if(p[1]) lastCity=p[1];
        let lat=null,lng=null;
        if(p[3]){ const mm=p[3].match(/(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)/); if(mm){ lat=+mm[1]; lng=+mm[2]; } }
        /** @type {any} */
        const spot={name:p[0]||'',city:p[1]||lastCity||out.name||'기타',desc:p[2]||'',opt,stay,lat,lng};
        if(at) spot.at=at;
        if(money){ spot.cost=money.cost; if(money.cur!=='KRW') spot.cur=money.cur; }
        cur.spots.push(spot);
        return;
      }
      cur.note=(cur.note?cur.note+'\n':'')+line;
    });
    return out;
  }

  // 폴리라인 인코딩/디코딩 (Google 알고리즘, precision 5) — SDK 비의존, 구글 encodedPolyline과 호환
  /** @param {LatLng[]} points @returns {string} */
  function encodePolyline(points){
    const factor=1e5; let lat=0,lng=0,res='';
    const enc=(/**@type {number}*/v)=>{ v=v<0?~(v<<1):(v<<1); let s=''; while(v>=0x20){ s+=String.fromCharCode((0x20|(v&0x1f))+63); v>>>=5; } s+=String.fromCharCode(v+63); return s; };
    for(const p of points){ const la=Math.round(p.lat*factor), ln=Math.round(p.lng*factor); res+=enc(la-lat)+enc(ln-lng); lat=la; lng=ln; }
    return res;
  }
  /** @param {string=} str @returns {LatLng[]} */
  function decodePolyline(str){
    const factor=1e5; let i=0,lat=0,lng=0; /** @type {LatLng[]} */ const out=[]; str=str||'';
    while(i<str.length){
      let b,shift=0,result=0;
      do{ b=str.charCodeAt(i++)-63; result|=(b&0x1f)<<shift; shift+=5; }while(b>=0x20);
      lat+=(result&1)?~(result>>1):(result>>1);
      shift=0; result=0;
      do{ b=str.charCodeAt(i++)-63; result|=(b&0x1f)<<shift; shift+=5; }while(b>=0x20);
      lng+=(result&1)?~(result>>1):(result>>1);
      out.push({lat:lat/factor, lng:lng/factor});
    }
    return out;
  }

  // 동선 순서 최적화 — 직선거리 기준 nearest-neighbor + 2-opt.
  /** @param {LatLng[]} coords @param {{fixStart?:boolean,fixEnd?:boolean}=} opt @returns {number[]} 방문 순서 인덱스 */
  function optimizeRoute(coords, opt){
    opt=opt||{}; const n=coords.length;
    if(n<=2) return coords.map((_,i)=>i);
    const D=(/**@type {number}*/i,/**@type {number}*/j)=>haversine(coords[i],coords[j]);
    const fixStart=opt.fixStart!==false, fixEnd=!!opt.fixEnd;
    const startIdx=0, endIdx=fixEnd?n-1:-1;
    /** @type {number[]} */
    const pool=[]; for(let i=0;i<n;i++) if(i!==startIdx && i!==endIdx) pool.push(i);
    // nearest-neighbor (시작점에서 가장 가까운 순으로)
    const order=[startIdx]; let cur=startIdx;
    while(pool.length){
      let best=0,bd=Infinity;
      for(let k=0;k<pool.length;k++){ const d=D(cur,pool[k]); if(d<bd){bd=d;best=k;} }
      cur=pool.splice(best,1)[0]; order.push(cur);
    }
    if(endIdx>=0) order.push(endIdx);
    // 2-opt (고정 끝점 존중)
    const lo=fixStart?1:0, hi=fixEnd?order.length-2:order.length-1;
    let improved=true, guard=0;
    while(improved && guard++<200){
      improved=false;
      for(let i=lo;i<=hi;i++){
        for(let j=i+1;j<=hi;j++){
          const a=order[i-1], b=order[i], c=order[j], d=(j+1<order.length?order[j+1]:-1);
          const before=D(a,b)+(d>=0?D(c,d):0);
          const after=D(a,c)+(d>=0?D(b,d):0);
          if(after+1e-9<before){ let x=i,y=j; while(x<y){ const t=order[x];order[x]=order[y];order[y]=t;x++;y--; } improved=true; }
        }
      }
    }
    return order;
  }
  /** 경로 총 직선거리(km) @param {LatLng[]} coords @param {number[]=} order @returns {number} */
  function routeLength(coords, order){
    const ord=order||coords.map((_,i)=>i); let s=0;
    for(let k=1;k<ord.length;k++) s+=haversine(coords[ord[k-1]],coords[ord[k]]);
    return s;
  }

  /**
   * 특정 요일·시각에 영업 중인지 판정.
   * @param {{d:number,o:number,c:number}[]|null|undefined} periods 영업 구간(d: 요일 0=일~6=토, o/c: 자정부터 분). d=-1은 상시영업(24/7)
   * @param {number} weekday 0=일~6=토
   * @param {number} min 0~1439
   * @returns {boolean|null} 영업 true / 닫힘 false / 정보없음 null
   */
  function isOpenAt(periods, weekday, min){
    if(!periods || !periods.length) return null;
    for(const p of periods){
      if(p.d===-1) return true;                                   // 24/7
      if(p.c>p.o){ if(p.d===weekday && min>=p.o && min<p.c) return true; }   // 같은 날 구간
      else {                                                     // 자정 넘김 (예: 22:00~02:00)
        if(p.d===weekday && min>=p.o) return true;
        if(p.d===(weekday+6)%7 && min<p.c) return true;          // 전날 개장분이 오늘 새벽까지
      }
    }
    return false;
  }

  /** 좌표 유효 여부 (lat/lng 유한값) @param {any} s @returns {boolean} */
  function hasCoord(s){ return !!s && s.lat!=null && s.lng!=null && isFinite(+s.lat) && isFinite(+s.lng); }

  /** IANA 시간대 문자열 유효성. @param {any} value @returns {boolean} */
  function validTimeZone(value){
    if(typeof value!=='string'||!value||value.length>64) return false;
    try{ new Intl.DateTimeFormat('en-US',{timeZone:value}).format(0); return true; }catch(_){ return false; }
  }

  /** @param {number} ms @param {string} timeZone @returns {{year:number,month:number,day:number,hour:number,minute:number}} */
  function _zonedParts(ms,timeZone){
    const parts=new Intl.DateTimeFormat('en-CA',{timeZone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date(ms));
    /** @type {any} */ const out={};
    parts.forEach(p=>{ if(p.type!=='literal') out[p.type]=+p.value; });
    return {year:out.year,month:out.month,day:out.day,hour:out.hour,minute:out.minute};
  }

  /**
   * 여행지의 현지 날짜 + 자정부터 분을 IANA 시간대 기준 UTC ISO로 변환한다. DST gap(존재하지 않는 현지시각)은 null.
   * minutes가 1440을 넘으면 다음 날짜로 넘겨 자정 이후 일정도 보존한다.
   * @param {string} isoDate @param {number} minutes @param {string} timeZone @returns {string|null}
   */
  function zonedMinutesToISOString(isoDate,minutes,timeZone){
    const m=/^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate||'');
    if(!m||!isFinite(minutes)||!validTimeZone(timeZone)) return null;
    const base=new Date(Date.UTC(+m[1],+m[2]-1,+m[3]+Math.floor(minutes/1440)));
    if(base.getUTCFullYear()<1000) return null;
    const minute=((Math.round(minutes)%1440)+1440)%1440;
    const desired=Date.UTC(base.getUTCFullYear(),base.getUTCMonth(),base.getUTCDate(),Math.floor(minute/60),minute%60);
    let guess=desired;
    for(let i=0;i<4;i++){
      const p=_zonedParts(guess,timeZone);
      const shown=Date.UTC(p.year,p.month-1,p.day,p.hour,p.minute);
      const delta=desired-shown;
      guess+=delta;
      if(delta===0) break;
    }
    const final=_zonedParts(guess,timeZone);
    if(Date.UTC(final.year,final.month-1,final.day,final.hour,final.minute)!==desired) return null;
    return new Date(guess).toISOString().replace(/\.000Z$/,'Z');
  }

  /**
   * 일자 간 출발 기준점(단일 진실). 등록된 숙소(s.stay)가 있으면 마지막 숙소, 없으면 마지막 위치 장소.
   * 숙소 뒤에 다른 일정이 있어도 숙소를 우선한다. 좌표 있는 장소가 없으면 null.
   * 지도 일자 간 점선·재생·사이드바 이월·일자 간 거리·타임라인이 모두 이 결과를 공유한다.
   * @param {{spots?: any[]}} day
   * @returns {any}
   */
  function dayAnchor(day){
    const loc=((day&&day.spots)||[]).filter(hasCoord);
    return loc.filter((/**@type{any}*/s)=>s.stay).pop() || loc[loc.length-1] || null;
  }

  /**
   * 일자 타임라인(도착 예상시각). startAnchor가 주어지면 그 위치에서 출발해 첫 번째 '유효(좌표 있는)' 장소까지
   * 이동시간을 먼저 더한다(예: 전날 숙소→오늘 첫 장소). 좌표 없는 장소는 이동 구간 계산에서 제외한다.
   * spot.at(고정 도착시각)이 있으면 그 시각으로 고정하고, 이동상 자연 도착보다 이르면 conflict.
   * spot.bookAt(예약)이 도착보다 뒤면 그때까지 대기 후 활동 → 다음 출발 기준은 max(도착,예약)+체류.
   * @param {{startAt?: string, spots?: any[]}} day
    * @param {{legMin:(a:any,b:any,context?:{depart:number})=>number, startAnchor?: any}} opts legMin=두 지점 간 이동시간(분)
   * @returns {{eta:number, fixed:boolean, conflict:boolean}[]}
   */
  function computeTimeline(day, opts){
    const legMin=opts.legMin;
    let clock=parseHM(day&&day.startAt);
    /** @type {any} */
    let prev = (opts.startAnchor && hasCoord(opts.startAnchor)) ? opts.startAnchor : null;
    return ((day&&day.spots)||[]).map((/**@type{any}*/s)=>{
      if(hasCoord(s) && prev) clock+=legMin(prev,s,{depart:clock});
      const natural=clock;
      let eta=natural, conflict=false;
      if(s.at){ eta=parseHM(s.at); conflict = eta < natural-0.5; }   // 고정 시각인데 이동상 도착이 더 늦으면 충돌
      const depart = s.bookAt ? Math.max(eta, parseHM(s.bookAt)) : eta;
      clock = depart + (s.stayMin!=null? +s.stayMin : 60);
      if(hasCoord(s)) prev=s;
      // natural=이동상 자연 도착(고정 전), wait=예약 시각까지 기다리는 시간 → UI가 이유를 설명할 수 있게
      return {eta, fixed:!!s.at, conflict, natural, wait:Math.max(0, depart-eta)};
    });
  }

  /** 숙소 연박 수 (미지정=1박, 상한 60). Day D 체크인 + N박이면 D+1..D+N 아침의 출발점이 그 숙소.
   * @param {any} s @returns {number} */
  function stayNights(s){ const n=Math.round(+((s&&s.nights)||1)); return (isFinite(n)&&n>=1)? Math.min(n,60) : 1; }
  /**
   * di일이 '이월받는' 출발 앵커. 정책(days[di].startPolicy)이 'none'이면 이월 없음(null).
   * 그 외에는 (1) 연박 범위가 di를 덮는 가장 가까운 숙소 → (2) 없으면 직전(빈 일자는 건너뜀)
   * 유효 일자의 dayAnchor(마지막 숙소→없으면 마지막 위치).
   * 지도 일자 간 점선·재생·사이드바·타임라인·여행 모드가 이 한 결과를 공유한다.
   * @param {any[]} days
   * @param {number} di
   * @returns {any}
   */
  function dayStartAnchor(days, di){
    if(!days || !days[di] || days[di].startPolicy==='none') return null;
    // 1) di 아침에 '아직 묵고 있는' 숙소 — 가까운 날부터 거슬러, 연박 범위가 di를 덮는 첫 숙소
    for(let k=di-1;k>=0;k--){
      const L=((days[k]&&days[k].spots)||[]).filter(hasCoord).filter((/**@type{any}*/s)=>s.stay).pop();
      if(L && k+stayNights(L)>=di) return L;
    }
    // 2) 유효한 숙소가 없으면 기존대로 직전(빈 일자 건너뜀) 유효 일자의 마지막 위치
    for(let k=di-1;k>=0;k--){ const a=dayAnchor(days[k]); if(a) return a; }
    return null;
  }

  /**
   * 근거리 구간에 쓸 수 있는 수단으로 보정. 비행기·기차는 도시 간 수단이라
   * 숙소 복귀 같은 동네 이동에 그대로 쓰면 안 된다(그날 기본이 ✈️여도 호텔엔 날아가지 않는다).
   * @param {any} mode @returns {string}
   */
  function localMode(mode){
    const m=String(mode||'car');
    return (m==='flight'||m==='train') ? 'car' : m;
  }

  /**
   * 그 날 마지막에 '돌아갈 숙소' — 동선을 닫기 위한 표시·계산용이며 데이터에는 쓰지 않는다.
   * 그날 등록한 숙소 → 없으면 연박으로 그날도 묵고 있는 숙소. 이미 그 숙소로 끝나면(=동선이 닫혀 있으면) null.
   * 숙소를 못 찾으면 null — 출국일·야간열차처럼 돌아갈 곳이 없는 날엔 아무것도 덧붙이지 않는다.
   * @param {any[]} days @param {number} di @returns {any|null}
   */
  function dayReturnStay(days, di){
    const day = days && days[di]; if(!day) return null;
    const loc = ((day.spots)||[]).filter(hasCoord);
    if(!loc.length) return null;
    const own = loc.filter((/**@type{any}*/s)=>s.stay).pop();
    const carried = dayStartAnchor(days, di);
    const stay = own || ((carried && carried.stay) ? carried : null);
    if(!stay) return null;
    if(loc[loc.length-1] === stay) return null;   // 이미 숙소로 끝남
    return stay;
  }

  /** YYYY-MM-DD → 일 단위 정수 (UTC 기준이라 시간대에 밀리지 않는다) @param {any} iso @returns {number|null} */
  function _dayNum(iso){
    const m=/^(\d{4})-(\d{2})-(\d{2})$/.exec(_str(iso));
    return m? Date.UTC(+m[1],+m[2]-1,+m[3])/86400000 : null;
  }

  /**
   * 그 날짜에 배분되는 예약 비용 — 여러 날 걸친 예약을 날수로 나눈 '하루치'.
   * 숙박은 [체크인, 체크아웃) — 체크아웃 날엔 숙박비가 없다. 렌터카·항공은 [시작, 종료] 양끝 포함
   * (아침에 받아 마지막 날 반납하면 그 두 날 모두 차가 있는 날이다).
   * 나머지는 앞날부터 1원씩 얹어 하루치의 합이 예약 총액과 정확히 맞는다(반올림 누수 방지).
   * 금액은 예약 통화 그대로 — 원화 환산은 호출부(toKRW)가 한다.
   * @param {any[]} bookings @param {string} iso
   * @returns {{id:string, type:string, title:string, amount:number, cur:string, days:number}[]}
   */
  function bookingShareOn(bookings, iso){
    const d=_dayNum(iso);
    /** @type {{id:string, type:string, title:string, amount:number, cur:string, days:number}[]} */
    const out=[];
    if(d===null || !Array.isArray(bookings)) return out;
    bookings.forEach((/**@type{any}*/b)=>{
      if(!b || typeof b!=='object') return;
      const price=+b.price; if(!(price>0)) return;
      const s0=_dayNum(b.start), e0=_dayNum(b.end);
      if(s0===null || e0===null) return;                       // 기간을 모르면 어느 날에도 배분하지 않는다(총액에는 남는다)
      const n=(b.type==='hotel')? (e0-s0) : (e0-s0+1);         // 숙박=박 수, 그 외=이용 일수
      if(!(n>=1)) return;
      const idx=d-s0; if(idx<0 || idx>=n) return;
      const base=Math.floor(price/n), rem=price-base*n;
      out.push({id:_str(b.id), type:_str(b.type)||'hotel', title:_str(b.title),
        amount:base+(idx<rem?1:0), cur:_str(b.cur)||'KRW', days:n});
    });
    return out;
  }

  /**
   * 일정에 연결된 렌터카 픽업·반납 지점 — `spot.carPickupId`·`spot.carReturnId` 역참조.
   * 연결이 있으면 그 장소 행에 붙여 순서를 맞추고, 없으면 날짜 기준 독립 행으로 표시한다(carEventsOn).
   * 같은 예약이 여러 장소에 붙어 있으면(장소 복사 등) 처음 하나만 유효한 것으로 본다.
   * @param {any[]} days
   * @returns {{pickup:Object<string,{di:number,si:number}>, return:Object<string,{di:number,si:number}>}}
   */
  function carSpotLinks(days){
    /** @type {Object<string,{di:number,si:number}>} */ const pickup={};
    /** @type {Object<string,{di:number,si:number}>} */ const ret={};
    (Array.isArray(days)?days:[]).forEach((/**@type{any}*/d,/**@type{number}*/di)=>{
      ((d&&d.spots)||[]).forEach((/**@type{any}*/sp,/**@type{number}*/si)=>{
        if(!sp || typeof sp!=='object') return;
        const p=_str(sp.carPickupId), r=_str(sp.carReturnId);
        if(p && !pickup[p]) pickup[p]={di,si};
        if(r && !ret[r]) ret[r]={di,si};
      });
    });
    return {pickup, 'return':ret};
  }

  /**
   * 반납 지점 — 장소와 공항코드는 한 쌍이다. 둘 중 하나라도 입력돼 있으면 그게 '내가 정한 반납 지점'이므로
   * 픽업에서 물려받지 않는다 (편도 반납에 픽업 공항코드가 따라붙어 "서귀포점 (CJU)"가 되는 것을 막는다).
   * 둘 다 비어 있을 때만 픽업과 같은 곳으로 본다 (예약 화면의 "비우면 픽업과 동일").
   * @param {any} b @returns {{place:string, code:string}}
   */
  function carReturnPoint(b){
    if(!b || typeof b!=='object') return {place:'', code:''};
    const place=_str(b.carReturn), code=_str(b.carReturnCode);
    return (place||code)? {place, code} : {place:_str(b.carPickup), code:_str(b.carPickupCode)};
  }

  /**
   * 그 날짜에 걸리는 렌터카 픽업·반납 — 일정 화면이 예약(trip.bookings)에서 파생해 보여줄 항목.
   * 픽업·반납 장소는 자유 텍스트라 좌표가 없다 → 동선·ETA·앵커에는 넣지 않는다(표시 전용).
   * 반납 장소·공항코드를 비우면 픽업과 같은 곳으로 본다(예약 화면·시세 조회와 같은 규칙).
   * @param {any[]} bookings @param {string} iso YYYY-MM-DD
   * @returns {{kind:string, id:string, title:string, place:string, code:string, time:string}[]}
   */
  function carEventsOn(bookings, iso){
    if(!Array.isArray(bookings) || !/^\d{4}-\d{2}-\d{2}$/.test(_str(iso))) return [];
    /** @type {{kind:string, id:string, title:string, place:string, code:string, time:string}[]} */
    const out=[];
    bookings.forEach((/**@type{any}*/b)=>{
      if(!b || typeof b!=='object' || b.type!=='car') return;
      const id=_str(b.id), title=_str(b.title);
      if(b.start===iso) out.push({kind:'pickup', id, title,
        place:_str(b.carPickup), code:_str(b.carPickupCode), time:_str(b.carPickupTime)});
      if(b.end===iso){ const rp=carReturnPoint(b);
        out.push({kind:'return', id, title, place:rp.place, code:rp.code, time:_str(b.carReturnTime)}); }
    });
    // 시각 순 — 미입력은 뒤로, 같은 시각이면 픽업 먼저(당일 대여)
    const at=(/**@type{{kind:string,time:string}}*/e)=> _hm(e.time)===undefined? Infinity : parseHM(e.time);
    return out.sort((a,b)=>{
      const d=at(a)-at(b); if(d) return d;
      if(a.kind!==b.kind) return a.kind==='pickup'? -1 : 1;
      return 0;
    });
  }

  // ── 데이터 정규화 (가져오기·공유·클라우드·로컬 유입 방어) ──
  // 알려진 필드는 안전한 타입으로 강제/기본값 지정하고 잘못된 값은 제거해 렌더 크래시를 막는다.
  // 알 수 없는 필드는 보존(데이터 손실 방지). 현재 스키마 버전.
  const TC_SCHEMA=2;
  const TC_LIMITS=Object.freeze({
    jsonBytes:2*1024*1024, storeBytes:10*1024*1024, shareChars:12000,
    trips:100, days:90, spotsPerDay:200, totalSpots:5000,
    stringChars:10000, keyChars:100, depth:20, cost:1e12
  });
  const _MODES=['car','taxi','transit','train','walk','bike','flight'];
  const _CURS=['KRW','USD','EUR','JPY','CNY'];
  const _ID_RE=/^[A-Za-z0-9_-]{1,40}$/;   // uid() 형식 — inline onclick 인자로도 안전한 문자만
  /** @param {any} x @returns {string} */
  function _str(x){ return typeof x==='string'? x : (x==null? '' : String(x)); }
  /** @param {any} t @returns {string|undefined} 00:00~23:59 형식만 통과, 아니면 undefined */
  function _hm(t){ return /^([01]?\d|2[0-3]):[0-5]\d$/.test(_str(t))? _str(t) : undefined; }
  /** @param {any} x @returns {boolean} */
  function _fin(x){ const n=+x; return typeof n==='number' && isFinite(n); }

  /** UTF-8 바이트 수. @param {string} value @returns {number} */
  function _utf8Bytes(value){ return new TextEncoder().encode(value).length; }
  /** @param {any} value @returns {any} */
  function migrateTrip(value){
    if(!value||typeof value!=='object'||Array.isArray(value)) return value;
    const t=Object.assign({},value);
    const from=Number.isInteger(t.schemaVersion)?t.schemaVersion:0;
    if(from>TC_SCHEMA) return t;
    // v2는 기존 문서를 파괴하지 않고 명시적 스키마 버전만 올린다.
    t.schemaVersion=TC_SCHEMA;
    return t;
  }
  /** @param {any} value @returns {string|null} */
  function _shapeError(value){
    let totalSpots=0;
    /** @param {any} node @param {number} depth @returns {string|null} */
    function walk(node,depth){
      if(depth>TC_LIMITS.depth) return '데이터 중첩이 너무 깊습니다';
      if(typeof node==='string'&&node.length>TC_LIMITS.stringChars) return '문자열이 허용 길이를 초과했습니다';
      if(!node||typeof node!=='object') return null;
      for(const key of Object.keys(node)){
        if(key==='__proto__'||key==='prototype'||key==='constructor') return '위험한 객체 키가 포함되어 있습니다';
        if(key.length>TC_LIMITS.keyChars) return '객체 키가 너무 깁니다';
        const err=walk(node[key],depth+1); if(err) return err;
      }
      return null;
    }
    const generic=walk(value,0); if(generic) return generic;
    if(!value||typeof value!=='object'||Array.isArray(value)) return '여행 객체가 아닙니다';
    if(Number.isInteger(value.schemaVersion)&&value.schemaVersion>TC_SCHEMA) return '더 새로운 앱 버전에서 만든 여행입니다';
    if(!Array.isArray(value.days)||!value.days.length) return '일정이 없습니다';
    if(value.days.length>TC_LIMITS.days) return `일정은 ${TC_LIMITS.days}일까지 허용됩니다`;
    for(const day of value.days){
      if(!day||typeof day!=='object'||Array.isArray(day)) return '일정 형식이 올바르지 않습니다';
      if(!Array.isArray(day.spots)) return '장소 목록 형식이 올바르지 않습니다';
      if(day.spots.length>TC_LIMITS.spotsPerDay) return `하루 장소는 ${TC_LIMITS.spotsPerDay}곳까지 허용됩니다`;
      totalSpots+=day.spots.length;
      for(const spot of day.spots){
        if(!spot||typeof spot!=='object'||Array.isArray(spot)) return '장소 형식이 올바르지 않습니다';
        const hasLat=spot.lat!=null, hasLng=spot.lng!=null;
        if(hasLat!==hasLng) return '위도와 경도는 함께 입력해야 합니다';
        if(hasLat&&(!_fin(spot.lat)||!_fin(spot.lng)||+spot.lat < -90||+spot.lat > 90||+spot.lng < -180||+spot.lng > 180)) return '좌표 범위가 올바르지 않습니다';
        for(const field of ['at','bookAt']) if(spot[field]!=null&&spot[field]!==''&&_hm(spot[field])===undefined) return '시각은 HH:MM 형식이어야 합니다';
        if(spot.cost!=null&&(!_fin(spot.cost)||+spot.cost<0||+spot.cost>TC_LIMITS.cost)) return '비용 범위가 올바르지 않습니다';
        if(spot.bookUrl!=null&&spot.bookUrl!==''){
          if(typeof spot.bookUrl!=='string') return '예약 URL 형식이 올바르지 않습니다';
          try{ if(!/^https?:$/.test(new URL(spot.bookUrl).protocol)) return '예약 URL은 http(s)만 허용됩니다'; }
          catch(_){ return '예약 URL 형식이 올바르지 않습니다'; }
        }
      }
    }
    if(totalSpots>TC_LIMITS.totalSpots) return `전체 장소는 ${TC_LIMITS.totalSpots}곳까지 허용됩니다`;
    return null;
  }
  /**
   * 외부 여행 객체를 크기·구조·스키마 검증 후 정규화한다. 알 수 없는 안전한 필드는 보존한다.
   * @param {any} value @param {{maxBytes?:number}=} options
   * @returns {{ok:true,value:any}|{ok:false,error:string}}
   */
  function validateTripPayload(value,options){
    let serialized='';
    try{ serialized=JSON.stringify(value); }catch(_){ return {ok:false,error:'JSON으로 표현할 수 없는 데이터입니다'}; }
    if(!serialized) return {ok:false,error:'비어 있는 데이터입니다'};
    const max=(options&&options.maxBytes)||TC_LIMITS.jsonBytes;
    if(_utf8Bytes(serialized)>max) return {ok:false,error:'여행 데이터가 허용 크기를 초과했습니다'};
    const error=_shapeError(value); if(error) return {ok:false,error};
    const migrated=migrateTrip(value);
    const normalized=normalizeTrip(migrated);
    return normalized?{ok:true,value:normalized}:{ok:false,error:'여행 데이터를 복구할 수 없습니다'};
  }
  /** @param {string} text @returns {{ok:true,value:any}|{ok:false,error:string}} */
  function parseTripPayload(text){
    if(typeof text!=='string'||_utf8Bytes(text)>TC_LIMITS.jsonBytes) return {ok:false,error:'여행 파일이 허용 크기를 초과했습니다'};
    try{ return validateTripPayload(JSON.parse(text)); }catch(_){ return {ok:false,error:'JSON 형식이 올바르지 않습니다'}; }
  }
  /** @param {string|null} text @returns {{ok:true,value:any}|{ok:false,error:string}} */
  function parseStorePayload(text){
    if(!text) return {ok:false,error:'저장 데이터가 없습니다'};
    if(_utf8Bytes(text)>TC_LIMITS.storeBytes) return {ok:false,error:'저장 데이터가 허용 크기를 초과했습니다'};
    try{
      const raw=JSON.parse(text);
      if(!raw||typeof raw!=='object'||!Array.isArray(raw.trips)||!raw.trips.length||raw.trips.length>TC_LIMITS.trips) return {ok:false,error:'저장소 형식이 올바르지 않습니다'};
      const out=Object.assign({},raw), trips=[];
      for(const trip of raw.trips){ const result=validateTripPayload(trip); if(!result.ok) return result; trips.push(result.value); }
      out.trips=trips;
      if(typeof out.activeId!=='string'||!trips.some(t=>t.id===out.activeId)) out.activeId=trips[0].id;
      return {ok:true,value:out};
    }catch(_){ return {ok:false,error:'저장 JSON 형식이 올바르지 않습니다'}; }
  }

  /** @param {any} s @returns {any} */
  function normalizeSpot(s){
    s = (s && typeof s==='object') ? Object.assign({}, s) : {};
    s.name=_str(s.name); s.city=_str(s.city).trim()||'기타'; s.desc=_str(s.desc);
    // 좌표는 숫자·숫자 문자열만 인정한다. +null·+''는 0이라 '위치 없음'(lat:null — normalizeSpot
    // 자신의 출력 형식)이 재로드 정규화에서 (0,0) 실좌표로 둔갑해 동선·ETA를 오염시켰다.
    const num=(/**@type {any}*/v)=>{ if(typeof v==='number') return v; if(typeof v==='string' && v.trim()!=='') return +v; return NaN; };
    const lat=num(s.lat), lng=num(s.lng);
    if(_fin(lat)&&_fin(lng)&&lat>=-90&&lat<=90&&lng>=-180&&lng<=180){ s.lat=lat; s.lng=lng; }
    else { s.lat=null; s.lng=null; }
    if(_hm(s.at)===undefined) delete s.at;
    if(_hm(s.bookAt)===undefined) delete s.bookAt;
    if(s.nights!=null){ if(_fin(s.nights)) s.nights=Math.min(60,Math.max(1,Math.round(+s.nights))); else delete s.nights; }   // 숙소 연박 수
    if(s.stayMin!=null){ if(_fin(s.stayMin)) s.stayMin=Math.max(0,Math.round(+s.stayMin)); else delete s.stayMin; }
    if(s.cost!=null){ if(_fin(s.cost)) s.cost=Math.max(0,Math.round(+s.cost)); else delete s.cost; }
    if(s.cur!=null && _CURS.indexOf(s.cur)<0) delete s.cur;                 // 알 수 없는 통화 → 기본(KRW 취급)
    if(s.legMode!=null && _MODES.indexOf(s.legMode)<0) delete s.legMode;    // 알 수 없는 구간 수단 → 일정 기본
    if(s.bookUrl!=null && typeof s.bookUrl!=='string') delete s.bookUrl;
    if(s.bookingId!=null && !(typeof s.bookingId==='string' && _ID_RE.test(s.bookingId))) delete s.bookingId;   // 예약 추적 연결 (불량 id 제거)
    // 렌터카 픽업·반납 지점 연결 (불량 id 제거) — bookingId와 같은 규칙
    for(const k of /** @type {const} */(['carPickupId','carReturnId']))
      if(s[k]!=null && !(typeof s[k]==='string' && _ID_RE.test(s[k]))) delete s[k];
    if(s.placeId!=null && !(typeof s.placeId==='string' && /^[A-Za-z0-9_-]{5,200}$/.test(s.placeId))) delete s.placeId;   // 구글 Place ID (호텔 identity)
    if(s.cat!=null && _CAT_IDS.indexOf(s.cat)<0) delete s.cat;              // 알 수 없는 카테고리 → 미지정(이름 추론으로 폴백)
    if(s.hours!=null && !(Array.isArray(s.hours)&&s.hours.every((/**@type{any}*/h)=>h&&_fin(h.d)&&_fin(h.o)&&_fin(h.c)))) delete s.hours;
    return s;
  }
  /** 예약(가격 추적) 항목 정규화 — id가 불량하면 항목째 버린다(참조·inline onclick 안전) @param {any} b @returns {any} */
  function normalizeBooking(b){
    if(!b || typeof b!=='object' || Array.isArray(b)) return null;
    if(typeof b.id!=='string' || !_ID_RE.test(b.id)) return null;
    b=Object.assign({},b);
    b.type=(b.type==='car'||b.type==='flight')? b.type:'hotel';
    b.title=_str(b.title).trim()||'예약';
    b.provider=_str(b.provider);
    if(b.url!=null && typeof b.url!=='string') delete b.url;
    b.price=_fin(b.price)? Math.min(Math.max(0,Math.round(+b.price)),TC_LIMITS.cost):0;
    if(b.cur!=null && _CURS.indexOf(b.cur)<0) delete b.cur;                 // 알 수 없는 통화 → 기본(KRW 취급)
    const iso=(/**@type {any}*/v)=>/^\d{4}-\d{2}-\d{2}$/.test(_str(v));
    if(!iso(b.start)) delete b.start;
    if(!iso(b.end)) delete b.end;
    if(!iso(b.freeCancelUntil)) delete b.freeCancelUntil;
    if(b.cancelFee!=null){ if(_fin(b.cancelFee)) b.cancelFee=Math.min(Math.max(0,Math.round(+b.cancelFee)),TC_LIMITS.cost); else delete b.cancelFee; }
    // 조건 매칭용 필드 — 투숙 조건·환불·조식·객실명. 미입력(undefined)은 '모름'으로 보존한다
    if(b.adults!=null){ if(_fin(b.adults)) b.adults=Math.min(8,Math.max(1,Math.round(+b.adults))); else delete b.adults; }
    if(b.rooms!=null){ if(_fin(b.rooms)) b.rooms=Math.min(4,Math.max(1,Math.round(+b.rooms))); else delete b.rooms; }
    if(b.roomName!=null){ const r=(typeof b.roomName==='string'? b.roomName:'').trim().slice(0,120); if(r) b.roomName=r; else delete b.roomName; }
    if(b.breakfast!=null) b.breakfast=!!b.breakfast;
    if(b.refundable==null){ if(b.freeCancelUntil) b.refundable=true; }   // 구버전: 무료취소 기한만 있던 예약
    else b.refundable=!!b.refundable;
    if(b.ptoken!=null && !(typeof b.ptoken==='string' && /^[A-Za-z0-9_=-]{4,300}$/.test(b.ptoken))) delete b.ptoken;   // provider property 매핑 캐시
    if(b.enName!=null){ const en=(typeof b.enName==='string'? b.enName:'').trim().slice(0,160); if(en) b.enName=en; else delete b.enName; }   // 시세 조회용 영문명 캐시
    if(b.saved!=null){ if(_fin(b.saved)) b.saved=Math.min(Math.max(0,Math.round(+b.saved)),TC_LIMITS.cost); else delete b.saved; }   // 재예약으로 실제 절약한 누적액
    // 렌터카 조건 필드 — 시장가 비교(carMatchQuality)의 기준. 미입력(undefined)은 '모름'으로 보존
    if(b.type==='car'){
      const cs=(/**@type {any}*/v,/**@type {number}*/n)=>{ const t=(typeof v==='string'?v:'').trim().slice(0,n); return t; };
      for(const k of /** @type {const} */(['carPickup','carReturn'])){ if(b[k]!=null){ const v=cs(b[k],120); if(v) b[k]=v; else delete b[k]; } }
      for(const k of /** @type {const} */(['carPickupCode','carReturnCode'])){ if(b[k]!=null){ const v=cs(b[k],3).toUpperCase(); if(/^[A-Z]{3}$/.test(v)) b[k]=v; else delete b[k]; } }
      for(const k of /** @type {const} */(['carPickupTime','carReturnTime'])){ if(b[k]!=null){ if(_hm(b[k])===undefined) delete b[k]; } }
      if(b.carClass!=null){ const v=cs(b.carClass,40); if(v) b.carClass=v; else delete b.carClass; }
      if(b.transmission!=null && b.transmission!=='automatic' && b.transmission!=='manual') delete b.transmission;
      if(b.mileage!=null && b.mileage!=='UNLIMITED' && b.mileage!=='LIMITED') delete b.mileage;
      if(b.insurance!=null && b.insurance!=='BASIC' && b.insurance!=='CDW' && b.insurance!=='FULL') delete b.insurance;
      if(b.deposit!=null){ if(_fin(b.deposit)) b.deposit=Math.min(Math.max(0,Math.round(+b.deposit)),TC_LIMITS.cost); else delete b.deposit; }
      if(b.driverAge!=null){ if(_fin(b.driverAge)) b.driverAge=Math.min(99,Math.max(18,Math.round(+b.driverAge))); else delete b.driverAge; }
    }
    b.track=b.track!==false;   // 기본 추적 on
    return b;
  }
  /** @param {any} d @returns {any} */
  function normalizeDay(d){
    d = (d && typeof d==='object') ? Object.assign({}, d) : {};
    d.title=_str(d.title); d.drive=_str(d.drive); d.note=_str(d.note);
    if(_MODES.indexOf(d.mode)<0) d.mode='car';
    d.spots = Array.isArray(d.spots)? d.spots.map(normalizeSpot) : [];
    if(_hm(d.startAt)===undefined) delete d.startAt;                        // parseHM이 없으면 09:00 기본
    if(d.startPolicy!=null && d.startPolicy!=='none') delete d.startPolicy;  // 알 수 없는 정책 → 기본(previous)
    if(d.timeZone!=null && !validTimeZone(d.timeZone)) delete d.timeZone;
    if(d.flight!=null){
      if(typeof d.flight!=='object'){ delete d.flight; }
      else { const f=d.flight; f.code=_str(f.code); f.dep=_str(f.dep); f.arr=_str(f.arr);
        if(_hm(f.depAt)===undefined) delete f.depAt; if(_hm(f.arrAt)===undefined) delete f.arrAt; }
    }
    return d;
  }
  /**
   * 외부 유입(가져오기·공유·클라우드·로컬) 여행 데이터 정규화·검증. days가 없으면 복구 불가로 null.
   * @param {any} t @returns {any}
   */
  function normalizeTrip(t){
    if(!t || typeof t!=='object') return null;
    t = Object.assign({}, t);
    t.days = Array.isArray(t.days)? t.days.map(normalizeDay) : [];
    if(!t.days.length) return null;
    t.name = _str(t.name) || '여행';
    t.start = /^\d{4}-\d{2}-\d{2}$/.test(_str(t.start))? t.start : '';
    if(t.timeZone!=null && !validTimeZone(t.timeZone)) delete t.timeZone;
    if(t.colorBy!=null && t.colorBy!=='city' && t.colorBy!=='day') delete t.colorBy;
    if(t.bookings!=null){   // 예약(가격 추적) 목록 — 불량 항목은 버리고, 비면 필드 생략(공유 링크 크기 절약)
      t.bookings=Array.isArray(t.bookings)? t.bookings.map(normalizeBooking).filter(Boolean):[];
      if(!t.bookings.length) delete t.bookings;
    }
    t.schemaVersion = TC_SCHEMA;
    return t;
  }

  /**
   * 카카오 장소 주소에서 도시(그룹) 이름을 뽑는다.
   * "서울 중구 …" → "서울" · "경기 성남시 …" → "성남" · "제주특별자치도 제주시 …" → "제주".
   * @param {string} addr 카카오 place의 address_name / road_address_name
   * @returns {string} 도시명 (판단 불가면 '')
   */
  function cityFromKakaoAddress(addr){
    const t=String(addr||'').trim().split(/\s+/).filter(Boolean);
    if(!t.length) return '';
    const one=t[0].replace(/(특별시|광역시|특별자치시|특별자치도|자치시|자치도|도)$/,'');
    if(['서울','부산','대구','인천','광주','대전','울산','세종','제주'].indexOf(one)>=0) return one;   // 광역시·특별시는 그 자체가 도시
    const two=String(t[1]||'').replace(/(시|군)$/,'');
    return two||one;
  }

  // ───────────────── 장소 카테고리 ─────────────────
  // 목록 순서 = 편집 모달 선택지 순서. id는 저장값이므로 바꾸면 기존 데이터가 '미지정'이 된다.
  const SPOT_CATS=[
    {id:'stay',      icon:'🏠', name:'숙소'},
    {id:'food',      icon:'🍽', name:'식당'},
    {id:'cafe',      icon:'☕', name:'카페'},
    {id:'sight',     icon:'🏛', name:'명소'},
    {id:'activity',  icon:'🎢', name:'액티비티'},
    {id:'shop',      icon:'🛍', name:'쇼핑'},
    {id:'transport', icon:'🚉', name:'교통'},
    {id:'nature',    icon:'🌿', name:'자연'}
  ];
  const _CAT_IDS=SPOT_CATS.map(c=>c.id);
  /** @param {any} id @returns {{id:string,icon:string,name:string}|null} */
  function spotCat(id){ return SPOT_CATS.find(c=>c.id===id)||null; }

  // 카카오 로컬의 category_group_code (분류가 없는 코드는 추론하지 않는다)
  /** @type {Record<string,string>} */
  const _KAKAO_CAT={AD5:'stay',FD6:'food',CE7:'cafe',AT4:'sight',CT1:'sight',SW8:'transport',MT1:'shop',CS2:'shop'};
  /** @param {any} code @returns {string|null} */
  function catFromKakao(code){ return _KAKAO_CAT[String(code||'')]||null; }

  // 구글 Places types. 배열 순서가 우선순위 — 'store'처럼 넓은 타입은 뒤에 둬서 구체적인 게 먼저 잡히게 한다.
  const _GOOGLE_CAT=[
    ['stay',      ['lodging','hotel','motel','hostel','resort_hotel','guest_house','bed_and_breakfast','extended_stay_hotel','inn']],
    ['cafe',      ['cafe','coffee_shop','bakery','tea_house','dessert_shop','ice_cream_shop']],
    ['food',      ['restaurant','bar','pub','wine_bar','meal_takeaway','meal_delivery','fast_food_restaurant','food_court']],
    ['transport', ['airport','international_airport','train_station','subway_station','transit_station','bus_station','light_rail_station','ferry_terminal','car_rental']],
    ['nature',    ['park','national_park','state_park','beach','hiking_area','campground','garden','botanical_garden','wildlife_park']],
    ['activity',  ['amusement_park','water_park','aquarium','zoo','spa','movie_theater','stadium','arena','night_club','casino','bowling_alley','ski_resort','concert_hall','performing_arts_theater']],
    ['sight',     ['tourist_attraction','museum','art_gallery','church','mosque','synagogue','hindu_temple','place_of_worship','historical_landmark','historical_place','monument','cultural_landmark','observation_deck','plaza']],
    ['shop',      ['shopping_mall','department_store','supermarket','market','grocery_store','clothing_store','gift_shop','book_store','convenience_store']]
  ];
  /** @param {any} types @param {any} primary @returns {string|null} */
  function catFromGoogle(types, primary){
    /** @param {string} t @returns {string|null} */
    const hit=t=>{ for(const row of _GOOGLE_CAT) if(/**@type{string[]}*/(row[1]).indexOf(t)>=0) return /**@type{string}*/(row[0]); return null; };
    if(primary){ const c=hit(String(primary)); if(c) return c; }   // primaryType이 있으면 그게 그 장소의 대표 성격
    if(Array.isArray(types)) for(const row of _GOOGLE_CAT) for(const t of types) if(/**@type{string[]}*/(row[1]).indexOf(String(t))>=0) return /**@type{string}*/(row[0]);
    return null;
  }

  // 이름으로 추론 — 카테고리가 없는 기존 데이터에도 아이콘이 보이게 하는 폴백. 결과는 저장하지 않는다(표시 전용).
  // 위에서부터 먼저 걸리는 규칙이 이긴다.
  const _CAT_NAME_RULES=[
    ['stay',      /호텔|호스텔|게스트\s*하우스|민박|펜션|리조트|숙소|료칸|hotel|hostel|resort|\binn\b|b&b|airbnb|guest\s*house/i],
    ['transport', /공항|역$|역\s|터미널|정류장|선착장|항구|airport|station|terminal|\bport\b|pier/i],
    ['cafe',      /카페|커피|베이커리|제과|coffee|caf[eé]|espresso|roaster|bakery/i],
    ['food',      /식당|맛집|레스토랑|이자카야|포차|타베르나|restaurant|taberna|taverna|trattoria|osteria|bistro|\bgrill\b|\bpub\b/i],
    ['sight',     /대성당|성당|사원|신사|박물관|미술관|궁전|왕궁|고궁|유적|전망대|기념관|알카사르|광장|museum|cathedral|basilica|church|temple|shrine|palace|castle|alcazar|mezquita|monument|memorial|gallery|mirador|plaza|square/i],
    ['nature',    /공원|해변|해수욕장|계곡|폭포|호수|정원|수목원|park|beach|playa|garden|lake|falls|trail/i],
    ['activity',  /수족관|동물원|놀이공원|테마파크|스파|온천|공연|극장|경기장|스타디움|aquarium|\bzoo\b|amusement|theme\s*park|\bspa\b|theat(er|re)|stadium|arena/i],
    ['shop',      /시장|백화점|아울렛|쇼핑|마트|market|mercado|\bmall\b|outlet|bazaar/i]
  ];
  /** @param {any} name @returns {string|null} */
  function catFromName(name){
    const s=_str(name); if(!s) return null;
    for(const row of _CAT_NAME_RULES) if(/**@type{RegExp}*/(row[1]).test(s)) return /**@type{string}*/(row[0]);
    return null;
  }

  /**
   * 표시할 카테고리 — 명시값 → 🏠 숙소 플래그 → 이름 추론 순. 추론분은 저장하지 않는다.
   * @param {any} s @returns {{id:string,icon:string,name:string}|null}
   */
  function spotCatOf(s){
    if(!s || typeof s!=='object') return null;
    const explicit=spotCat(s.cat); if(explicit) return explicit;
    if(s.stay) return spotCat('stay');
    return spotCat(catFromName(s.name));
  }

  const TC={SPOT_CATS,spotCat,spotCatOf,catFromKakao,catFromGoogle,catFromName,cityFromKakaoAddress,toISO,haversine,stayNights,legId,legKey,ringPts,parseHM,hm,inKorea,simplifyName,parseDirect,parseMoney,encodePolyline,decodePolyline,optimizeRoute,routeLength,isOpenAt,validTimeZone,zonedMinutesToISOString,dayAnchor,computeTimeline,dayStartAnchor,dayReturnStay,carEventsOn,carReturnPoint,carSpotLinks,bookingShareOn,localMode,normalizeTrip,normalizeBooking,migrateTrip,validateTripPayload,parseTripPayload,parseStorePayload,TC_LIMITS,TC_SCHEMA};
  if(typeof module!=='undefined' && module.exports){ module.exports=TC; }   // Node (테스트)
  else { const r=/**@type {any}*/(root); for(const k in TC) r[k]=/**@type {any}*/(TC)[k]; }   // 브라우저 전역
})(typeof window!=='undefined'?window:globalThis);
