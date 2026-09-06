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
    suggestionTTLMin: 90     // 위치·시각 기반 제안의 유효기간 — 지나면 표시도 알림도 하지 않는다
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
  /** 이동시간(분) — 주입된 legMin 우선, 없으면 직선거리 환산. 좌표가 없으면 0(모름). @param {any} a @param {any} b @param {any=} opts @returns {number} */
  function travelMinutes(a,b,opts){
    if(!hasCoord(a)||!hasCoord(b)) return 0;
    const c=cfgOf(opts), fn=opts&&opts.legMin;
    if(typeof fn==='function'){ const v=+fn(a,b); if(isFinite(v)&&v>=0) return Math.round(v); }
    return Math.round(LIB.haversine({lat:+a.lat,lng:+a.lng},{lat:+b.lat,lng:+b.lng})/c.fallbackSpeedKmh*60);
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
    else if(s.stay) type='HOTEL';
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
    const freeFrom=Math.max(nowMin, lastDone? lastDone.end : nowMin);
    const availableMin=nextFixed? Math.max(0, nextFixed.startMin-freeFrom) : Math.max(0, dayEndMin-freeFrom);
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
      availableMin, delayMin, travelMinToday:travelToday,
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
        if(!anyCity && !cities[s.city]) return;      // 오늘 머무는 도시가 아니면 옮겨올 후보가 아니다(오늘이 통째로 비었으면 도시 제한 없음)
        if(seen[nameKey(s)]) return;
        seen[nameKey(s)]=1;
        const cm=commitmentOf(s, days[k], (trip&&trip.bookings)||[]);
        if(cm.flexibility!=='FLEXIBLE') return;
        out.push({id:'c-d'+k+'s'+si, kind:'VISIT_PLACE', title:String(s.name||''), location:locOf(s),
          // 제안 후보의 소요는 계획된 체류가 아니다 — 모르면 '한 시간쯤 걸린다'고 본다
          durationMin:(s.stayMin!=null? Math.max(0,num(s.stayMin,c.suggestStayMin)) : c.suggestStayMin),
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
    if(meal) out.push({id:'c-eat-'+meal.key, kind:'EAT', title:meal.label+' 시간이 비어 있어요', location:(win?win.anchor:null),
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
    const nextFixedLoc=state.nextFixed? state.nextFixed.location : null;
    const meal=mealOverlap(win);
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
        score=38;
        if(state.energyLevel==='LOW'){ score+=25; reasons.push('지금은 체력을 아끼는 편이 낫습니다'); }
        if(state.travelMinToday>=c.heavyTravelMin){ score+=15; reasons.push('오늘 이동이 '+Math.round(state.travelMinToday/60)+'시간을 넘었습니다'); }
        if(state.nextFixed) reasons.push(state.nextFixed.title+' '+LIB.hm(state.nextFixed.startMin)+'까지 '+Math.round(state.availableMin)+'분 남았습니다');
        else reasons.push('남은 고정 일정이 없어 쉬어도 밀리지 않습니다');
        out.push({type:'REST', id:cd.id, targetId:null, title:cd.title, score, reasons, estimatedDuration:duration,
          estimatedTravelTime:0, arriveMin:win.startMin, endMin:win.startMin+duration, fromDay:null, si:null, spot:null});
        return;
      }
      if(cd.kind==='RETURN_TO_HOTEL'){
        score=36;
        if(state.travelMinToday>=c.heavyTravelMin){ score+=14; reasons.push('오늘 이동이 많았습니다'); }
        if(travel) reasons.push('숙소까지 약 '+travel+'분');
        if(state.nextFixed && state.nextFixed.startMin-finish>=c.bufferMin) reasons.push('숙소에 들렀다 가도 '+state.nextFixed.title+' 시간에는 여유가 있습니다');
        if(!reasons.length) reasons.push('오늘 남은 일정을 숙소에서 이어가도 됩니다');
        out.push({type:'RETURN_TO_HOTEL', id:cd.id, targetId:null, title:cd.title, score, reasons, estimatedDuration:0,
          estimatedTravelTime:travel, arriveMin:arrive, endMin:arrive, fromDay:null, si:null, spot:null});
        return;
      }
      if(cd.kind==='EAT'){
        out.push({type:'EAT', id:cd.id, targetId:null, title:cd.title, score:46,
          reasons:[(meal? meal.label : '식사')+' 시간대에 일정이 비어 있습니다', '이 시간에 식사를 넣으면 남은 일정이 밀리지 않습니다'],
          estimatedDuration:duration, estimatedTravelTime:0, arriveMin:win.startMin, endMin:win.startMin+duration,
          fromDay:null, si:null, spot:null});
        return;
      }
      // 장소 방문 — 실제로 가능한지부터 확인한다
      const backMin=(cd.location&&nextFixedLoc)? travelMinutes(cd.location, nextFixedLoc, o) : 0;
      const deadline=win.beforeFixed? win.endMin : Math.min(win.endMin, state.dayEndMin);
      const guard=(win.beforeFixed||nextFixedLoc)? c.bufferMin : 0;
      if(finish+backMin+guard > deadline) return;                                             // 이동시간 때문에 불가능
      const prefs=state.prefs||{};
      if(prefs.maxTravelMin!=null && travel>prefs.maxTravelMin) return;                        // "가까운 데만" 요청은 범위를 좁힌다
      if(prefs.walkAverse && travel>0) score-=Math.min(14, travel*0.4);                        // 많이 걷기 싫다고 했으면 이동을 더 아낀다
      if(weekday>=0 && cd.hours && cd.hours.length){
        if(LIB.isOpenAt(cd.hours, weekday, arrive)===false) return;                            // 도착 시점에 영업 종료
        if(duration>0 && LIB.isOpenAt(cd.hours, weekday, Math.max(arrive, finish-1))===false) return;   // 머무는 중에 문 닫음
        reasons.push('도착 예정 시각에 문을 엽니다');
      }
      if(travel>0){
        score+=Math.max(0, 20-travel*0.5);
        reasons.push((cd.inPlan?'':'현재 위치에서 ')+'이동 약 '+travel+'분');
      }
      const slack=deadline-(finish+backMin);
      score+=Math.max(0, Math.min(15, 15-Math.abs(slack-c.bufferMin)/8));
      if(cd.must){ score+=18; reasons.push('꼭 가려고 표시한 곳입니다'); }
      else if(cd.priority>=2) score+=6;
      if(cd.inPlan){ score+=8; reasons.push('원래 오늘 일정에 있던 곳입니다'); }
      else if(cd.fromDay!=null) reasons.push('Day '+(cd.fromDay+1)+' 일정에서 옮겨올 수 있습니다');
      if(state.energyLevel==='LOW' && travel>25){ score-=12; reasons.push('다만 이동이 조금 깁니다'); }
      if(nextFixedLoc && state.nextFixed && cd.location){
        const direct=travelMinutes(win.anchor, nextFixedLoc, o);
        const detour=Math.max(0, (travel+backMin)-direct);
        score-=Math.min(20, detour*0.4);
        if(detour<=10) reasons.push(state.nextFixed.title+' 동선과 같은 방향입니다');
      }
      if(duration) reasons.push('약 '+(duration>=60? (Math.round(duration/60*10)/10)+'시간' : duration+'분')+'이면 둘러볼 수 있습니다');
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
   * @param {any} state @param {TripItem[]} list @param {any=} opts
   * @returns {{ok:boolean, lateBy:number, endMin:number, violated:string[]}}
   */
  function simulate(state, list, opts){
    const done=state.items.filter((/**@type{TripItem}*/it)=>it.status==='COMPLETED');
    const lastDone=done.length? done[done.length-1] : null;
    let clock=state.live? Math.max(state.nowMin, lastDone? lastDone.end : state.nowMin) : state.dayStartMin;
    /** @type {any} */
    let prev=state.currentLocation||state.startLocation;
    let lateBy=0;
    /** @type {string[]} */
    const violated=[];
    list.forEach((/**@type{TripItem}*/it)=>{
      if(it.location && prev) clock+=travelMinutes(prev, it.location, opts);
      if(it.fixedAt!=null){
        if(it.flexibility==='FIXED'){
          const over=clock-it.fixedAt;
          if(over>0.5){ lateBy=Math.max(lateBy, Math.round(over)); violated.push(it.id); }
        }
        clock=Math.max(clock, it.fixedAt);
      }
      clock+=it.stayMin;
      if(it.location) prev=it.location;
    });
    return {ok:!violated.length, lateBy, endMin:Math.round(clock), violated};
  }
  /**
   * 남은 일정 재구성 후보. 순서를 지킨다: 고정 예약 보호 → 완료 일정 유지 → mustVisit 보호 →
   * 남은 시간 안에 들어오는 일정 우선 → 우선순위 낮은 일정부터 제거. 자동 적용하지 않는다(미리보기).
   * @param {any} state @param {{legMin?:any, cfg?:any}=} opts
   * @returns {{needed:boolean, feasible:boolean, keep:string[], drop:string[], dropNames:string[], lateBy:number, impact:SuggestionImpact, before:string[], after:string[]}}
   */
  function generateReplan(state, opts){
    const pending=state.items.filter((/**@type{TripItem}*/it)=>it.status!=='COMPLETED'&&it.status!=='SKIPPED'&&it.status!=='CANCELLED');
    const base=simulate(state, pending, opts);
    let keep=pending.slice();
    /** @type {TripItem[]} */
    const drop=[];
    // 뺄 수 있는 것: 유동 + mustVisit 아님. 우선순위 낮은 것 → 뒤쪽(늦은 순서) 것부터.
    const droppable=pending.filter((/**@type{TripItem}*/it)=>it.flexibility==='FLEXIBLE' && !(it.spot&&it.spot.must))
      .sort((/**@type{TripItem}*/a,/**@type{TripItem}*/b)=> (a.priority-b.priority) || (b.si-a.si));
    let r=base, i=0;
    while(!r.ok && i<droppable.length){
      const victim=droppable[i++];
      keep=keep.filter((/**@type{TripItem}*/it)=>it.id!==victim.id);
      drop.push(victim);
      r=simulate(state, keep, opts);
    }
    return {
      needed:!base.ok, feasible:r.ok,
      keep:keep.map((/**@type{TripItem}*/it)=>it.id), drop:drop.map((/**@type{TripItem}*/it)=>it.id),
      dropNames:drop.map((/**@type{TripItem}*/it)=>it.name), lateBy:base.lateBy,
      before:pending.map((/**@type{TripItem}*/it)=>it.name), after:keep.map((/**@type{TripItem}*/it)=>it.name),
      impact:{timeChangeMinutes:r.endMin-base.endMin, removedActivities:drop.map((/**@type{TripItem}*/it)=>it.name), addedActivities:[]}
    };
  }
  /** 제안이 일정에 주는 영향. @param {any} before @param {any} after @returns {SuggestionImpact} */
  function calcSuggestionImpact(before, after){
    return {
      timeChangeMinutes:Math.round(num(after&&after.endMin,0)-num(before&&before.endMin,0)),
      travelTimeChangeMinutes:Math.round(num(after&&after.travelMin,0)-num(before&&before.travelMin,0)),
      removedActivities:(after&&after.removed)||[], addedActivities:(after&&after.added)||[]
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
   * @param {{legMin?:any, cfg?:any, dismissed?:string[], priceSuggestions?:any[], window?:FreeWindow}=} opts
   * @returns {{suggestions:TripSuggestion[], windows:FreeWindow[], replan:any, ranked:NextActionCandidate[], window:(FreeWindow|null), empty:boolean}}
   */
  function buildSuggestions(trip, state, opts){
    const o=opts||{}, c=cfgOf(o);
    /** @type {any} */
    const dismissed=Object.create(null);
    (o.dismissed||[]).forEach((/**@type{string}*/k)=>{ dismissed[k]=1; });
    const windows=findFreeWindows(state, o);
    const replan=generateReplan(state, o);
    const win=o.window || windows[0] || null;
    const ranked=rankNextActions(state, buildCandidates(trip, state, {window:(win||undefined), cfg:c}),
      {window:(win||undefined), legMin:o.legMin, cfg:c});
    /** @type {TripSuggestion[]} */
    const out=[];
    const cap=c.maxSuggest+1;   // 재구성/가격은 '다음 행동' 3개와 별개로 한 자리 더 허용
    /** @param {TripSuggestion} s */
    const push=(s)=>{ if(!dismissed[s.key] && out.length<cap) out.push(s); };

    if(replan.needed){
      const key=suggestionKey('REPLAN', replan.drop.join(',')||'none', state);
      push({id:key, key, type:'REPLAN',
        title:replan.lateBy+'분 지연 — 이렇게 조정하면 약속에 늦지 않아요',
        description:replan.feasible
          ? (replan.dropNames.length? replan.dropNames.join(', ')+'을(를) 빼면 고정 예약 시간을 지킬 수 있어요' : '순서를 그대로 두어도 괜찮습니다')
          : '일정을 줄여도 고정 예약 시간을 맞추기 어려워요 — 예약 변경을 검토해 보세요',
        reasons:['현재 '+replan.lateBy+'분 밀렸습니다', '고정 예약은 그대로 지킵니다', '완료한 일정은 유지합니다'],
        impact:replan.impact, status:'NEW', action:{kind:'REPLAN', drop:replan.drop, keep:replan.keep}});
    }
    ranked.slice(0, c.maxSuggest).forEach((r)=>{
      const key=suggestionKey(r.type, r.title, state);
      push({id:key, key, type:((r.type==='REST'||r.type==='RETURN_TO_HOTEL')? 'REST' : (r.type==='EAT'? 'NEXT_ACTIVITY' : 'NEXT_ACTIVITY')),
        title:r.title,
        description:(r.type==='VISIT_PLACE'||r.type==='CHECK_IN')
          ? ((r.estimatedTravelTime? r.estimatedTravelTime+'분 이동 · ' : '')+LIB.hm(r.arriveMin)+' 도착 · '+LIB.hm(r.endMin)+'까지')
          : (r.type==='EAT'? (LIB.hm(r.arriveMin)+'부터 비어 있어요') : '지금 쉬어도 남은 일정에는 여유가 있어요'),
        reasons:r.reasons,
        impact:{timeChangeMinutes:r.estimatedDuration+r.estimatedTravelTime, addedActivities:(r.spot?[r.title]:[]), removedActivities:[]},
        status:'NEW', action:{kind:r.type, si:r.si, fromDay:r.fromDay, candidateId:r.id, startMin:(win? win.startMin : state.nowMin)}});
    });
    (o.priceSuggestions||[]).forEach((/**@type{any}*/p)=>{
      const key=suggestionKey('PRICE_SAVING', String(p.bookingId||p.title||''), state);
      push({id:key, key, type:'PRICE_SAVING', title:String(p.title||''), description:String(p.description||''),
        reasons:(Array.isArray(p.reasons)? p.reasons : []), impact:(p.impact||{costChange:num(p.costChange,0)}),
        status:'NEW', action:{kind:'OPEN_BOOKING', bookingId:p.bookingId}});
    });
    return {suggestions:out, windows, replan, ranked, window:win, empty:!out.length};
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
  const INTENT_RULES=Object.freeze([
    Object.freeze({re:/피곤|지쳤|지침|힘들|무리|쉬고\s*싶|쉴래|쉬자/, apply:{energyLevel:'LOW'}, why:'쉬고 싶다고 하셨어요'}),
    Object.freeze({re:/걷기\s*싫|많이\s*걷|안\s*걷|걷는\s*건/, apply:{walkAverse:true, maxTravelMin:20}, why:'많이 걷지 않는 쪽으로 볼게요'}),
    Object.freeze({re:/가까운\s*(곳|데)|멀리\s*(가기)?\s*싫|근처(에서)?/, apply:{maxTravelMin:15}, why:'가까운 곳만 볼게요'}),
    Object.freeze({re:/쌩쌩|팔팔|기운|더\s*보고|많이\s*보고|부지런|괜찮아/, apply:{energyLevel:'HIGH'}, why:'컨디션이 좋다고 하셨어요'}),
    Object.freeze({re:/배고|밥|먹고|식사|점심|저녁\s*먹/, apply:{mealFocus:true}, why:'식사를 먼저 챙길게요'}),
    Object.freeze({re:/숙소|호텔로|들어가고\s*싶|집에/, apply:{wantRest:true}, why:'숙소로 돌아가는 쪽을 먼저 볼게요'})
  ]);
  /**
   * "오늘 좀 피곤해서 많이 걷기 싫어" → {energyLevel:'LOW', walkAverse:true, maxTravelMin:20}.
   * 해석하지 못하면 빈 결과를 준다 — 못 알아들은 것을 알아들은 척하지 않는다.
   * @param {string} text
   * @returns {{energyLevel:(EnergyLevel|null), prefs:any, reasons:string[], understood:boolean}}
   */
  function parseIntent(text){
    const t=String(text==null?'':text).trim();
    /** @type {any} */ const prefs={};
    /** @type {string[]} */ const reasons=[];
    /** @type {EnergyLevel|null} */ let energyLevel=null;
    if(t) INTENT_RULES.forEach((r)=>{
      if(!r.re.test(t)) return;
      reasons.push(r.why);
      Object.keys(r.apply).forEach((k)=>{
        if(k==='energyLevel'){ energyLevel=/** @type {any} */(r.apply)[k]; return; }
        const v=/** @type {any} */(r.apply)[k];
        if(k==='maxTravelMin' && prefs.maxTravelMin!=null) prefs.maxTravelMin=Math.min(prefs.maxTravelMin, v);   // 더 좁은 요구를 따른다
        else prefs[k]=v;
      });
    });
    return {energyLevel, prefs, reasons, understood:reasons.length>0};
  }

  // ── 9. 출발 안내 ─────────────────────────────────────────────────
  /**
   * "10:40쯤 출발하면 좋습니다" / "지금 출발하면 약 28분 여유" / "지금 출발해도 12분 늦습니다".
   * 약속 시각(fixedAt)이 있으면 그 시각이, 없으면 도착 예정이 기준이다.
   * @param {any} state @param {TripItem} item @param {number} travelMin
   * @returns {{leaveMin:number, slackMin:number, level:('EARLY'|'NOW'|'LATE'), text:string}|null}
   */
  function departureAdvice(state, item, travelMin){
    if(!item) return null;
    const target=(item.fixedAt!=null? item.fixedAt : item.eta);
    const leaveMin=Math.round(target-Math.max(0,travelMin||0));
    if(!state.live) return {leaveMin, slackMin:0, level:'EARLY', text:LIB.hm(leaveMin)+'쯤 출발하는 일정입니다'};
    const slackMin=Math.round(leaveMin-state.nowMin);
    if(slackMin<0) return {leaveMin, slackMin, level:'LATE', text:'지금 출발해도 약 '+Math.abs(slackMin)+'분 늦습니다'};
    if(slackMin<=10) return {leaveMin, slackMin, level:'NOW', text:'지금 출발하면 약 '+slackMin+'분 여유가 있어요'};
    return {leaveMin, slackMin, level:'EARLY', text:LIB.hm(leaveMin)+'쯤 출발하면 여유 있게 도착해요 (지금부터 '+slackMin+'분 남음)'};
  }

  // ── 10. 빈칸 채우기 (Assisted) · 하루 flow (Delegated) ──────────
  /**
   * 빈 시간을 "한 칸"이 아니라 있는 만큼 채운 미리보기. 이미 오늘 일정에 있는 곳은 후보에서 뺀다
   * (이미 잡혀 있는 것을 다시 넣는 건 채우기가 아니다). 저장하지 않는다 — 미리보기다.
   * @param {any} trip @param {any} state @param {{legMin?:any, cfg?:any, maxPerWindow?:number, exclude?:string[]}=} opts
   * @returns {{slots:{startMin:number,endMin:number,afterId:(string|null),pick:NextActionCandidate}[], impact:SuggestionImpact}}
   */
  function fillGaps(trip, state, opts){
    const o=opts||{}, c=cfgOf(o), maxPer=num(o.maxPerWindow, 3);
    const skip=o.exclude||[];   // '다른 제안'으로 이미 물린 후보
    const windows=findFreeWindows(state, o);
    /** @type {string[]} */ const used=[];
    /** @type {any[]} */ const slots=[];
    windows.forEach((win)=>{
      let cursor=win.startMin, anchor=win.anchor;
      for(let n=0;n<maxPer;n++){
        /** @type {FreeWindow} */
        const sub={startMin:cursor, endMin:win.endMin, minutes:win.endMin-cursor, anchor,
          afterId:win.afterId, beforeId:win.beforeId, beforeFixed:win.beforeFixed};
        if(sub.minutes<30) break;
        const cands=buildCandidates(trip, state, {window:sub, cfg:c})
          .filter((cd)=>used.indexOf(cd.id)<0 && skip.indexOf(cd.id)<0 && !cd.inPlan && cd.kind!=='REST' && cd.kind!=='RETURN_TO_HOTEL');
        const pick=rankNextActions(state, cands, {window:sub, legMin:o.legMin, cfg:c})[0];
        if(!pick) break;
        used.push(pick.id);
        slots.push({startMin:pick.arriveMin, endMin:pick.endMin, afterId:win.afterId, pick});
        cursor=pick.endMin;
        if(pick.spot) anchor=locOf(pick.spot)||anchor;
      }
    });
    return {slots, impact:{addedActivities:slots.map((x)=>x.pick.title), removedActivities:[],
      timeChangeMinutes:slots.reduce((a,x)=>a+x.pick.estimatedDuration+x.pick.estimatedTravelTime,0)}};
  }

  const DAY_SEGMENTS=Object.freeze([Object.freeze({key:'morning',label:'오전',to:11*60+30}),
    Object.freeze({key:'lunch',label:'점심',to:13*60+30}), Object.freeze({key:'afternoon',label:'오후',to:17*60+30}),
    Object.freeze({key:'evening',label:'저녁',to:24*60})]);
  /** @param {number} min @returns {string} */
  function segmentLabel(min){ for(const seg of DAY_SEGMENTS) if(min<seg.to) return seg.label; return '저녁'; }
  /**
   * "오늘 하루 추천해줘" — 지금(또는 일자 시작)부터 하루 끝까지의 흐름.
   * 고정 예약은 그대로 자리에 두고 그 사이를 채운다. 한 번 만들고 끝이 아니라 상태가 바뀌면 다시 만든다.
   * @param {any} trip @param {any} state @param {{legMin?:any, cfg?:any}=} opts
   * @returns {{blocks:any[], picks:NextActionCandidate[], empty:boolean, impact:SuggestionImpact}}
   */
  function planDayFlow(trip, state, opts){
    const fill=fillGaps(trip, state, opts);
    /** @type {any[]} */ const blocks=[];
    state.fixedCommitments.forEach((/**@type{FixedCommitment}*/f)=>{
      if(f.startMin<(state.live? state.nowMin : state.dayStartMin)) return;   // 이미 지난 약속은 '오늘 할 일'이 아니다
      blocks.push({kind:'FIXED', startMin:f.startMin, endMin:f.endMin, title:f.title, itemId:f.itemId, segment:segmentLabel(f.startMin)});
    });
    fill.slots.forEach((/**@type{any}*/sl)=>{
      blocks.push({kind:'SUGGESTED', startMin:sl.startMin, endMin:sl.endMin, title:sl.pick.title,
        afterId:sl.afterId, pick:sl.pick, segment:segmentLabel(sl.startMin)});
    });
    blocks.sort((a,b)=> (a.startMin-b.startMin) || (a.title<b.title? -1 : (a.title>b.title? 1 : 0)));
    return {blocks, picks:fill.slots.map((/**@type{any}*/x)=>x.pick), empty:!blocks.some((b)=>b.kind==='SUGGESTED'), impact:fill.impact};
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
    const slackMin=Math.round(leaveMin-state.nowMin);
    // 늦음 판정은 여유(buffer)를 뺀 순수 이동시간 기준이다 — 여유를 못 지키는 것과 약속에 늦는 것은 다르다.
    const lateByMin=Math.max(0, Math.round((state.nowMin+travel)-targetMin));
    if(lateByMin>0){
      return {leaveMin, slackMin, bufferMin, travelMin:travel, level:'LATE', stage:'LATE_RISK', lateByMin, targetMin,
        text:'지금 출발해도 '+lateByMin+'분쯤 늦어요'+(item.name?' — '+item.name+'에 미리 알려두면 좋겠어요':'')};
    }
    if(slackMin<=0){
      return {leaveMin, slackMin, bufferMin, travelMin:travel, level:'NOW', stage:'LATE_RISK', lateByMin:0, targetMin,
        text:'지금 움직이면 '+LIB.hm(targetMin)+'까지 딱 맞아요'};
    }
    if(slackMin<=c.readyWindowMin){
      return {leaveMin, slackMin, bufferMin, travelMin:travel, level:'NOW', stage:'READY_TO_LEAVE', lateByMin:0, targetMin,
        text:'이제 출발하면 여유 있게 도착할 수 있어요 (약 '+travel+'분 거리)'};
    }
    return {leaveMin, slackMin, bufferMin, travelMin:travel, level:'EARLY', stage:'UPCOMING', lateByMin:0, targetMin,
      text:LIB.hm(leaveMin)+'쯤 움직이면 여유가 있어요 (약 '+travel+'분 거리, 지금부터 '+slackMin+'분 남음)'};
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
    if(replan && replan.needed) return {code:'NEEDS_ATTENTION', text:'일정을 조금 손보면 좋겠어요',
      detail:(replan.lateBy>0? replan.lateBy+'분 밀려서 ':'')+'이대로면 예약 시간을 지키기 어려워요.'};
    if(departure && departure.level==='LATE') return {code:'DELAYED', text:'약 '+departure.lateByMin+'분 늦어지고 있어요',
      detail:'서두르기보다 도착 시각을 알려두는 편이 나을 수 있어요.'};
    if(state.energyLevel==='LOW') return {code:'RESTING', text:'지금은 쉬어가는 중이에요', detail:'무리하지 않는 선에서 이어가면 돼요.'};
    if(state.availableMin>=c.freeTimeMin && state.nextFixed) return {code:'FREE_TIME', text:'다음 일정까지 '+Math.round(state.availableMin/60*10)/10+'시간 여유가 있어요',
      detail:state.nextFixed.title+' '+LIB.hm(state.nextFixed.startMin)+'까지는 시간이 넉넉해요.'};
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
      const dropped=(i.replan.dropNames||[]).join(', ');
      out.push({
        kind:NOTIFICATION_KINDS.REPLAN,
        origin:'SERVER',                       // 일정 전체를 다시 굴려야 한다 — 서버가 판단한다
        dedupeKey:key(NOTIFICATION_KINDS.REPLAN, (i.replan.drop||[]).join(',')||'none', 'needed'),
        title:'일정을 조금 손보면 어떨까요',
        body:(i.replan.lateBy>0? '약 '+i.replan.lateBy+'분 늦어지고 있어요. ':'')+
          (dropped? dropped+'을(를) 빼면 예약 시간은 그대로 지킬 수 있어요.' : '남은 일정을 다시 확인해 보세요.'),
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
  const API={ADAPT_CFG, MEAL_WINDOWS, DAY_SEGMENTS, SAFETY_BUFFER, NOTIFICATION_KINDS, safetyBufferFor, departurePlan, tripPulse, stateVersion, notificationPlan, pendingNotifications, suggestionExpiryMin, parseIntent, departureAdvice, fillGaps, planDayFlow, segmentLabel, currentDayIndex, weekdayOf, commitmentOf, priorityOf, statusOf, planningModeHint,
    buildTripState, findFreeWindows, mealOverlap, buildCandidates, rankNextActions, simulate, generateReplan,
    calcSuggestionImpact, suggestionKey, buildSuggestions, feedbackEntry, travelMinutes};
  if(typeof module!=='undefined' && module.exports) module.exports=API;   // Node (테스트)
  else /** @type {any} */(root).TC_ADAPT=API;                             // 브라우저 전역 (lib/price와 동일 패턴)
})(typeof window!=='undefined'?window:globalThis);
