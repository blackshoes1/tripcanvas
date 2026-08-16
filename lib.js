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
    if(m=str.match(/[¥￥]\s*([\d,]+)/))        return {cost:num(m[1]),cur:'JPY',raw:m[0]};
    if(m=str.match(/元\s*([\d,]+)/))           return {cost:num(m[1]),cur:'CNY',raw:m[0]};
    if(m=str.match(/₩\s*([\d,]+)/))           return {cost:num(m[1]),cur:'KRW',raw:m[0]};
    if(m=str.match(/([\d,]+)\s*(?:달러|불)/))   return {cost:num(m[1]),cur:'USD',raw:m[0]};
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
   * @param {{legMin:(a:any,b:any)=>number, startAnchor?: any}} opts legMin=두 지점 간 이동시간(분)
   * @returns {{eta:number, fixed:boolean, conflict:boolean}[]}
   */
  function computeTimeline(day, opts){
    const legMin=opts.legMin;
    let clock=parseHM(day&&day.startAt);
    /** @type {any} */
    let prev = (opts.startAnchor && hasCoord(opts.startAnchor)) ? opts.startAnchor : null;
    return ((day&&day.spots)||[]).map((/**@type{any}*/s)=>{
      if(hasCoord(s) && prev) clock+=legMin(prev,s);
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

  /**
   * di일이 '이월받는' 출발 앵커. 정책(days[di].startPolicy)이 'none'이면 이월 없음(null).
   * 그 외에는 직전(빈 일자는 건너뜀) 유효 일자의 dayAnchor(마지막 숙소→없으면 마지막 위치).
   * 지도 일자 간 점선·재생·사이드바·타임라인·여행 모드가 이 한 결과를 공유한다.
   * @param {any[]} days
   * @param {number} di
   * @returns {any}
   */
  /** 숙소 연박 수 (미지정=1박). Day D 체크인 + N박이면 D+1..D+N 아침의 출발점이 그 숙소. */
  function stayNights(s){ const n=Math.round(+((s&&s.nights)||1)); return (isFinite(n)&&n>=1)? Math.min(n,60) : 1; }
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

  // ── 데이터 정규화 (가져오기·공유·클라우드·로컬 유입 방어) ──
  // 알려진 필드는 안전한 타입으로 강제/기본값 지정하고 잘못된 값은 제거해 렌더 크래시를 막는다.
  // 알 수 없는 필드는 보존(데이터 손실 방지). 현재 스키마 버전.
  const TC_SCHEMA=1;
  const _MODES=['car','taxi','transit','train','walk','bike','flight'];
  const _CURS=['KRW','USD','JPY','CNY'];
  /** @param {any} x @returns {string} */
  function _str(x){ return typeof x==='string'? x : (x==null? '' : String(x)); }
  /** @param {any} t @returns {string|undefined} 00:00~23:59 형식만 통과, 아니면 undefined */
  function _hm(t){ return /^([01]?\d|2[0-3]):[0-5]\d$/.test(_str(t))? _str(t) : undefined; }
  /** @param {any} x @returns {boolean} */
  function _fin(x){ const n=+x; return typeof n==='number' && isFinite(n); }

  /** @param {any} s @returns {any} */
  function normalizeSpot(s){
    s = (s && typeof s==='object') ? Object.assign({}, s) : {};
    s.name=_str(s.name); s.city=_str(s.city).trim()||'기타'; s.desc=_str(s.desc);
    const lat=+s.lat, lng=+s.lng;
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
    if(s.hours!=null && !(Array.isArray(s.hours)&&s.hours.every((/**@type{any}*/h)=>h&&_fin(h.d)&&_fin(h.o)&&_fin(h.c)))) delete s.hours;
    return s;
  }
  /** @param {any} d @returns {any} */
  function normalizeDay(d){
    d = (d && typeof d==='object') ? Object.assign({}, d) : {};
    d.title=_str(d.title); d.drive=_str(d.drive); d.note=_str(d.note);
    if(_MODES.indexOf(d.mode)<0) d.mode='car';
    d.spots = Array.isArray(d.spots)? d.spots.map(normalizeSpot) : [];
    if(_hm(d.startAt)===undefined) delete d.startAt;                        // parseHM이 없으면 09:00 기본
    if(d.startPolicy!=null && d.startPolicy!=='none') delete d.startPolicy;  // 알 수 없는 정책 → 기본(previous)
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
    if(t.colorBy!=null && t.colorBy!=='city' && t.colorBy!=='day') delete t.colorBy;
    t.schemaVersion = TC_SCHEMA;
    return t;
  }

  const TC={toISO,haversine,stayNights,legId,legKey,ringPts,parseHM,hm,inKorea,simplifyName,parseDirect,parseMoney,encodePolyline,decodePolyline,optimizeRoute,routeLength,isOpenAt,dayAnchor,computeTimeline,dayStartAnchor,normalizeTrip,TC_SCHEMA};
  if(typeof module!=='undefined' && module.exports){ module.exports=TC; }   // Node (테스트)
  else { const r=/**@type {any}*/(root); for(const k in TC) r[k]=/**@type {any}*/(TC)[k]; }   // 브라우저 전역
})(typeof window!=='undefined'?window:globalThis);
