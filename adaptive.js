// Trip Canvas — Adaptive Travel OS 도메인 (순수 로직: DOM·네트워크·현재시각 접근 없음)
// 제품 한 문장: "현재 여행 상태를 이해하고, 다음을 이어준다".
// 흐름은 한 방향이다:  상태(TripState) → 후보(Candidate) → 순위(rank) → 제안(TripSuggestion) → 사용자 결정.
// 시각·이동시간·영업요일 같은 '사실'은 전부 인자로 주입받는다 → 같은 입력이면 항상 같은 결과(추천 안정성).
// 추천 점수는 내부 값일 뿐이고 사용자에게는 reasons(이유 문장)만 보여준다.
// @ts-check
(function(root){
  'use strict';
  // lib.js 재사용(haversine·parseHM·hm·isOpenAt). 브라우저는 전역, Node(테스트)는 모듈.
  const LIB = (typeof module!=='undefined' && module.exports) ? require('./lib.js') : /** @type {any} */(root);

  /** @typedef {{lat:number,lng:number}} LatLng */
  /** @typedef {'FIXED'|'SEMI_FIXED'|'FLEXIBLE'} Flexibility */
  /** @typedef {'PLANNED'|'READY'|'IN_PROGRESS'|'COMPLETED'|'SKIPPED'|'CANCELLED'} ActivityStatus */
  /** @typedef {'FLIGHT'|'TRAIN'|'HOTEL'|'RESTAURANT'|'TOUR'|'CAR'|'OTHER'} CommitmentType */
  /** @typedef {'MANUAL'|'ASSISTED'|'DELEGATED'} PlanningMode */
  /** @typedef {'LOW'|'NORMAL'|'HIGH'} EnergyLevel */
  /** @typedef {'VISIT_PLACE'|'MOVE'|'EAT'|'REST'|'CHECK_IN'|'RETURN_TO_HOTEL'|'WAIT'} ActionKind */
  /** @typedef {{id:string,si:number,name:string,spot:any,eta:number,natural:number,travelIn:number,depart:number,end:number,stayMin:number,status:ActivityStatus,flexibility:Flexibility,type:CommitmentType,priority:number,location:(LatLng|null),fixedAt:(number|null),conflict:boolean}} TripItem */
  /** @typedef {{id:string,type:CommitmentType,itemId:string,startMin:number,endMin:number,location:(LatLng|null),flexibility:Flexibility,title:string}} FixedCommitment */
  /** @typedef {{startMin:number,endMin:number,minutes:number,anchor:(LatLng|null),afterId:(string|null),beforeId:(string|null),beforeFixed:boolean}} FreeWindow */
  /** @typedef {{id:string,kind:ActionKind,title:string,location:(LatLng|null),durationMin:number,priority:number,must:boolean,hours:(any[]|null),fromDay:(number|null),si:(number|null),inPlan:boolean,spot:any}} ActionCandidate */
  /** @typedef {{type:string,id:string,targetId:(string|null),title:string,score:number,reasons:string[],estimatedDuration:number,estimatedTravelTime:number,arriveMin:number,endMin:number,fromDay:(number|null),si:(number|null),spot:any}} NextActionCandidate */
  /** @typedef {{timeChangeMinutes?:number,travelTimeChangeMinutes?:number,costChange?:number,removedActivities?:string[],addedActivities?:string[]}} SuggestionImpact */
  /** @typedef {{id:string,key:string,type:string,title:string,description:string,reasons:string[],impact:SuggestionImpact,status:string,action:any}} TripSuggestion */

  /** 판정 기준은 흩어놓지 않고 한곳에 모은다 — 모든 함수가 cfg 재정의를 받는다. */
  const ADAPT_CFG = Object.freeze({
    minWindowMin: 45,        // 이보다 짧은 틈은 '일정을 넣을 빈 시간'으로 보지 않는다
    bufferMin: 15,           // 고정 일정 도착 전에 남겨둘 여유
    maxSuggest: 3,           // 한 번에 보여줄 제안 수 — 검색 결과 앱이 되지 않게
    // ⚠️ 두 값을 섞지 말 것 — 하나는 '내가 계획한 체류', 다른 하나는 '제안할 활동의 예상 소요'다.
    defaultStayMin: 0,       // 체류시간을 **안 정한** 장소는 머무르지 않는다 (computeTimeline과 동일)
    suggestStayMin: 60,      // 제안할 활동의 예상 소요. 0으로 두면 어떤 빈 시간에도 무한히 들어간다
    readyLeadMin: 15,        // 도착 예정 이 시간 전부터 'READY'
    lateThresholdMin: 20,    // 현재 시각이 계획보다 이만큼 밀리면 '지연'
    heavyTravelMin: 180,     // 오늘 누적 이동이 이보다 크면 휴식 후보 가중
    dayEndMin: 21*60,        // 하루 활동 종료 기준(빈 시간 탐지의 꼬리)
    nearKm: 1.5,             // 이 안이면 '바로 근처'
    fallbackSpeedKmh: 25,    // 이동시간 주입이 없을 때의 직선거리 환산 속도
    lookAheadDays: 3,        // 다른 날에서 후보를 끌어올 때 살펴볼 앞뒤 일자 범위
    readyWindowMin: 12,      // 출발 권장 시각 이 안으로 들어오면 '지금 나서기 좋음'
    aheadMin: 30,            // 다음 일정까지 이보다 많이 남고 앞 일정을 끝냈으면 '여유 있음'
    freeTimeMin: 90,         // 이만큼 비면 '빈 시간'으로 본다(제안을 만들 가치가 있는 크기)
    suggestionTTLMin: 90,    // 위치·시각 기반 제안의 유효기간 — 지나면 표시도 알림도 하지 않는다
    restRoomMin: 30,         // 다음 일정까지 이만큼은 남아야 "쉬어도 괜찮아요"라고 한다(지쳤다고 했을 때는 그 대가를 말하고 권한다)
    lowEnergyMaxStayMin: 90, // 지쳤다고 하면 이보다 긴 방문은 권하지 않는다
    maxMoveMin: 60           // 다른 날에서 옮겨올 곳은 이보다 멀면 권하지 않는다 — 섬 반대편을 '한 곳 더'로 끌어오지 않게
  });
  const MEAL_WINDOWS = Object.freeze([
    Object.freeze({key:'lunch', from:11*60+30, to:13*60+30, label:'점심'}),
    Object.freeze({key:'dinner', from:17*60+30, to:20*60, label:'저녁'})
  ]);

  /** @param {any} o @returns {any} */
  function cfgOf(o){ return (o&&o.cfg)||ADAPT_CFG; }
  /** @param {any} s @returns {boolean} */
  function hasCoord(s){ return !!s && s.lat!=null && s.lng!=null && isFinite(+s.lat) && isFinite(+s.lng); }
  /** @param {any} s @returns {LatLng|null} */
  function locOf(s){ return hasCoord(s)? {lat:+s.lat, lng:+s.lng} : null; }
  /** @param {any} x @param {number} d @returns {number} */
  function num(x,d){ const n=+x; return isFinite(n)? n : d; }
  /**
   * 분 → '45분' · '1시간' · '7시간 25분'. 한 시간이 넘는 시간을 분으로만 말하지 않는다(2026-10-03 — '445분 대기'·'480분 남았어요').
   * 웹 `fmtDur`·iOS `TimeFormat.duration`과 같은 모양이다.
   * @param {number} min @returns {string}
   */
  function durText(min){
    const m=Math.max(0, Math.round(num(min,0)));
    if(m<60) return m+'분';
    const h=Math.floor(m/60), r=m%60;
    return h+'시간'+(r? ' '+r+'분' : '');
  }
  /**
   * 받침에 맞는 조사 — '북촌한옥마을는'·'을(를)'을 쓰지 않는다(2026-10-03). 한글이 아니면(외국어 상호·괄호로 끝나는 이름)
   * 받침 없는 쪽을 고른다(`collab.js` `objParticle`과 같은 기본값). '으로'는 ㄹ 받침이면 '로'다.
   * @param {unknown} word @param {string} withFinal 받침이 있을 때 @param {string} withoutFinal 받침이 없을 때 @returns {string}
   */
  function josa(word, withFinal, withoutFinal){
    const s=String(word==null?'':word).trim();
    const code=s? s.charCodeAt(s.length-1)-0xAC00 : -1;
    if(code<0||code>11171) return withoutFinal;
    const fin=code%28;
    if(withFinal==='으로' && fin===8) return withoutFinal;
    return fin? withFinal : withoutFinal;
  }
  /**
   * 목록이 🏠로 그리는 곳은 엔진도 숙소로 본다(2026-10-03). 숙소 체크(stay)를 켜지 않은 호텔을 일반 장소로 보면
   * 일정 조정이 "오늘 밤 숙소"를 뺄 후보로 삼았고 '숙소로 돌아가기'도 위치를 몰랐다. 판정은 표시와 같은 `spotCatOf`다.
   * @param {any} s @returns {boolean}
   */
  function isLodging(s){
    if(!s) return false;
    if(s.stay) return true;
    const cat=LIB.spotCatOf(s);
    return !!(cat && cat.id==='stay');
  }
  /** YYYY-MM-DD → 요일(0=일). 파싱 실패는 -1. @param {string} iso @returns {number} */
  function weekdayOf(iso){
    if(!/^\d{4}-\d{2}-\d{2}$/.test(String(iso||''))) return -1;
    const ms=Date.parse(iso+'T00:00:00Z');
    return isFinite(ms)? new Date(ms).getUTCDay() : -1;
  }
  /** trip.start 기준 오늘의 일자 index. 여행 기간 밖이면 -1. @param {any} trip @param {string} todayISO @returns {number} */
  function currentDayIndex(trip, todayISO){
    const days=(trip&&trip.days)||[];
    if(!days.length || !/^\d{4}-\d{2}-\d{2}$/.test(String((trip&&trip.start)||'')) || !/^\d{4}-\d{2}-\d{2}$/.test(String(todayISO||''))) return -1;
    const a=Date.parse(trip.start+'T00:00:00Z'), b=Date.parse(todayISO+'T00:00:00Z');
    if(!isFinite(a)||!isFinite(b)) return -1;
    const diff=Math.round((b-a)/86400000);
    return (diff>=0 && diff<days.length)? diff : -1;
  }
  /**
   * 출발까지 남은 날. **아직 시작하지 않은 여행에만** 값이 있다 —
   * 진행 중이거나 이미 끝났으면 null이다(셀 것이 없다).
   * ⚠️ `currentDayIndex`와 **같은 날짜 규칙**을 쓴다. 따로 세면 "D-1인데 이미 시작됨" 같은
   * 어긋남이 생긴다.
   * @param {any} trip @param {string} todayISO @returns {number|null}
   */
  function daysUntilStart(trip, todayISO){
    const start=String((trip&&trip.start)||'');
    if(!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(String(todayISO||''))) return null;
    const a=Date.parse(start+'T00:00:00Z'), b=Date.parse(todayISO+'T00:00:00Z');
    if(!isFinite(a)||!isFinite(b)) return null;
    const diff=Math.round((a-b)/86400000);
    return diff>0? diff : null;   // 오늘이 출발일이면 이미 시작이다(D-0을 말하지 않는다)
  }

  /** 이동시간(분) — 주입된 legMin 우선, 없으면 직선거리 환산. 좌표가 없으면 0(모름). @param {any} a @param {any} b @param {any=} opts @returns {number} */
  function travelMinutes(a,b,opts){
    if(!hasCoord(a)||!hasCoord(b)) return 0;
    const c=cfgOf(opts), fn=opts&&opts.legMin;
    if(typeof fn==='function'){ const v=+fn(a,b); if(isFinite(v)&&v>=0) return Math.round(v); }
    return Math.round(LIB.haversine({lat:+a.lat,lng:+a.lng},{lat:+b.lat,lng:+b.lng})/c.fallbackSpeedKmh*60);
  }
  const MOVE_MODES=['car','taxi','transit','train','walk','bike','flight'];
  /**
   * 엔진이 묻는 이동(legMin)의 수단 — 일정 화면과 같은 출처를 쓴다(2026-10-03). 전에는 호출부가 일자 기본 수단 하나로
   * 물어서, 도착일(일자 수단 ✈️)에 제안한 3.1km 프라도가 '2분 이동'이었다(일정 화면은 같은 구간을 13분이라 했다).
   * ① 그날 일정의 장소면 그 장소의 구간 수단(`legModeOf`와 같다) ② 다른 날 장소면 그날 그 장소로 가던 수단
   * ③ 그 밖에는 일자 수단 — 단 비행기·기차는 도시 안 이동이 아니라 여행에서 처음 나오는 도시 안 수단, 없으면 자차.
   * @param {any} trip @param {any} day @param {any} loc 도착 좌표 @returns {string}
   */
  function moveModeTo(trip, day, loc){
    /** @param {any} m @returns {string} */
    const valid=(m)=> MOVE_MODES.indexOf(m)>=0? m : '';
    /** @param {string} m @returns {boolean} */
    const city=(m)=> !!m && m!=='flight' && m!=='train';
    /** @param {any} s @returns {boolean} */
    const same=(s)=> hasCoord(s) && hasCoord(loc) && Math.abs(+s.lat - +loc.lat)<1e-7 && Math.abs(+s.lng - +loc.lng)<1e-7;
    /** @param {any} d @param {any} s @returns {string} */
    const modeIn=(d,s)=> valid(s&&s.legMode) || valid(d&&d.mode) || 'car';
    const own=((day&&day.spots)||[]).filter(same)[0];
    if(own) return modeIn(day, own);
    const days=(trip&&trip.days)||[];
    for(const d of days){
      const s=((d&&d.spots)||[]).filter(same)[0];
      if(s && city(modeIn(d,s))) return modeIn(d,s);
    }
    const dm=valid(day&&day.mode);
    if(city(dm)) return dm;
    return days.map((/**@type{any}*/d)=>valid(d&&d.mode)).filter(city)[0] || 'car';
  }

  // ── 1. 고정 / 유동 분류 ───────────────────────────────────────────
  /**
   * 일정 하나의 성격. 상대가 정한 시각(bookAt)·항공·기차는 FIXED(침범 금지),
   * 내가 정한 도착시각(at)·숙소·렌터카는 SEMI_FIXED, 나머지 관광/카페/산책은 FLEXIBLE.
   * @param {any} spot @param {any} day @param {any[]=} bookings
   * @returns {{type:CommitmentType, flexibility:Flexibility, bookingId:(string|null)}}
   */
  function commitmentOf(spot, day, bookings){
    const s=spot||{};
    const bk=(s.bookingId && Array.isArray(bookings))? (bookings.filter(b=>b&&b.id===s.bookingId)[0]||null) : null;
    const legMode=s.legMode || (day&&day.mode) || '';
    /** @type {CommitmentType} */
    let type='OTHER';
    if(bk && bk.type==='flight') type='FLIGHT';
    else if(bk && bk.type==='car') type='CAR';
    else if(bk && bk.type==='hotel') type='HOTEL';
    else if(isLodging(s)) type='HOTEL';   // 숙소 체크 또는 🏠 분류 — 목록이 숙소로 그리는 곳(2026-10-03)
    else if(legMode==='flight') type='FLIGHT';
    else if(legMode==='train') type='TRAIN';
    else if(s.bookAt) type='TOUR';   // 식당/투어/공연을 구분할 데이터가 없다 — '상대가 정한 약속'으로만 취급
    /** @type {Flexibility} */
    let flexibility='FLEXIBLE';
    if(type==='FLIGHT'||type==='TRAIN'||s.bookAt) flexibility='FIXED';
    else if(type==='HOTEL'||type==='CAR'||s.at) flexibility='SEMI_FIXED';
    return {type, flexibility, bookingId: bk? bk.id : null};
  }
  /** 보호 우선순위 (3=반드시 → 1=선택). 고정 일정과 mustVisit은 항상 최우선. @param {any} spot @param {Flexibility} flexibility @returns {number} */
  function priorityOf(spot, flexibility){
    if(spot && spot.must) return 3;
    if(flexibility!=='FLEXIBLE') return 3;
    if(spot && spot.opt) return 1;
    return 2;
  }
  /**
   * 실행 상태. 저장된 값(COMPLETED/SKIPPED/CANCELLED)이 우선이고, 나머지는 시각으로 유도한다.
   * 자동 완료 처리는 하지 않는다 — 방문 판정은 사용자가 누른다.
   * @param {any} spot @param {number} startMin 활동이 실제로 시작되는 시각(예약 시각까지 기다리면 그 시각) @param {number} endMin @param {number} nowMin @param {boolean} live @param {any=} opts
   * @returns {ActivityStatus}
   */
  function statusOf(spot, startMin, endMin, nowMin, live, opts){
    const raw=spot&&spot.status;
    if(raw==='COMPLETED'||raw==='SKIPPED'||raw==='CANCELLED') return raw;
    if(!live) return 'PLANNED';
    const c=cfgOf(opts);
    if(nowMin>=startMin && nowMin<endMin) return 'IN_PROGRESS';
    if(nowMin>=startMin-c.readyLeadMin && nowMin<startMin) return 'READY';
    return 'PLANNED';
  }
  /** 계획을 얼마나 직접 세웠는지 추정 — 사용자가 지정하지 않았을 때의 기본값. @param {any} trip @returns {PlanningMode} */
  function planningModeHint(trip){
    const days=(trip&&trip.days)||[];
    if(!days.length) return 'DELEGATED';
    const filled=days.filter((/**@type{any}*/d)=>(((d&&d.spots)||[]).length>=2)).length;
    const ratio=filled/days.length;
    if(ratio>=0.8) return 'MANUAL';
    if(ratio>=0.3) return 'ASSISTED';
    return 'DELEGATED';
  }

  // ── 2. TripState ─────────────────────────────────────────────────
  /**
   * 현재 여행 상태. itinerary 배열이 아니라 "지금 어디까지 왔고 무엇이 남았는가"를 계산한다.
   * timeline은 app이 실제 이동시간으로 계산한 computeTimeline 결과를 그대로 넘긴다(출발 기준점 단일 진실 공유).
   * @param {any} trip
   * @param {{dayIndex?:number, todayISO?:string, nowMin?:number, live?:boolean, timeline?:any[], startAnchor?:any,
   *          currentLocation?:any, planningMode?:PlanningMode, energyLevel?:EnergyLevel, legMin?:any, cfg?:any, prefs?:any}=} opts
   * @returns {any}
   */
  function buildTripState(trip, opts){
    const o=opts||{}, c=cfgOf(o), days=(trip&&trip.days)||[];
    const todayISO=o.todayISO||'';
    const today=currentDayIndex(trip, todayISO);
    const di=(o.dayIndex!=null && o.dayIndex>=0 && o.dayIndex<days.length)? o.dayIndex : (today>=0? today : 0);
    const day=days[di]||{spots:[]};
    const spots=(day.spots)||[];
    const timeline=Array.isArray(o.timeline)? o.timeline : [];
    const live=(o.live!=null)? !!o.live : (today>=0 && di===today);
    const dayStartMin=LIB.parseHM(day.startAt);
    const nowMin=live? Math.max(0, Math.min(1439, Math.round(num(o.nowMin, dayStartMin)))) : dayStartMin;
    const bookings=(trip&&trip.bookings)||[];
    const startLocation=locOf(o.startAnchor);

    /** @type {TripItem[]} */
    const items=[];
    let prevEnd=dayStartMin, travelToday=0;
    spots.forEach((/**@type{any}*/s,/**@type{number}*/si)=>{
      const tl=timeline[si]||{};
      const eta=num(tl.eta, prevEnd), natural=num(tl.natural, eta), wait=num(tl.wait, 0);
      const stayMin=(s&&s.stayMin!=null)? Math.max(0,num(s.stayMin,c.defaultStayMin)) : c.defaultStayMin;
      const depart=eta+wait, end=depart+stayMin;
      const travelIn=Math.max(0, natural-prevEnd);
      const cm=commitmentOf(s, day, bookings);
      const status=statusOf(s, depart, end, nowMin, live, o);   // 19시 예약은 19시에 시작한다 — 도착 예정으로 보면 안 된다
      items.push({
        id:'d'+di+'s'+si, si, name:String((s&&s.name)||''), spot:s,
        eta, natural, travelIn, depart, end, stayMin, status,
        flexibility:cm.flexibility, type:cm.type, priority:priorityOf(s, cm.flexibility),
        location:locOf(s), fixedAt:(s&&s.bookAt)? LIB.parseHM(s.bookAt) : ((s&&s.at)? LIB.parseHM(s.at) : null),
        conflict:!!tl.conflict
      });
      travelToday+=travelIn; prevEnd=end;
    });

    const active=items.filter(it=>it.status!=='SKIPPED' && it.status!=='CANCELLED');
    const completed=items.filter(it=>it.status==='COMPLETED');
    const remaining=active.filter(it=>it.status!=='COMPLETED');
    /** @type {FixedCommitment[]} */
    const fixedCommitments=active.filter(it=>it.flexibility!=='FLEXIBLE').map(it=>({
      id:'fc-'+it.id, itemId:it.id, type:it.type, title:it.name,
      startMin:(it.fixedAt!=null? it.fixedAt : it.eta), endMin:it.end,
      location:it.location, flexibility:it.flexibility
    }));
    const nextFixed=fixedCommitments.filter(f=>f.startMin>=nowMin)[0]||null;
    const lastDone=completed.length? completed[completed.length-1] : null;
    const inProgress=items.filter(it=>it.status==='IN_PROGRESS')[0]||null;
    /** @type {LatLng|null} */
    let passedLoc=null;
    if(live) for(let i=0;i<items.length;i++){ const it=items[i]; if(it.location && it.end<=nowMin) passedLoc=it.location; }
    /** @type {LatLng|null} */
    let firstLoc=null;
    for(let i=0;i<items.length && !firstLoc;i++) firstLoc=items[i].location;
    // 우선순위: 주입된 위치 → 진행 중인 곳 → 마지막 완료 → 지금쯤 지나왔을 곳 → 이월 앵커 → 오늘 첫 장소
    const currentLocation=locOf(o.currentLocation) || (inProgress&&inProgress.location) || (lastDone&&lastDone.location) || passedLoc || startLocation || firstLoc;
    // 지연: 이미 지났어야 할 활동이 아직 남아 있으면 그 차이 (계획 대비 밀린 분)
    let delayMin=0;
    if(live) remaining.forEach(it=>{ if(nowMin>it.eta) delayMin=Math.max(delayMin, Math.round(nowMin-it.eta)); });
    const lastEnd=items.length? items[items.length-1].end : dayStartMin;
    const dayEndMin=Math.max(c.dayEndMin, lastEnd);
    // 쉴 수 있는 여유는 '다음 고정 일정'이 아니라 **다음 남은 일정**까지다(2026-10-03) — 북촌·광장시장·남산이 남았는데
    // 쉬기 카드가 "명동교자 19:00까지 480분 남았어요"라고 했고, 바로 위 '다음 장소'는 0분 여유였다.
    // 머무는 곳이 있으면 그곳이 끝난 뒤부터, 다음 곳은 떠나야 하는 시각(예약 대기 포함, 이동 앞)까지다 — 이동은 빈 시간이 아니다.
    // '다녀왔어요'를 누른 곳은 끝난 것이다 — 계획한 종료 시각까지 붙잡아 두지 않는다.
    const freeBefore=remaining.filter(it=>it.status!=='IN_PROGRESS' && (!live || it.end>nowMin || it.depart>=nowMin))[0]||null;
    const freeFrom=Math.max(nowMin, inProgress? inProgress.end : nowMin);
    const availableMin=freeBefore? Math.max(0, (freeBefore.depart-freeBefore.travelIn)-freeFrom) : Math.max(0, dayEndMin-freeFrom);
    const hotel=active.filter(it=>it.type==='HOTEL').pop()||null;

    return {
      tripId:(trip&&trip.id)||'', tripName:(trip&&trip.name)||'',
      currentDay:di, todayIndex:today, dayCount:days.length, todayISO, weekday:weekdayOf(todayISO),
      live, nowMin, dayStartMin, dayEndMin, day,
      items, completedItems:completed.map(it=>it.id), remainingItems:remaining.map(it=>it.id),
      skippedItems:items.filter(it=>it.status==='SKIPPED').map(it=>it.id),
      fixedCommitments, nextFixed, currentItem:inProgress,
      // 다음 행동은 '아직 끝나지 않은' 것이다. 여행 중이라면 이미 끝났어야 할 항목(사용자가 완료를
      // 안 눌렀을 뿐)을 '다음'으로 내밀지 않는다. 전부 지났으면 가장 이른 미완료가 다음이다(밀린 상태).
      nextItem:(live? (remaining.filter(it=>it.end>nowMin)[0]||remaining[0]||null) : (remaining[0]||null)),
      currentLocation, startLocation, hotelLocation:(hotel&&hotel.location)||startLocation,
      availableMin, freeBefore, delayMin, travelMinToday:travelToday,
      prefs:o.prefs||{},   // {maxTravelMin?, walkAverse?, mealFocus?} — 자연어 요청이 추천 범위를 좁힌다
      planningMode:o.planningMode||planningModeHint(trip),
      energyLevel:o.energyLevel||'NORMAL'
    };
  }

  // ── 3. 빈 시간 탐지 ───────────────────────────────────────────────
  /**
   * 일정의 빈 시간. '이동시간'은 빈 시간이 아니다 — 활동 종료와 다음 활동의 자연 도착 사이에서
   * 이동에 쓰이는 만큼을 빼고 남는 여유만 창으로 본다(고정 시각을 기다리는 대기시간이 대부분).
   * live면 이미 지나간 구간은 잘라낸다.
   * @param {any} state @param {{cfg?:any, minMinutes?:number}=} opts
   * @returns {FreeWindow[]}
   */
  function findFreeWindows(state, opts){
    const c=cfgOf(opts), min=num(opts&&opts.minMinutes, c.minWindowMin);
    /** @type {FreeWindow[]} */
    const out=[];
    const items=state.items.filter((/**@type{TripItem}*/it)=>it.status!=='SKIPPED'&&it.status!=='CANCELLED');
    let cur=state.live? Math.max(state.nowMin, state.dayStartMin) : state.dayStartMin;
    /** @type {TripItem|null} */
    let prev=null;
    for(let i=0;i<items.length;i++){
      const it=/** @type {TripItem} */(items[i]);
      if(it.status==='COMPLETED'||it.status==='IN_PROGRESS'){ cur=Math.max(cur,it.end); prev=it; continue; }
      // 활동이 실제로 시작되는 시각은 depart(예약 시각까지 기다리면 그때) — 그 전 이동시간을 뺀 나머지가 여유다
      const free=(it.depart-it.travelIn)-cur;
      if(free>=min) out.push({
        startMin:Math.round(cur), endMin:Math.round(cur+free), minutes:Math.round(free),
        anchor:(prev&&prev.location)||state.currentLocation||state.startLocation,
        afterId:prev? prev.id : null, beforeId:it.id, beforeFixed:it.flexibility!=='FLEXIBLE'
      });
      cur=Math.max(cur,it.end); prev=it;
    }
    if(state.dayEndMin-cur>=min) out.push({
      startMin:Math.round(cur), endMin:Math.round(state.dayEndMin), minutes:Math.round(state.dayEndMin-cur),
      anchor:(prev&&prev.location)||state.currentLocation||state.startLocation,
      afterId:prev? prev.id : null, beforeId:null, beforeFixed:false
    });
    return out;
  }
  /** 창이 걸치는 식사 시간대(없으면 null). @param {FreeWindow} win @returns {any} */
  function mealOverlap(win){
    return MEAL_WINDOWS.filter(m=>win.startMin<m.to && win.endMin>m.from)[0]||null;
  }
  const MEAL_WORD=/식사|점심|저녁|브런치|런치|디너|lunch|dinner|brunch/i;
  /**
   * 그 끼니를 이미 일정이 챙기고 있는가 — 식당이거나 이름·메모가 식사를 말하는 곳이 그 시간대에 있으면 그렇다.
   * 메모가 '저녁'인 19:00 예약 앞에 "17:30 저녁 시간이 비어 있어요"를 또 넣었다(2026-10-03).
   * @param {any} state @param {any} meal MEAL_WINDOWS 하나 @returns {TripItem|null}
   */
  function mealCoveredBy(state, meal){
    if(!meal) return null;
    return state.items.filter((/**@type{TripItem}*/it)=>{
      if(it.status==='SKIPPED'||it.status==='CANCELLED') return false;
      if(!(it.depart<meal.to && Math.max(it.end, it.depart+1)>meal.from)) return false;
      const cat=LIB.spotCatOf(it.spot);
      return !!(cat && cat.id==='food') || MEAL_WORD.test(it.name+' '+String((it.spot&&it.spot.desc)||''));
    })[0]||null;
  }

  // ── 4. 후보 생성 ─────────────────────────────────────────────────
  /**
   * 다음 행동 후보. MVP는 외부 실시간 데이터 없이 사용자의 여행 데이터만 쓴다:
   * 오늘 남은 일정 + 가까운 일자의 유동 장소(옮겨올 수 있는 곳) + 휴식/복귀/식사 같은 '안 움직이는' 선택지.
   * @param {any} trip @param {any} state @param {{window?:FreeWindow, cfg?:any}=} opts
   * @returns {ActionCandidate[]}
   */
  function buildCandidates(trip, state, opts){
    const c=cfgOf(opts), days=(trip&&trip.days)||[], di=state.currentDay;
    /** @type {ActionCandidate[]} */
    const out=[];
    /** @type {any} */
    const seen=Object.create(null);
    /** @param {any} s @returns {string} */
    const nameKey=(s)=>String((s&&s.name)||'').trim().toLowerCase();
    state.items.forEach((/**@type{TripItem}*/it)=>{
      seen[nameKey(it.spot)]=1;
      if(it.status==='COMPLETED'||it.status==='SKIPPED'||it.status==='CANCELLED') return;
      if(it.flexibility==='FIXED') return;   // 고정 일정은 '추천'이 아니라 지켜야 할 약속이다
      out.push({id:'c-'+it.id, kind:(it.type==='HOTEL'?'CHECK_IN':'VISIT_PLACE'), title:it.name, location:it.location,
        // ⚠️ 제안은 '남은 시간에 들어가느냐'를 판단한다 — 소요 0은 **어떤 빈 시간에도 들어간다.**
        // 계획된 체류가 0(=안 정했거나 바로 이동)이면 제안 기준으로는 한 시간쯤 걸린다고 본다.
        durationMin:(it.stayMin>0? it.stayMin : c.suggestStayMin),
        priority:it.priority, must:!!(it.spot&&it.spot.must), hours:(it.spot&&it.spot.hours)||null,
        fromDay:null, si:it.si, inPlan:true, spot:it.spot});
    });
    /** @type {any} */
    const cities=Object.create(null);
    ((state.day&&state.day.spots)||[]).forEach((/**@type{any}*/s)=>{ if(s&&s.city) cities[s.city]=1; });
    const anyCity=Object.keys(cities).length===0;   // 오늘 계획이 비어 있으면 근처 일자에서 폭넓게 후보를 찾는다
    for(let k=0;k<days.length;k++){
      if(k===di || Math.abs(k-di)>c.lookAheadDays) continue;
      ((days[k]&&days[k].spots)||[]).forEach((/**@type{any}*/s,/**@type{number}*/si)=>{
        if(!s || s.stay || s.bookAt || s.status==='COMPLETED' || s.status==='SKIPPED' || s.status==='CANCELLED') return;
        // 공항·역은 지나가는 곳이지 둘러볼 곳이 아니다 — 다른 날의 이동 거점을 '옮겨올 관광지'로 권하지 않는다
        const cat=LIB.spotCatOf(s);
        if(cat && (cat.id==='transport' || cat.id==='stay')) return;
        if(!anyCity && !cities[s.city]) return;      // 오늘 머무는 도시가 아니면 옮겨올 후보가 아니다(오늘이 통째로 비었으면 도시 제한 없음)
        if(seen[nameKey(s)]) return;
        seen[nameKey(s)]=1;
        const cm=commitmentOf(s, days[k], (trip&&trip.bookings)||[]);
        if(cm.flexibility!=='FLEXIBLE') return;
        out.push({id:'c-d'+k+'s'+si, kind:'VISIT_PLACE', title:String(s.name||''), location:locOf(s),
          // 제안 후보의 소요는 계획된 체류가 아니다 — 모르거나 0(=바로 이동)이면 '한 시간쯤 걸린다'고 본다.
          // 오늘 장소와 같은 규칙이다: 소요 0은 어떤 빈 시간에도 들어간다
          durationMin:(+s.stayMin>0? +s.stayMin : c.suggestStayMin),
          priority:priorityOf(s, cm.flexibility), must:!!s.must, hours:s.hours||null,
          fromDay:k, si, inPlan:false, spot:s});
      });
    }
    // 움직이지 않는 선택지 — 억지로 다음 장소를 만들지 않기 위한 정상 후보
    const win=(opts&&opts.window)||null;
    const winMin=win? win.minutes : state.availableMin;
    out.push({id:'c-rest', kind:'REST', title:'조금 더 쉬기', location:null,
      durationMin:Math.min(90, Math.max(30, Math.round(winMin/2))), priority:2, must:false, hours:null, fromDay:null, si:null, inPlan:false, spot:null});
    if(state.hotelLocation) out.push({id:'c-hotel', kind:'RETURN_TO_HOTEL', title:'숙소로 돌아가기', location:state.hotelLocation,
      durationMin:0, priority:2, must:false, hours:null, fromDay:null, si:null, inPlan:false, spot:null});
    const meal=win? mealOverlap(win) : null;
    // 배고프다고 했으면 시간대와 상관없이 지금 먹는 선택지를 낸다 — "식사를 먼저 챙길게요"라고 해 놓고 식사 카드가 없었다(2026-10-03)
    if(state.prefs && state.prefs.mealFocus) out.push({id:'c-eat-now', kind:'EAT', title:'지금 식사부터 하기', location:(win?win.anchor:state.currentLocation),
      durationMin:60, priority:2, must:false, hours:null, fromDay:null, si:null, inPlan:false, spot:null});
    else if(meal && !mealCoveredBy(state, meal)) out.push({id:'c-eat-'+meal.key, kind:'EAT', title:meal.label+' 시간이 비어 있어요', location:(win?win.anchor:null),
      durationMin:60, priority:2, must:false, hours:null, fromDay:null, si:null, inPlan:false, spot:null});
    return out;
  }

  // ── 5. 순위 (deterministic) ──────────────────────────────────────
  /**
   * 후보 점수와 이유. 점수는 내부값이고 UI는 reasons만 쓴다.
   * 불가능한 후보(시간 안에 못 들어옴·영업 종료)는 아예 제외한다 — 억지 추천을 만들지 않는다.
   * @param {any} state @param {ActionCandidate[]} candidates
   * @param {{window?:FreeWindow, legMin?:any, cfg?:any, weekday?:number, exclude?:string[]}=} opts
   * @returns {NextActionCandidate[]}
   */
  function rankNextActions(state, candidates, opts){
    const o=opts||{}, c=cfgOf(o);
    /** @type {FreeWindow} */
    const win=o.window || {startMin:(state.live?state.nowMin:state.dayStartMin), endMin:state.dayEndMin,
      minutes:state.availableMin, anchor:(state.currentLocation||state.startLocation), afterId:null, beforeId:null, beforeFixed:false};
    const weekday=(o.weekday!=null)? o.weekday : state.weekday;
    /** @type {any} */
    const exclude=Object.create(null);
    (o.exclude||[]).forEach((/**@type{string}*/k)=>{ exclude[k]=1; });
    // 되돌아갈 시간과 '가는 길' 이유의 기준은 **그 빈 시간 바로 뒤의 일정**이다(2026-10-03). 지금 이후 첫 고정 일정(nextFixed)을
    // 쓰면 15시 제안이 세 시간 앞선 12:30 점심 예약의 '동선과 같은 방향'이 됐고, 여행 전 미리보기는 07:00 공항을 기준으로 삼았다.
    // 빈 시간을 따로 주지 않은 기본 창은 지금부터라 다음 고정 일정이 기준이다. 뒤에 일정이 없으면(하루 끝) 방향을 말하지 않는다.
    const targetItem=o.window
      ? (win.beforeId? (state.items.filter((/**@type{TripItem}*/it)=>it.id===win.beforeId)[0]||null) : null)
      : (state.nextFixed? (state.items.filter((/**@type{TripItem}*/it)=>it.id===state.nextFixed.itemId)[0]||null) : null);
    const targetLoc=targetItem? targetItem.location : null;
    const meal=mealOverlap(win);
    const prefs=state.prefs||{};
    const tired=state.energyLevel==='LOW', lively=state.energyLevel==='HIGH';
    const freeBefore=state.freeBefore||null;
    /** @type {NextActionCandidate[]} */
    const out=[];
    (candidates||[]).forEach((/**@type{ActionCandidate}*/cd)=>{
      if(exclude[cd.id]) return;
      /** @type {string[]} */
      const reasons=[];
      const travel=cd.location? travelMinutes(win.anchor, cd.location, o) : 0;
      const arrive=win.startMin+travel;
      const duration=Math.max(0, cd.durationMin||0);
      const finish=arrive+duration;
      let score=50;
      if(cd.kind==='REST'||cd.kind==='WAIT'){
        // 쉬자는 말은 하루가 움직인 뒤의 선택지다 — 첫 일정 전(08:53)이나 여행 전 미리보기에서 "지금 쉬어도"라고 하면
        // 할 일이 없다는 말로 읽힌다(2026-10-03 UX 검토). 지쳤거나 쉬고 싶다고 했으면 언제든 권한다.
        const started=state.completedItems.length>0 || (state.items.length>0 && state.nowMin>=state.items[0].eta);
        // 다음 일정까지 쉴 틈이 없으면 "쉬어도 괜찮아요"라고 하지 않는다 — 말했으면 그 대가를 함께 말하고 권한다(2026-10-03)
        const roomy=!freeBefore || state.availableMin>=c.restRoomMin;
        if(!tired && !prefs.wantRest && (!state.live || !started || !roomy)) return;
        score=38;
        if(tired){ score=90; reasons.push('지금은 체력을 아끼는 편이 나아요'); }
        else if(prefs.wantRest) score=state.hotelLocation? 80 : 88;
        if(prefs.wantRest && !state.hotelLocation) reasons.push('숙소 위치를 몰라 지금 있는 곳에서 쉬는 쪽을 먼저 보여 드려요');
        if(state.travelMinToday>=c.heavyTravelMin){ score+=15; reasons.push('오늘 이동이 '+Math.floor(state.travelMinToday/60)+'시간을 넘었어요'); }
        if(!freeBefore) reasons.push('남은 일정이 없어 쉬어도 밀리지 않아요');
        else if(roomy) reasons.push(freeBefore.name+'까지 '+durText(state.availableMin)+' 여유가 있어요');
        else reasons.push('쉬는 만큼 '+freeBefore.name+josa(freeBefore.name,'이','가')+' 늦어져요');
        out.push({type:'REST', id:cd.id, targetId:null, title:cd.title, score, reasons, estimatedDuration:duration,
          estimatedTravelTime:0, arriveMin:win.startMin, endMin:win.startMin+duration, fromDay:null, si:null, spot:null});
        return;
      }
      if(cd.kind==='RETURN_TO_HOTEL'){
        score=36;
        if(prefs.wantRest){ score=92; reasons.push('숙소에서 쉬었다가 이어가도 돼요'); }
        else if(tired) score=84;
        if(state.travelMinToday>=c.heavyTravelMin){ score+=14; reasons.push('오늘 이동이 많았어요'); }
        if(travel) reasons.push('숙소까지 약 '+durText(travel));
        if(freeBefore && cd.location){
          const back=travelMinutes(cd.location, freeBefore.location, o);
          if(finish+back+c.bufferMin<=freeBefore.depart) reasons.push('숙소에 들렀다 가도 '+freeBefore.name+' 시간에는 여유가 있어요');
          else reasons.push('숙소에 들르면 '+freeBefore.name+josa(freeBefore.name,'이','가')+' 늦어질 수 있어요');
        }
        if(!reasons.length) reasons.push('오늘 남은 일정을 숙소에서 이어가도 돼요');
        out.push({type:'RETURN_TO_HOTEL', id:cd.id, targetId:null, title:cd.title, score, reasons, estimatedDuration:0,
          estimatedTravelTime:travel, arriveMin:arrive, endMin:arrive, fromDay:null, si:null, spot:null});
        return;
      }
      if(cd.kind==='EAT'){
        if(cd.id==='c-eat-now'){
          // 배고프다고 했으면 지금이다 — 식사 시간대를 기다리게 하지 않는다
          const at=state.live? Math.max(state.nowMin, state.dayStartMin) : win.startMin;
          const later=state.items.filter((/**@type{TripItem}*/it)=>it.status!=='COMPLETED'&&it.status!=='SKIPPED'&&it.status!=='CANCELLED'
            && it.depart>=at && MEAL_WINDOWS.some((m)=>mealCoveredBy(state, m)===it))[0]||null;
          out.push({type:'EAT', id:cd.id, targetId:null, title:cd.title, score:95,
            reasons:['배고프다고 하셨어요 — 식사를 먼저 챙겨요',
              later? (later.name+' '+LIB.hm(later.depart)+'까지 기다리기 어렵다면 가볍게 먹어도 돼요') : '먹을 곳을 골라 지금 일정에 넣을 수 있어요'],
            estimatedDuration:duration, estimatedTravelTime:0, arriveMin:at, endMin:at+duration, fromDay:null, si:null, spot:null});
          return;
        }
        // 식사는 식사 시간대에 넣는다 — 빈 시간이 09:41에 시작해도 점심은 11:30부터다("09:41부터 비어 있어요"였다)
        const at=meal? Math.max(win.startMin, meal.from) : win.startMin;
        out.push({type:'EAT', id:cd.id, targetId:null, title:cd.title, score:46,
          reasons:[(meal? meal.label : '식사')+' 시간대에 일정이 비어 있어요', '이 시간에 식사를 넣으면 남은 일정이 밀리지 않아요'],
          estimatedDuration:duration, estimatedTravelTime:0, arriveMin:at, endMin:at+duration,
          fromDay:null, si:null, spot:null});
        return;
      }
      // 장소 방문 — 실제로 가능한지부터 확인한다
      const backMin=(cd.location&&targetLoc)? travelMinutes(cd.location, targetLoc, o) : 0;
      const deadline=win.beforeFixed? win.endMin : Math.min(win.endMin, state.dayEndMin);
      const guard=(win.beforeFixed||targetLoc)? c.bufferMin : 0;
      if(finish+backMin+guard > deadline) return;                                             // 이동시간 때문에 불가능
      if(prefs.maxTravelMin!=null && travel>prefs.maxTravelMin) return;                        // "가까운 데만" 요청은 범위를 좁힌다
      if(!cd.inPlan && travel>c.maxMoveMin) return;                                           // 옮겨올 곳이 너무 멀면 '한 곳 더'가 아니다
      if(tired && duration>c.lowEnergyMaxStayMin) return;                                     // 지쳤다면 두 시간짜리 방문은 권하지 않는다
      if(prefs.walkAverse && travel>0) score-=Math.min(14, travel*0.4);                        // 많이 걷기 싫다고 했으면 이동을 더 아낀다
      if(weekday>=0 && cd.hours && cd.hours.length){
        if(LIB.isOpenAt(cd.hours, weekday, arrive)===false) return;                            // 도착 시점에 영업 종료
        if(duration>0 && LIB.isOpenAt(cd.hours, weekday, Math.max(arrive, finish-1))===false) return;   // 머무는 중에 문 닫음
        reasons.push('도착 예정 시각에 문을 열어요');
      }
      if(travel>0){
        score+=Math.max(0, 20-travel*(lively? 0.25 : 0.5));                                   // 쌩쌩하면 이동을 덜 아낀다
        // 출발점은 창의 기준점이다 — 앞 일정이 있으면 거기서, 여행 중이고 앞 일정이 없을 때만 지금 있는 곳에서다
        reasons.push((cd.inPlan? '' : (win.afterId? '앞 일정에서 ' : (state.live? '현재 위치에서 ' : '')))+'이동 약 '+durText(travel));
      }
      if(lively){                                                                              // 쌩쌩하면 오래 둘러볼 곳을 앞에
        score+=Math.min(10, duration/12);
        if(duration>=90) reasons.push('컨디션이 좋을 때 오래 둘러보기 좋은 곳이에요');
      }
      const slack=deadline-(finish+backMin);
      score+=Math.max(0, Math.min(15, 15-Math.abs(slack-c.bufferMin)/8));
      if(cd.must){ score+=18; reasons.push('꼭 가려고 표시한 곳이에요'); }
      else if(cd.priority>=2) score+=6;
      if(cd.inPlan){ score+=8; reasons.push('원래 오늘 일정에 있던 곳이에요'); }
      else if(cd.fromDay!=null) reasons.push('Day '+(cd.fromDay+1)+' 일정에서 옮겨올 수 있어요');
      if(tired && travel>25){ score-=12; reasons.push('다만 이동이 조금 길어요'); }
      if(targetItem && targetLoc && cd.location){
        const direct=travelMinutes(win.anchor, targetLoc, o);
        const detour=Math.max(0, (travel+backMin)-direct);
        score-=Math.min(20, detour*0.4);
        // 돌아가는 시간이 바로 가는 길에 비해 작을 때만 '가는 길'이다 — 3분 거리를 두고 6분 돌아가는 곳은 반대 방향이다
        if(detour<=10 && detour<=Math.max(3, direct*0.5)) reasons.push('다음 일정 '+targetItem.name+' 가는 길에 들를 수 있어요');
      }
      if(duration) reasons.push('약 '+durText(duration)+'이면 둘러볼 수 있어요');
      out.push({type:(cd.kind==='CHECK_IN'?'CHECK_IN':'VISIT_PLACE'), id:cd.id, targetId:(cd.si!=null? String(cd.si) : null),
        title:cd.title, score:Math.round(score*100)/100, reasons, estimatedDuration:duration, estimatedTravelTime:travel,
        arriveMin:arrive, endMin:finish, fromDay:cd.fromDay, si:cd.si, spot:cd.spot});
    });
    // 같은 상태에서는 같은 순서 — 점수 → 이동시간 → id 순으로 완전 정렬
    out.sort((a,b)=> (b.score-a.score) || (a.estimatedTravelTime-b.estimatedTravelTime) || (a.id<b.id? -1 : (a.id>b.id? 1 : 0)));
    return out;
  }

  // ── 6. 일정 충돌 · 재구성 ────────────────────────────────────────
  /**
   * 남은 일정을 현재 시각부터 다시 굴려본다. 고정 일정(FIXED) 도착이 약속 시각을 넘기면 위반.
   * 머무는 중인 곳은 **남은 체류만** 더한다(2026-10-03) — 처음부터 다시 더하면 경복궁에 머무는 동안 내내 제때인 일정이
   * '115분 지연'이 됐다. 시작 시각은 지금이다 — '다녀왔어요'를 누른 곳은 계획한 종료 시각을 기다리지 않고 끝난 것이다.
   * @param {any} state @param {TripItem[]} list @param {any=} opts
   * @returns {{ok:boolean, lateBy:number, totalLate:number, endMin:number, violated:string[], first:({id:string,name:string,atMin:number,lateBy:number}|null)}}
   */
  function simulate(state, list, opts){
    let clock=state.live? Math.max(state.nowMin, state.dayStartMin) : state.dayStartMin;
    /** @type {any} */
    let prev=state.currentLocation||state.startLocation;
    let lateBy=0, totalLate=0;
    /** @type {string[]} */
    const violated=[];
    /** @type {{id:string,name:string,atMin:number,lateBy:number}|null} */
    let first=null;
    list.forEach((/**@type{TripItem}*/it)=>{
      if(state.live && it.status==='IN_PROGRESS'){
        clock=Math.max(clock, it.end);
        if(it.location) prev=it.location;
        return;
      }
      if(it.location && prev) clock+=travelMinutes(prev, it.location, opts);
      if(it.fixedAt!=null){
        if(it.flexibility==='FIXED'){
          const over=clock-it.fixedAt;
          if(over>0.5){
            const late=Math.round(over);
            lateBy=Math.max(lateBy, late); totalLate+=late; violated.push(it.id);
            if(!first) first={id:it.id, name:it.name, atMin:it.fixedAt, lateBy:late};
          }
        }
        clock=Math.max(clock, it.fixedAt);
      }
      clock+=it.stayMin;
      if(it.location) prev=it.location;
    });
    return {ok:!violated.length, lateBy, totalLate, endMin:Math.round(clock), violated, first};
  }
  /**
   * 일정 조정에서 뺄 수 있는 곳 — 유동 일정이고 꼭 가기가 아니고, 숙소·공항·역이 아니다.
   * 오늘 밤 숙소를 빼자고 하면 내일로 넘어간 숙소가 다음 날 출발점을 바꾼다(2026-10-03).
   * @param {TripItem} it @returns {boolean}
   */
  function droppable(it){
    if(it.flexibility!=='FLEXIBLE' || (it.spot&&it.spot.must) || isLodging(it.spot)) return false;
    const cat=LIB.spotCatOf(it.spot);
    return !(cat && cat.id==='transport');
  }
  /**
   * 남은 일정 재구성 후보. 순서를 지킨다: 고정 예약 보호 → 완료 일정 유지 → mustVisit 보호 →
   * 남은 시간 안에 들어오는 일정 우선 → 우선순위 낮은 일정부터 제거. 자동 적용하지 않는다(미리보기).
   * ⚠️ **늦는 약속 앞의 장소만, 꼭 필요한 만큼만** 뺀다(2026-10-03). 전에는 우선순위·늦은 순서만 보고 빼서, 북촌 하나만 빼면
   *    되는데 그 예약 **뒤의** 남산·숙소까지 뺐다. 그래서 늦는 약속마다 그 앞에서 실제로 늦음을 줄이는 곳만 고르고,
   *    다 고른 뒤에는 빼지 않아도 되게 된 곳을 되돌린다.
   * 이미 지났어야 할 곳(다녀왔다는 표시만 안 한 곳)은 다시 굴리지 않는다 — '다음'(nextItem)과 같은 규칙이다.
   * @param {any} state @param {{legMin?:any, cfg?:any}=} opts
   * @returns {{needed:boolean, feasible:boolean, keep:string[], drop:string[], dropNames:string[], lateBy:number, impact:SuggestionImpact, before:string[], after:string[], lateAt:({id:string,name:string,atMin:number,lateBy:number}|null), remainingLateBy:number}}
   */
  function generateReplan(state, opts){
    const pending=state.items.filter((/**@type{TripItem}*/it)=>it.status!=='COMPLETED'&&it.status!=='SKIPPED'&&it.status!=='CANCELLED'
      && (!state.live || it.end>state.nowMin || it.depart>=state.nowMin));
    const base=simulate(state, pending, opts);
    let keep=pending.slice();
    /** @type {TripItem[]} */
    const drop=[];
    let r=base;
    /** @param {TripItem[]} list @param {TripItem} out @returns {TripItem[]} */
    const without=(list, out)=>list.filter((it)=>it.id!==out.id);
    // 머무는 중인 곳은 마지막에 뺀다(지금 있는 곳을 내일로 미루는 건 마지막 수단) → 우선순위 낮은 것 → 약속에 가까운(늦은) 것부터
    /** @param {TripItem} a @param {TripItem} b @returns {number} */
    const order=(a,b)=> ((a.status==='IN_PROGRESS'?1:0)-(b.status==='IN_PROGRESS'?1:0)) || (a.priority-b.priority) || (b.si-a.si);
    for(let guard=0; !r.ok && guard<pending.length; guard++){
      /** @type {TripItem|null} */
      let victim=null;
      /** @type {any} */
      let trialBest=null;
      for(const vid of r.violated){                                // 앞의 약속부터
        const at=keep.findIndex((/**@type{TripItem}*/it)=>it.id===vid);
        const pool=keep.slice(0, Math.max(0, at)).filter(droppable).sort(order);
        for(const cand of pool){
          const trial=simulate(state, without(keep, cand), opts);
          if(trial.totalLate<r.totalLate){ victim=cand; trialBest=trial; break; }   // 실제로 늦음을 줄이는 곳만
        }
        if(victim) break;
      }
      if(!victim) break;
      keep=without(keep, victim); drop.push(victim); r=trialBest;
    }
    // 빼지 않아도 되게 된 곳은 되돌린다 — 나중에 뺀 것(우선순위가 높은 것)부터
    for(let k=drop.length-1; k>=0; k--){
      const back=drop[k];
      const trial=pending.filter((/**@type{TripItem}*/it)=>it===back || keep.indexOf(it)>=0);
      const res=simulate(state, trial, opts);
      if(res.totalLate<=r.totalLate){ keep=trial; r=res; drop.splice(k,1); }
    }
    return {
      needed:!base.ok, feasible:r.ok,
      keep:keep.map((/**@type{TripItem}*/it)=>it.id), drop:drop.map((/**@type{TripItem}*/it)=>it.id),
      dropNames:drop.map((/**@type{TripItem}*/it)=>it.name), lateBy:base.lateBy,
      before:pending.map((/**@type{TripItem}*/it)=>it.name), after:keep.map((/**@type{TripItem}*/it)=>it.name),
      impact:{timeChangeMinutes:r.endMin-base.endMin, removedActivities:drop.map((/**@type{TripItem}*/it)=>it.name), addedActivities:[]},
      // 사람에게 말할 때 쓰는 값(계약에는 lateBy만 실린다) — 어느 약속에 얼마나 늦는지, 줄여도 남는 늦음
      lateAt:base.first, remainingLateBy:r.lateBy
    };
  }

  // ── 7. 제안 (모든 기능이 공유하는 형태) ──────────────────────────
  /** 같은 제안을 하루 안에서 다시 만들지 않기 위한 안정 키. @param {string} type @param {string} what @param {any} state @returns {string} */
  function suggestionKey(type, what, state){
    return [state.tripId||'-', state.todayISO||('d'+state.currentDay), type, what].join('|');
  }
  /**
   * 화면에 보여줄 제안 목록. 재구성(고정 예약 위험)이 최우선이고, 그다음 다음 행동, 마지막이 가격 절약.
   * 가격 절약도 같은 '상태→제안→반영' 패턴을 쓰므로 별도 서브앱이 아니라 이 목록에 함께 들어온다.
   * @param {any} trip @param {any} state
   * @param {{legMin?:any, cfg?:any, dismissed?:string[], exclude?:string[], priceSuggestions?:any[], window?:FreeWindow}=} opts
   * @returns {{suggestions:TripSuggestion[], windows:FreeWindow[], replan:any, ranked:NextActionCandidate[], window:(FreeWindow|null), empty:boolean, notice:(string|null)}}
   */
  function buildSuggestions(trip, state, opts){
    const o=opts||{}, c=cfgOf(o);
    /** @type {any} */
    const dismissed=Object.create(null);
    (o.dismissed||[]).forEach((/**@type{string}*/k)=>{ dismissed[k]=1; });
    const windows=findFreeWindows(state, o);
    const replan=generateReplan(state, o);
    const win=o.window || windows[0] || null;
    // '한 곳 더'는 새 장소만이다 — 그날 일정에 이미 있는 곳(현재·완료·남은 장소)은 '다음' 카드와
    // 일정 조정(REPLAN)의 몫이다. 넣으면 "공항에 한 곳 더 들르세요"가 된다(2026-10-02 UX 검토). fillGaps와 같은 규칙.
    // exclude는 같은 화면의 하루 흐름에서 '다른 제안'으로 물린 후보다 — 두 카드가 같은 제외 목록을 쓴다(2026-10-03).
    const ranked=rankNextActions(state, buildCandidates(trip, state, {window:(win||undefined), cfg:c}).filter((cd)=>!cd.inPlan),
      {window:(win||undefined), legMin:o.legMin, cfg:c, exclude:o.exclude});
    /** @type {TripSuggestion[]} */
    const out=[];
    const cap=c.maxSuggest+1;   // 재구성/가격은 '다음 행동' 3개와 별개로 한 자리 더 허용
    /** @param {TripSuggestion} s */
    const push=(s)=>{ if(!dismissed[s.key] && out.length<cap) out.push(s); };

    // 일정 조정은 **바꿀 것이 있을 때만** 카드가 된다(2026-10-03) — 뺄 수 있는 곳이 없으면 '기존'과 '제안'이 똑같은 카드가 떴다.
    // 그때도 늦는다는 사실은 사라지지 않는다: replan.needed가 그대로라 하루 한 마디(tripPulse)와 화면 안내(notice)가 말한다.
    const late=replan.lateAt;
    const lateLine=late? ('이대로면 '+late.name+' '+LIB.hm(late.atMin)+' 예약에 '+durText(late.lateBy)+' 늦어요') : '';
    if(replan.needed && replan.drop.length){
      const names=replan.dropNames.join(', '), last=replan.dropNames[replan.dropNames.length-1];
      const key=suggestionKey('REPLAN', replan.drop.join(','), state);
      push({id:key, key, type:'REPLAN',
        // 아직 늦지 않았다 — '지연'·'밀렸어요'가 아니라 '이대로면 늦는다'고 말한다. 조정이 통하는지에 따라 제목과 설명이 맞물린다
        title:lateLine,
        description:replan.feasible
          ? names+josa(last,'을','를')+' 빼면 '+(late? late.name+' 예약 시간에 맞출 수 있어요' : '예약 시간에 맞출 수 있어요')
          : names+josa(last,'을','를')+' 빼도 '+durText(replan.remainingLateBy)+'쯤 늦어요 — 예약 시간을 바꾸거나 미리 알려 두는 편이 나아요',
        reasons:[late? ('남은 일정을 지금부터 이어 가면 '+late.name+'에 '+LIB.hm(late.atMin+late.lateBy)+'쯤 닿아요') : '남은 일정을 지금부터 다시 이어 봤어요',
          '예약 시각은 그대로 지켜요', '다녀온 곳은 그대로 둬요'],
        impact:replan.impact, status:'NEW', action:{kind:'REPLAN', drop:replan.drop, keep:replan.keep}});
    }
    // 이대로면 늦는 날에 J가 먼저 일정을 더하자고 하지 않는다 — 한쪽은 빼자, 한쪽은 더하자가 됐다(2026-10-03).
    // 사람이 직접 말한 것(지쳤어요·배고파·숙소로)만 답한다.
    const prefs=state.prefs||{};
    const asked=(/**@type{NextActionCandidate}*/r)=> (r.type==='REST' && (state.energyLevel==='LOW'||prefs.wantRest))
      || (r.type==='RETURN_TO_HOTEL' && (state.energyLevel==='LOW'||prefs.wantRest)) || (r.type==='EAT' && prefs.mealFocus);
    const roomy=!state.freeBefore || state.availableMin>=c.restRoomMin;
    // 거절한 것을 먼저 빼고 자른다 — 자르고 빼면 '다른 제안 보기'가 다른 제안 대신 빈 자리를 보여 줬다
    ranked.filter((r)=>!dismissed[suggestionKey(r.type, r.title, state)] && (!replan.needed || asked(r))).slice(0, c.maxSuggest).forEach((r)=>{
      const key=suggestionKey(r.type, r.title, state);
      push({id:key, key, type:((r.type==='REST'||r.type==='RETURN_TO_HOTEL')? 'REST' : (r.type==='EAT'? 'NEXT_ACTIVITY' : 'NEXT_ACTIVITY')),
        title:r.title,
        // 이동 시간은 일정 화면과 같은 함수로 내지만 조회되지 않은 구간은 거리로 낸 추정이다 — '약'을 붙인다(2026-10-03)
        description:(r.type==='VISIT_PLACE'||r.type==='CHECK_IN')
          ? ((r.estimatedTravelTime? '약 '+durText(r.estimatedTravelTime)+' 이동 · ' : '')+LIB.hm(r.arriveMin)+' 도착 · '+LIB.hm(r.endMin)+'까지')
          : (r.type==='EAT'? (LIB.hm(r.arriveMin)+'부터 식사를 넣을 수 있어요')
            : (roomy? '지금 쉬어도 남은 일정에는 여유가 있어요' : '쉬는 만큼 남은 일정이 늦어져요 — 무리하지 않는 쪽이 나아요')),
        reasons:r.reasons,
        impact:{timeChangeMinutes:r.estimatedDuration+r.estimatedTravelTime, addedActivities:(r.spot?[r.title]:[]), removedActivities:[]},
        status:'NEW', action:{kind:r.type, si:r.si, fromDay:r.fromDay, candidateId:r.id, startMin:(r.type==='EAT'? r.arriveMin : (win? win.startMin : state.nowMin))}});
    });
    (o.priceSuggestions||[]).forEach((/**@type{any}*/p)=>{
      const key=suggestionKey('PRICE_SAVING', String(p.bookingId||p.title||''), state);
      push({id:key, key, type:'PRICE_SAVING', title:String(p.title||''), description:String(p.description||''),
        reasons:(Array.isArray(p.reasons)? p.reasons : []), impact:(p.impact||{costChange:num(p.costChange,0)}),
        status:'NEW', action:{kind:'OPEN_BOOKING', bookingId:p.bookingId}});
    });
    // 조정 카드 없이 늦는 경우 화면이 그대로 옮길 한 줄 — 뺄 수 있는 곳이 없거나 그 카드를 오늘 건너뛰었을 때
    const notice=(replan.needed && !out.some((s)=>s.type==='REPLAN') && late)
      ? lateLine+(replan.drop.length? '' : ' — 뺄 수 있는 일정이 없어요. 예약 시간을 바꾸거나 미리 알려 두는 편이 나아요') : null;
    return {suggestions:out, windows, replan, ranked, window:win, empty:!out.length, notice};
  }
  /** 추천 반응 기록 — 향후 선호 학습용 구조만 준비한다. @param {any} sug @param {string} action @param {string} atISO @returns {any} */
  function feedbackEntry(sug, action, atISO){
    return {recommendationId:(sug&&sug.id)||'', key:(sug&&sug.key)||'', type:(sug&&sug.type)||'',
      action:((action==='ACCEPTED'||action==='SKIPPED'||action==='DISMISSED'||action==='REPLACED')? action : 'DISMISSED'),
      createdAt:String(atISO||'')};
  }

  // ── 8. 자연어 요청 해석 ────────────────────────────────────────
  // AI가 일정 계산을 대신하지 않는다. 자연어는 "무엇을 원하는지"를 옵션으로 바꾸는 데까지만 쓰고,
  // 충돌·운영시간·이동시간 같은 판단은 그대로 deterministic 로직이 한다.
  // 여기서는 외부 모델 없이도 동작하는 규칙 해석기를 둔다(모델을 붙이면 같은 형태의 결과를 주면 된다).
  // ⚠️ 낱말 하나로 조건을 만들지 않는다(2026-10-02) — '걷는 건'·'많이 걷'은 "걷는 건 괜찮아"·"많이 걷고 싶어"에도
  //    걸려 정반대로 읽었다. 걷기는 싫다·힘들다는 말이 붙어야 제한이고, '괜찮아'는 컨디션 규칙이 아니다(아래 FINE_RE).
  //    '기운'도 같다 — 나다·넘치다가 붙어야 좋다는 말이고, 없다가 붙으면("기운이 하나도 없어") 피곤하다는 말이다.
  // ⚠️ 말과 서술 사이에는 정도를 말하는 부사(좀·너무·하나도…)가 흔히 낀다 — 바로 붙은 꼴만 보면 "기운이 좀 없어"가 빠진다.
  // ⚠️ 부정이 붙어야 뜻이 서는 말은 그 꼴을 **같은 규칙의 앞쪽**에 둔다 — "무리하지 말자"는 쉬자는 말인데, '무리'가 먼저
  //    걸리면 뒤의 '말자'를 그 말의 부정으로 보고 버린다(saidPlainly는 같은 자리에서 먼저 걸린 꼴만 본다).
  const INTENT_RULES=Object.freeze([
    Object.freeze({re:/무리\s*(?:하지|하진|하고\s*싶지)\s*(?:말|않|마)|무리\s*안\s*(?:하|해|할)|피곤|지쳤|지침|힘들|무리|쉬고\s*싶|쉴래|쉬자|기운\s*[이가도]?\s*(?:(?:하나도|전혀|별로|너무|좀|영|진짜|정말)\s*)?(?:없|안\s*나|나(?:지|질)\s*않)/, apply:{energyLevel:'LOW'}, why:'쉬고 싶다고 하셨어요'}),
    Object.freeze({re:/(?:(?:많이|오래)\s*)?걷(?:고\s*싶지\s*않|지\s*(?:말|않(?!았)|마))|걷(?:기|는\s*(?:건|게|거))\s*[은는이가도]?\s*(?:(?:좀|너무|조금|많이|정말|진짜)\s*)?(?:싫|힘들|힘드|무리|별로)|안\s*걷/, apply:{walkAverse:true, maxTravelMin:20}, why:'많이 걷지 않는 쪽으로 볼게요'}),
    Object.freeze({re:/가까운\s*(곳|데)|멀리\s*(가기)?\s*싫|근처(에서)?/, apply:{maxTravelMin:15}, why:'가까운 곳만 볼게요'}),
    Object.freeze({re:/쌩쌩|팔팔|기운\s*[이가도]?\s*(?:(?:좀|너무|많이|진짜|정말)\s*)?(?:나|넘|좋|펄펄|차|있|솟)|더\s*보고|많이\s*보고|부지런/, apply:{energyLevel:'HIGH'}, why:'컨디션이 좋다고 하셨어요'}),
    Object.freeze({re:/배고|밥|먹고|식사|점심|저녁\s*먹/, apply:{mealFocus:true}, why:'식사를 먼저 챙길게요'}),
    Object.freeze({re:/숙소|호텔로|들어가고\s*싶|집에/, apply:{wantRest:true}, why:'숙소로 돌아가는 쪽을 먼저 볼게요'})
  ]);
  // '괜찮다'는 그 자체로 컨디션을 말하지 않는다 — 무엇이 괜찮은지 모른다. 다만 피곤하다는 말과 같이 오면
  // ("피곤하긴 한데 괜찮아") 어느 쪽인지 단정하지 않는다.
  // ⚠️ 다른 것이 괜찮다는 말은 컨디션이 아니다 — "가까운 데면 괜찮아"·"걷는 건 괜찮아"·"택시 타도 괜찮아"는 피곤하다는
  //    말을 지우지 않는다. 바로 앞 어절이 조건(-면)·대상(건·게·거·것)·양보(-도)로 끝나면 그 대상에 대한 말로 본다.
  const FINE_RE=/괜찮/;
  const FINE_OF_OTHER=/(?:면|[건게거도]|것[은이도]?)\s*$/;
  // 부정 — 규칙은 낱말을 보지만 사람은 "하나도 안 피곤해"·"배고프지 않아"라고도 말한다(2026-10-02).
  // 부정이 **그 말에 붙어 있으면** 그 말은 하지 않은 것으로 본다. 반대 뜻으로 뒤집지는 않는다("안 쌩쌩해"는 피곤하다는 말이 아니다).
  // 붙어 있다는 것은 바로 앞 어절의 '안'·'못', 또는 바로 뒤의 활용이다.
  // ⚠️ 뒤쪽은 그 말의 활용까지만 본다 — "피곤해서 안 갈래"의 '안'은 '가다'의 부정이지 '피곤'의 것이 아니다.
  //    예외는 식사 낱말 뒤의 '먹다' 하나다("밥 먹고 싶지 않아"의 부정은 '밥'의 것이다).
  // ⚠️ '안·못 먹었다'는 부정이 아니다 — "아직 점심 안 먹었어"는 배고프다는 말이다(과거형만. "밥 안 먹을래"는 부정이다).
  const NEG_BEFORE=/(?:^|[^가-힣])(?:안|못)\s*$/;
  const NEG_EAT='(?:\\s*먹(?:고|을|는))?';
  const NEG_DEGREE='(?:(?:하나도|전혀|별로|너무|좀|영)\\s*)?';
  const NEG_AFTER=new RegExp('^(?:'+[
    NEG_EAT+'\\s?[가-힣]{0,2}?(?:지(?:는|도)?|진|질)\\s*(?:않|못|마|말)',      // 피곤하지 않아 · 배고프진 않은데 · 밥 먹고 싶지 않아
    NEG_EAT+'\\s?[가-힣]{0,2}?\\s*(?:건|게|거|것)[은이]?\\s*(?:아니(?!면)|아냐)', // 피곤한 건 아니야 · 더 보고 싶은 건 아니야
    NEG_EAT+'(?:\\s*생각)?\\s*[이가은는도]?\\s*'+NEG_DEGREE+'없',               // 밥 생각 없어 · 밥 먹을 생각이 별로 없어
    '\\s*[은는이가도을를에]?\\s*(?:안|못)(?!\\s*(?:먹었|먹은|했))(?:\\s|[해하먹가돼되])', // 피곤 안 해 · 밥은 안 먹어 (숙소 '안에서'는 아니다)
    '\\s*[은는]?\\s*(?:말고|별로)'                                             // 밥 말고 · 숙소는 별로
  ].join('|')+')');
  /**
   * 문장에 그 말이 부정 없이 한 번이라도 나오는지. "안 피곤하다고 했지만 사실 피곤해"는 피곤하다는 말이다.
   * `notAfter`가 그 말 바로 앞에 맞으면 그 자리는 세지 않는다(다른 것에 대한 말 — FINE_OF_OTHER).
   * @param {string} t @param {RegExp} re @param {RegExp=} notAfter @returns {boolean}
   */
  function saidPlainly(t, re, notAfter){
    const g=new RegExp(re.source, 'g');
    for(let m=g.exec(t); m; m=g.exec(t)){
      if(!m[0]){ g.lastIndex++; continue; }
      const before=t.slice(0, m.index);
      if(notAfter && notAfter.test(before)) continue;
      if(!NEG_BEFORE.test(before) && !NEG_AFTER.test(t.slice(m.index+m[0].length))) return true;
    }
    return false;
  }
  /**
   * "오늘 좀 피곤해서 많이 걷기 싫어" → {energyLevel:'LOW', walkAverse:true, maxTravelMin:20}.
   * 해석하지 못하면 빈 결과를 준다 — 못 알아들은 것을 알아들은 척하지 않는다.
   * 부정된 말은 하지 않은 것으로 보고, 컨디션이 엇갈리면("피곤한데 더 보고 싶어") 정하지 않는다 —
   * 나중 규칙이 이기게 두면 같은 문장이 낱말 순서에 따라 정반대 컨디션이 된다.
   * @param {string} text
   * @returns {{energyLevel:(EnergyLevel|null), prefs:any, reasons:string[], understood:boolean}}
   */
  function parseIntent(text){
    const t=String(text==null?'':text).trim();
    /** @type {any} */ const prefs={};
    /** @type {string[]} */ const reasons=[];
    const said=t? INTENT_RULES.filter((r)=>saidPlainly(t, r.re)) : [];
    /** @type {string[]} */ const levels=[];
    said.forEach((r)=>{ const lv=/** @type {any} */(r.apply).energyLevel; if(lv && levels.indexOf(lv)<0) levels.push(lv); });
    if(levels.indexOf('LOW')>=0 && saidPlainly(t, FINE_RE, FINE_OF_OTHER)) levels.push('FINE');
    /** @type {EnergyLevel|null} */ const energyLevel=levels.length===1? /** @type {any} */(levels[0]) : null;
    said.forEach((r)=>{
      const apply=/** @type {any} */(r.apply);
      if(apply.energyLevel && !energyLevel) return;   // 단정하지 않은 컨디션은 이유로도 말하지 않는다
      reasons.push(r.why);
      Object.keys(apply).forEach((k)=>{
        if(k==='energyLevel') return;
        const v=apply[k];
        if(k==='maxTravelMin' && prefs.maxTravelMin!=null) prefs.maxTravelMin=Math.min(prefs.maxTravelMin, v);   // 더 좁은 요구를 따른다
        else prefs[k]=v;
      });
    });
    return {energyLevel, prefs, reasons, understood:reasons.length>0};
  }

  /** 화면이 고른 컨디션. 모르는 값은 보통으로 — 계약 밖의 문자열이 점수 계산에 들어가지 않게. @param {unknown} v @returns {EnergyLevel} */
  function normEnergy(v){ const s=String(v==null?'':v).toUpperCase(); return (s==='LOW'||s==='HIGH')?/** @type {any} */(s):'NORMAL'; }

  /**
   * 문장과 **이미 고른 컨디션**을 합쳐 이번 추천에 쓸 옵션을 정한다.
   *
   * 규칙 둘 — 웹(`applyIntent`)과 서버(`/api/v1/.../today`)가 같은 답을 내야 한다:
   * - **컨디션은 문장이 말했을 때만 덮어쓴다.** 안 말했으면 버튼으로 고른 값이 남는다
   *   ("가까운 데만" 한 마디에 컨디션이 보통으로 돌아가면 안 된다).
   * - **조건은 문장이 통째로 정한다.** 앞 문장의 조건은 남지 않는다 —
   *   "많이 걷기 싫어" 뒤에 "밥 먹자"라고 하면 지금 원하는 건 밥이지 걷기 제한이 아니다.
   *
   * @param {string} text  사람이 쓴 문장. 비어 있으면 해석하지 않고 고른 컨디션만 돌려준다
   * @param {{energyLevel?:unknown}=} base  화면이 이미 고른 값
   * @returns {{energyLevel:EnergyLevel, prefs:any, reasons:string[], understood:boolean}}
   */
  function resolveIntent(text, base){
    const picked=normEnergy((base||{}).energyLevel);
    const t=String(text==null?'':text).trim();
    if(!t) return {energyLevel:picked, prefs:{}, reasons:[], understood:false};
    const r=parseIntent(t);
    return {energyLevel:r.energyLevel||picked, prefs:r.prefs, reasons:r.reasons, understood:r.understood};
  }

  // ── 9. 출발 안내 ─────────────────────────────────────────────────
  /**
   * "18:40쯤 출발하면 19:00 예약에 맞춰요" / "지금 출발하면 약 5분 여유가 있어요" / "지금 출발해도 약 12분 늦어요".
   * ⚠️ **늦음과 여유는 약속이 있을 때만 말한다**(2026-10-03) — 예약(bookAt)이나 내가 정한 도착 시각(at)이 있는 곳만이다.
   *    예약도 정한 시각도 없는 북촌에 빨간 '지금 출발해도 약 5분 늦어요'가 떴다. 그 밖의 곳은 사실만 말한다("지금 출발하면 11:18 도착").
   *    도착 예정(eta)은 계획을 이어 붙인 값일 뿐이라, 앞서 끝낸 사람을 그 시각까지 기다리게 하지 않는다.
   * 지금 머무는 곳은 떠날 곳이 아니다 — 안내하지 않는다(null).
   * @param {any} state @param {TripItem} item @param {number} travelMin
   * @returns {{leaveMin:number, slackMin:number, level:('EARLY'|'NOW'|'LATE'), text:string}|null}
   */
  function departureAdvice(state, item, travelMin){
    if(!item) return null;
    const travel=Math.max(0, Math.round(num(travelMin,0)));
    const fixed=item.fixedAt!=null;
    const target=(item.fixedAt!=null? item.fixedAt : item.eta);
    const leaveMin=Math.round(target-travel);
    if(!state.live) return {leaveMin, slackMin:0, level:'EARLY', text:LIB.hm(leaveMin)+'쯤 출발하는 일정이에요'};
    if(item.status==='IN_PROGRESS') return null;
    if(!fixed){
      // 하루를 아직 시작하지 않았으면 계획을 말한다 — 아침 8시에 "지금 출발하면"이라고 재촉하지 않는다
      if(!state.completedItems.length && state.nowMin<leaveMin)
        return {leaveMin, slackMin:Math.round(leaveMin-state.nowMin), level:'EARLY', text:LIB.hm(leaveMin)+'쯤 출발하는 일정이에요'};
      return {leaveMin:state.nowMin, slackMin:0, level:'NOW', text:'지금 출발하면 '+LIB.hm(state.nowMin+travel)+' 도착'};
    }
    const what=(item.spot&&item.spot.bookAt)? '예약' : '도착';
    const slackMin=Math.round(leaveMin-state.nowMin);
    if(slackMin<0) return {leaveMin, slackMin, level:'LATE', text:'지금 출발해도 약 '+durText(-slackMin)+' 늦어요'};
    if(slackMin===0) return {leaveMin, slackMin, level:'NOW', text:'지금 바로 나서야 '+LIB.hm(target)+' '+what+'에 맞춰요'};
    if(slackMin<=10) return {leaveMin, slackMin, level:'NOW', text:'지금 출발하면 약 '+slackMin+'분 여유가 있어요'};
    // 기다리라는 말이 아니다 — 그 사이가 비어 있다는 말이다(아래 제안이 그 시간을 채운다)
    return {leaveMin, slackMin, level:'EARLY', text:LIB.hm(leaveMin)+'쯤 출발하면 '+LIB.hm(target)+' '+what+'에 맞춰요 · 그 전까지 '+durText(slackMin)+' 여유가 있어요'};
  }

  // ── 10. 빈칸 채우기 (Assisted) · 하루 flow (Delegated) ──────────
  // 사람이 그날을 가볍게 보내겠다고 적어 둔 날 — 메모·제목이 그렇게 말하면 빈칸을 한 곳만 채운다(2026-10-03).
  // 샘플 도착일 메모는 '시차적응 겸 가벼운 일정'인데 하루 채우기가 다음 날 명소 셋을 18:25까지 채웠다.
  const LIGHT_DAY_RE=/가볍|가벼운|여유롭|쉬엄|휴식|시차/;
  /** @param {any} day @returns {boolean} */
  function isLightDay(day){ return !!day && LIGHT_DAY_RE.test(String(day.note||'')+' '+String(day.title||'')); }
  /**
   * 빈 시간을 "한 칸"이 아니라 있는 만큼 채운 미리보기. 이미 오늘 일정에 있는 곳은 후보에서 뺀다
   * (이미 잡혀 있는 것을 다시 넣는 건 채우기가 아니다). 저장하지 않는다 — 미리보기다.
   * 같은 화면의 제안 카드에서 거절한 것(dismissed — 제안 키)도 넣지 않는다 — 두 카드가 같은 제외 목록을 쓴다(2026-10-03).
   * 이대로면 예약에 늦는 날에는 더 넣지 않는다(blocked) — 일정 조정 제안과 서로 반대 말을 하지 않게.
   * @param {any} trip @param {any} state @param {{legMin?:any, cfg?:any, maxPerWindow?:number, exclude?:string[], dismissed?:string[]}=} opts
   * @returns {{slots:{startMin:number,endMin:number,afterId:(string|null),pick:NextActionCandidate}[], impact:SuggestionImpact, blocked:(string|null), light:boolean}}
   */
  function fillGaps(trip, state, opts){
    const o=opts||{}, c=cfgOf(o), light=isLightDay(state.day);
    const maxPer=num(o.maxPerWindow, light? 1 : 3), maxTotal=light? 1 : Infinity;
    const skip=o.exclude||[];   // '다른 제안'으로 이미 물린 후보
    /** @type {any} */
    const dismissed=Object.create(null);
    (o.dismissed||[]).forEach((/**@type{string}*/k)=>{ dismissed[k]=1; });
    /** @type {string[]} */ const used=[];
    /** @type {any[]} */ const slots=[];
    const blocked=generateReplan(state, o).needed? 'REPLAN' : null;
    const windows=blocked? [] : findFreeWindows(state, o);
    windows.forEach((win)=>{
      let cursor=win.startMin, anchor=win.anchor;
      for(let n=0;n<maxPer && slots.length<maxTotal;n++){
        /** @type {FreeWindow} */
        const sub={startMin:cursor, endMin:win.endMin, minutes:win.endMin-cursor, anchor,
          afterId:win.afterId, beforeId:win.beforeId, beforeFixed:win.beforeFixed};
        if(sub.minutes<30) break;
        const cands=buildCandidates(trip, state, {window:sub, cfg:c})
          .filter((cd)=>used.indexOf(cd.id)<0 && skip.indexOf(cd.id)<0 && !cd.inPlan && cd.kind!=='REST' && cd.kind!=='RETURN_TO_HOTEL');
        const pick=rankNextActions(state, cands, {window:sub, legMin:o.legMin, cfg:c})
          .filter((r)=>!dismissed[suggestionKey(r.type, r.title, state)])[0];
        if(!pick) break;
        used.push(pick.id);
        slots.push({startMin:pick.arriveMin, endMin:pick.endMin, afterId:win.afterId, pick});
        cursor=pick.endMin;
        if(pick.spot) anchor=locOf(pick.spot)||anchor;
      }
    });
    return {slots, impact:{addedActivities:slots.map((x)=>x.pick.title), removedActivities:[],
      timeChangeMinutes:slots.reduce((a,x)=>a+x.pick.estimatedDuration+x.pick.estimatedTravelTime,0)}, blocked, light};
  }

  const DAY_SEGMENTS=Object.freeze([Object.freeze({key:'morning',label:'오전',to:11*60+30}),
    Object.freeze({key:'lunch',label:'점심',to:13*60+30}), Object.freeze({key:'afternoon',label:'오후',to:17*60+30}),
    Object.freeze({key:'evening',label:'저녁',to:24*60})]);
  /** @param {number} min @returns {string} */
  function segmentLabel(min){ for(const seg of DAY_SEGMENTS) if(min<seg.to) return seg.label; return '저녁'; }
  /**
   * "오늘 하루 추천해줘" — 지금(또는 일자 시작)부터 하루 끝까지의 흐름.
   * 고정 예약은 그대로 자리에 두고 그 사이를 채운다. 한 번 만들고 끝이 아니라 상태가 바뀌면 다시 만든다.
   * 남은 계획도 함께 그린다(PLANNED) — 더하는 것만 SUGGESTED다(2026-10-03). 전에는 고정 예약과 제안만 그려서
   * 북촌·광장시장·남산이 남은 날을 '창덕궁 → 저녁 → 명동교자'로 보여 줬다.
   * @param {any} trip @param {any} state @param {{legMin?:any, cfg?:any, exclude?:string[], dismissed?:string[]}=} opts
   * @returns {{blocks:any[], picks:NextActionCandidate[], empty:boolean, impact:SuggestionImpact, blocked:(string|null), light:boolean}}
   */
  function planDayFlow(trip, state, opts){
    const fill=fillGaps(trip, state, opts);
    /** @type {any[]} */ const blocks=[];
    state.items.forEach((/**@type{TripItem}*/it)=>{
      if(it.status==='COMPLETED'||it.status==='SKIPPED'||it.status==='CANCELLED') return;
      if(state.live && it.end<=state.nowMin && it.depart<state.nowMin) return;   // 이미 지난 곳은 '오늘 할 일'이 아니다
      const fixed=it.flexibility!=='FLEXIBLE';
      const at=(fixed && it.fixedAt!=null)? it.fixedAt : it.eta;
      blocks.push({kind:fixed? 'FIXED' : 'PLANNED', startMin:at, endMin:it.end, title:it.name, itemId:it.id, segment:segmentLabel(at)});
    });
    fill.slots.forEach((/**@type{any}*/sl)=>{
      blocks.push({kind:'SUGGESTED', startMin:sl.startMin, endMin:sl.endMin, title:sl.pick.title,
        afterId:sl.afterId, pick:sl.pick, segment:segmentLabel(sl.startMin)});
    });
    blocks.sort((a,b)=> (a.startMin-b.startMin) || (a.title<b.title? -1 : (a.title>b.title? 1 : 0)));
    return {blocks, picks:fill.slots.map((/**@type{any}*/x)=>x.pick), empty:!blocks.some((b)=>b.kind==='SUGGESTED'), impact:fill.impact,
      blocked:fill.blocked, light:fill.light};
  }
  // ── 11. 출발 계획 · Trip Pulse · 알림 계획 ──────────────────────
  //
  // 여기부터는 "앱을 열지 않아도 다음을 이어준다"를 위한 계산이다. 판단은 전부 이 파일에 있고
  // iOS와 서버는 결과만 쓴다 — 두 곳에서 따로 계산하면 잠금화면과 앱 화면이 다른 말을 하게 된다.

  /** 일정 성격별 안전 여유(분). 열차를 관광지와 같은 여유로 다루면 놓친다. @type {Record<string,number>} */
  const SAFETY_BUFFER = Object.freeze({
    FLIGHT: 120,      // 수속·보안 — 이 값만으로 충분하지 않으므로 UI는 별도 안내를 함께 낸다
    TRAIN: 30,
    CAR: 20,          // 렌터카 픽업 — 서류·차량 확인
    RESTAURANT: 15,
    TOUR: 15,
    HOTEL: 10,
    OTHER: 10
  });
  /**
   * 이 일정에 붙일 안전 여유. 사용자가 정한 값(spot.bufferMin)이 있으면 그것이 이긴다.
   * @param {any} item TripItem @param {any=} opts
   * @returns {number}
   */
  function safetyBufferFor(item, opts){
    const custom = item && item.spot && item.spot.bufferMin;
    if(custom!=null && isFinite(+custom) && +custom>=0) return Math.min(240, Math.round(+custom));
    const over = (opts&&opts.buffers)||null;
    const type = (item&&item.type)||'OTHER';
    if(over && over[type]!=null && isFinite(+over[type])) return Math.max(0, Math.round(+over[type]));
    return SAFETY_BUFFER[type]!=null? SAFETY_BUFFER[type] : SAFETY_BUFFER.OTHER;
  }

  /**
   * 출발 계획 — 권장 출발시각 = 약속시각 − 이동시간 − 안전여유.
   * 단계(UPCOMING → READY_TO_LEAVE → LATE_RISK)는 알림을 "상태가 바뀔 때만" 보내기 위한 것이다(§15).
   * ⚠️ 약속(예약·내가 정한 도착 시각)이 없는 곳은 재촉하지 않는다(2026-10-03, `departureAdvice`와 같은 규칙) — 계획을 이어 붙인
   *    도착 예정만 보고 "지금 출발해도 늦어요" 알림을 보내면 거짓 경보다. 그런 곳은 언제나 UPCOMING이라 알림이 나가지 않는다.
   *    지금 머무는 곳은 떠날 곳이 아니다(null).
   * @param {any} state @param {any} item TripItem @param {number} travelMin @param {any=} opts
   * @returns {{leaveMin:number, slackMin:number, bufferMin:number, travelMin:number, level:('EARLY'|'NOW'|'LATE'), stage:('UPCOMING'|'READY_TO_LEAVE'|'LATE_RISK'), lateByMin:number, text:string, targetMin:number}|null}
   */
  function departurePlan(state, item, travelMin, opts){
    if(!item) return null;
    const c=cfgOf(opts);
    const travel=Math.max(0, Math.round(num(travelMin,0)));
    const bufferMin=safetyBufferFor(item, opts);
    const targetMin=(item.fixedAt!=null? item.fixedAt : item.eta);
    const leaveMin=Math.round(targetMin-travel-bufferMin);
    if(!state.live){
      return {leaveMin, slackMin:0, bufferMin, travelMin:travel, level:'EARLY', stage:'UPCOMING', lateByMin:0, targetMin,
        text:LIB.hm(leaveMin)+'쯤 출발하는 일정이에요'};
    }
    if(item.status==='IN_PROGRESS') return null;
    if(item.fixedAt==null){
      const plain=departureAdvice(state, item, travel);
      return {leaveMin:plain? plain.leaveMin : state.nowMin, slackMin:plain? plain.slackMin : 0, bufferMin, travelMin:travel,
        level:(plain&&plain.level==='EARLY')? 'EARLY' : 'NOW', stage:'UPCOMING', lateByMin:0, targetMin, text:plain? plain.text : ''};
    }
    const slackMin=Math.round(leaveMin-state.nowMin);
    // 늦음 판정은 여유(buffer)를 뺀 순수 이동시간 기준이다 — 여유를 못 지키는 것과 약속에 늦는 것은 다르다.
    const lateByMin=Math.max(0, Math.round((state.nowMin+travel)-targetMin));
    if(lateByMin>0){
      return {leaveMin, slackMin, bufferMin, travelMin:travel, level:'LATE', stage:'LATE_RISK', lateByMin, targetMin,
        text:'지금 출발해도 '+durText(lateByMin)+'쯤 늦어요'+(item.name?' — '+item.name+'에 미리 알려두면 좋겠어요':'')};
    }
    if(slackMin<=0){
      return {leaveMin, slackMin, bufferMin, travelMin:travel, level:'NOW', stage:'LATE_RISK', lateByMin:0, targetMin,
        text:'지금 움직이면 '+LIB.hm(targetMin)+'까지 딱 맞아요'};
    }
    if(slackMin<=c.readyWindowMin){
      return {leaveMin, slackMin, bufferMin, travelMin:travel, level:'NOW', stage:'READY_TO_LEAVE', lateByMin:0, targetMin,
        text:'이제 출발하면 여유 있게 도착할 수 있어요 (약 '+durText(travel)+' 거리)'};
    }
    return {leaveMin, slackMin, bufferMin, travelMin:travel, level:'EARLY', stage:'UPCOMING', lateByMin:0, targetMin,
      text:LIB.hm(leaveMin)+'쯤 움직이면 여유가 있어요 (약 '+durText(travel)+' 거리, 지금부터 '+durText(slackMin)+' 남음)'};
  }

  /**
   * 하루 상태를 한 마디로. 내부 코드는 사용자에게 보여주지 않고 text만 쓴다(§51).
   * 규칙 기반이다 — 모델에게 맡기지 않는다(§52).
   * @param {any} state @param {any} replan @param {any=} departure @param {any=} opts
   * @returns {{code:string, text:string, detail:string}}
   */
  function tripPulse(state, replan, departure, opts){
    const c=cfgOf(opts);
    const remaining=state.items.filter((/**@type{any}*/it)=>it.status!=='COMPLETED'&&it.status!=='SKIPPED'&&it.status!=='CANCELLED');
    if(!state.items.length) return {code:'NO_PLAN', text:'오늘은 정해둔 일정이 없어요', detail:'지금 상황에 맞는 곳을 골라 시작해도 되고, 그냥 쉬어도 괜찮아요.'};
    if(!remaining.length) return {code:'DAY_COMPLETE', text:'오늘 계획한 일정은 다 마쳤어요', detail:'남은 시간은 편하게 쓰셔도 돼요.'};
    // 아직 늦지 않았다 — '밀려서'가 아니라 '이대로면 늦는다'고, 어느 약속인지까지 말한다(2026-10-03)
    if(replan && replan.needed) return {code:'NEEDS_ATTENTION', text:'일정을 조금 손보면 좋겠어요',
      detail:(replan.lateAt
        ? '이대로면 '+replan.lateAt.name+' '+LIB.hm(replan.lateAt.atMin)+' 예약에 '+durText(replan.lateAt.lateBy)+' 늦어요.'
        : (replan.lateBy>0? '이대로면 예약 시간에 '+durText(replan.lateBy)+' 늦어요.' : '이대로면 예약 시간을 지키기 어려워요.'))};
    if(departure && departure.level==='LATE') return {code:'DELAYED', text:'약 '+durText(departure.lateByMin)+' 늦어지고 있어요',
      detail:'서두르기보다 도착 시각을 알려두는 편이 나을 수 있어요.'};
    if(state.energyLevel==='LOW') return {code:'RESTING', text:'지금은 쉬어가는 중이에요', detail:'무리하지 않는 선에서 이어가면 돼요.'};
    // 여유는 다음 고정 일정이 아니라 다음 남은 일정까지다(buildTripState의 availableMin) — 남은 곳이 있는데 '8시간 여유'라 하지 않는다
    const fb=state.freeBefore;
    if(state.availableMin>=c.freeTimeMin && fb) return {code:'FREE_TIME', text:'다음 일정까지 '+durText(state.availableMin)+' 여유가 있어요',
      detail:fb.name+' '+LIB.hm(fb.fixedAt!=null? fb.fixedAt : fb.eta)+'까지는 시간이 넉넉해요.'};
    const next=state.nextItem;
    if(state.live && next && (next.eta-state.nowMin)>=c.aheadMin && state.completedItems.length)
      return {code:'AHEAD', text:'계획보다 앞서 가고 있어요', detail:'다음 일정까지 여유가 있어요.'};
    return {code:'ON_TRACK', text:'일정대로 잘 가고 있어요', detail:next? next.name+'까지 이어가면 돼요.' : ''};
  }

  /**
   * 상태 지문 — 이 값이 그대로면 아무것도 바뀌지 않은 것이다.
   * Live Activity 갱신·알림 중복 제거·낡은 제안 판별의 기준이 된다(§46·§47).
   * 시각은 분 단위로 반올림해 1초마다 값이 달라지지 않게 한다.
   * @param {any} state @param {any=} extra
   * @returns {string}
   */
  function stateVersion(state, extra){
    const parts=[
      state.tripId||'-', 'd'+state.currentDay, state.todayISO||'',
      state.items.map((/**@type{any}*/it)=>it.id+':'+it.status+':'+Math.round(it.depart)).join(','),
      'e'+(state.energyLevel||''),
      (extra&&extra.stage)||'', (extra&&extra.pulse)||''
    ];
    let h=5381;
    const raw=parts.join('|');
    for(let i=0;i<raw.length;i++){ h=((h*33)^raw.charCodeAt(i))>>>0; }
    return 'v'+h.toString(36);
  }

  /** 알림 종류 — 서버가 판단할 것과 기기가 판단할 것을 나눈다(§11). */
  const NOTIFICATION_KINDS = Object.freeze({
    DEPARTURE: 'departureReminder',
    FIXED_COMMITMENT: 'fixedCommitmentReminder',
    SCHEDULE_DELAY: 'scheduleDelay',
    REPLAN: 'replanSuggestion',
    EMPTY_SLOT: 'emptySlotSuggestion',
    PRICE_SAVING: 'priceSaving'
  });

  /**
   * 지금 보낼 만한 알림. **많이 보내는 것이 성공이 아니다**(§3) — 각 항목은 "지금 다음 행동을
   * 정하는 데 실제로 도움이 되는가"를 통과해야 한다. 단계(stage)가 바뀔 때만 나오고,
   * 같은 단계는 dedupeKey가 같아 다시 나가지 않는다.
   * @param {any} state
   * @param {{departure?:any, pulse?:any, replan?:any, suggestions?:any[], suppressUntilMin?:number, travelMode?:boolean, quiet?:boolean}=} input
   * @param {any=} opts
   * @returns {{kind:string, origin:('DEVICE'|'SERVER'), dedupeKey:string, title:string, body:string, deepLink:string, targetId:(string|null), priority:number, expiresAtMin:(number|null)}[]}
   */
  function notificationPlan(state, input, opts){
    const i=input||{}, c=cfgOf(opts);
    /** @type {any[]} */ const out=[];
    const day=state.todayISO||('d'+state.currentDay);
    const key=(/**@type{string}*/kind,/**@type{string}*/source,/**@type{string}*/stage)=>
      [state.tripId||'-', day, kind, source, stage].join('|');
    // 여행 중이 아니면 먼저 말 걸지 않는다. 계획 화면을 보는 사람에게 출발 알림은 소음이다.
    if(!state.live) return out;

    const dep=i.departure, next=state.nextItem;
    if(dep && next && (dep.stage==='READY_TO_LEAVE'||dep.stage==='LATE_RISK')){
      const late=dep.level==='LATE';
      out.push({
        kind:late? NOTIFICATION_KINDS.SCHEDULE_DELAY : NOTIFICATION_KINDS.DEPARTURE,
        origin:'DEVICE',                       // 현재 위치가 필요하다 — 기기가 판단한다
        dedupeKey:key(late? NOTIFICATION_KINDS.SCHEDULE_DELAY : NOTIFICATION_KINDS.DEPARTURE, next.id, dep.stage),
        title:next.name,
        body:dep.text,
        deepLink:'tripcanvas://trip/'+(state.tripId||'')+'/today?focus='+next.id,
        targetId:next.id,
        priority:late? 2 : 1,
        expiresAtMin:dep.targetMin
      });
    }

    if(i.replan && i.replan.needed){
      const dropped=(i.replan.dropNames||[]).join(', '), lastDropped=(i.replan.dropNames||[]).slice(-1)[0];
      out.push({
        kind:NOTIFICATION_KINDS.REPLAN,
        origin:'SERVER',                       // 일정 전체를 다시 굴려야 한다 — 서버가 판단한다
        dedupeKey:key(NOTIFICATION_KINDS.REPLAN, (i.replan.drop||[]).join(',')||'none', 'needed'),
        title:'일정을 조금 손보면 어떨까요',
        body:(i.replan.lateAt? '이대로면 '+i.replan.lateAt.name+' 예약에 '+durText(i.replan.lateAt.lateBy)+' 늦어요. '
            : (i.replan.lateBy>0? '이대로면 예약에 '+durText(i.replan.lateBy)+' 늦어요. ':''))+
          (dropped? dropped+josa(lastDropped,'을','를')+(i.replan.feasible===false? ' 빼도 늦어요 — 예약 시간을 확인해 보세요.' : ' 빼면 예약 시간은 그대로 지킬 수 있어요.')
            : '남은 일정을 다시 확인해 보세요.'),
        deepLink:'tripcanvas://trip/'+(state.tripId||'')+'/replan',
        targetId:null,
        priority:2,
        expiresAtMin:state.nextFixed? state.nextFixed.startMin : null
      });
    }

    // 빈 시간 제안은 가장 조심스러운 알림이다. Travel Mode를 켠 사람에게만, 쉬겠다고
    // 한 뒤에는 보내지 않고, 남은 시간이 충분할 때만 낸다(§35·§36).
    const suppressed=i.suppressUntilMin!=null && state.nowMin<i.suppressUntilMin;
    const restingByChoice=state.energyLevel==='LOW';
    if(i.travelMode && !suppressed && !restingByChoice && !i.quiet && state.availableMin>=c.freeTimeMin){
      const pick=(i.suggestions||[]).filter((/**@type{any}*/s)=>s.type==='NEXT_ACTIVITY')[0];
      if(pick) out.push({
        kind:NOTIFICATION_KINDS.EMPTY_SLOT,
        origin:'DEVICE',
        dedupeKey:key(NOTIFICATION_KINDS.EMPTY_SLOT, pick.id, 'offered'),
        title:'지금 들르기 좋은 곳이 있어요',
        body:pick.title+(pick.description? ' · '+pick.description : ''),
        deepLink:'tripcanvas://trip/'+(state.tripId||'')+'/suggestion/'+encodeURIComponent(pick.id),
        targetId:pick.id,
        priority:0,
        expiresAtMin:state.nextFixed? state.nextFixed.startMin : state.dayEndMin
      });
    }

    (i.suggestions||[]).filter((/**@type{any}*/s)=>s.type==='PRICE_SAVING').forEach((/**@type{any}*/s)=>{
      out.push({
        kind:NOTIFICATION_KINDS.PRICE_SAVING,
        origin:'SERVER',
        dedupeKey:key(NOTIFICATION_KINDS.PRICE_SAVING, s.id, 'found'),
        title:s.title,
        body:s.description||'같은 조건이 더 싼 곳이 있어요.',
        deepLink:'tripcanvas://trip/'+(state.tripId||'')+'/bookings',
        targetId:s.id,
        priority:0,
        expiresAtMin:null
      });
    });

    // 우선순위 → 종류 순으로 안정 정렬. 같은 상태면 같은 순서가 나와야 중복 제거가 성립한다.
    out.sort((a,b)=> (b.priority-a.priority) || (a.kind<b.kind? -1 : (a.kind>b.kind? 1 : 0)));
    return out;
  }

  /**
   * 이미 보낸 알림을 뺀다(§46). 같은 dedupeKey는 다시 나가지 않는다 —
   * 단계가 바뀌면 키가 달라지므로 "정말 새로운 상황"만 통과한다.
   * @param {any[]} plan @param {string[]} sentKeys
   * @returns {any[]}
   */
  function pendingNotifications(plan, sentKeys){
    const sent=Object.create(null);
    (sentKeys||[]).forEach((/**@type{string}*/k)=>{ sent[k]=1; });
    return (plan||[]).filter((/**@type{any}*/n)=>!sent[n.dedupeKey]);
  }

  /**
   * 제안의 유효기간(§48). 위치·시각 기반 추천은 금방 낡는다 — 다음 고정 일정 시작,
   * 하루 끝, TTL 중 가장 이른 시각까지만 유효하다.
   * @param {any} state @param {any=} opts
   * @returns {number} 그 날 자정부터 분
   */
  function suggestionExpiryMin(state, opts){
    const c=cfgOf(opts);
    const base=state.live? state.nowMin : state.dayStartMin;
    const candidates=[base+c.suggestionTTLMin, state.dayEndMin];
    if(state.nextFixed) candidates.push(state.nextFixed.startMin);
    return Math.round(Math.min.apply(null, candidates));
  }
  const API={ADAPT_CFG, MEAL_WINDOWS, DAY_SEGMENTS, SAFETY_BUFFER, NOTIFICATION_KINDS, safetyBufferFor, departurePlan, tripPulse, stateVersion, notificationPlan, pendingNotifications, suggestionExpiryMin, parseIntent, resolveIntent, departureAdvice, fillGaps, planDayFlow, segmentLabel, currentDayIndex, daysUntilStart, weekdayOf, commitmentOf, priorityOf, statusOf, planningModeHint,
    buildTripState, findFreeWindows, mealOverlap, buildCandidates, rankNextActions, simulate, generateReplan,
    suggestionKey, buildSuggestions, feedbackEntry, travelMinutes, moveModeTo, durText, josa, isLodging, isLightDay, mealCoveredBy};
  if(typeof module!=='undefined' && module.exports) module.exports=API;   // Node (테스트)
  else /** @type {any} */(root).TC_ADAPT=API;                             // 브라우저 전역 (lib/price와 동일 패턴)
})(typeof window!=='undefined'?window:globalThis);
