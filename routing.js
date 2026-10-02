(function(root){
  'use strict';

  /** @typedef {{lat:number|string,lng:number|string}} Point */
  /** @typedef {{sec:number,m:number,path:string|null,mode?:string,est?:number,snapped?:number,taxi?:number}} RouteResult */
  /**
   * 네트워크/지도 SDK와 무관한 라우팅 클라이언트. UI는 이 factory에 fetch와 순수 도메인 함수를 주입한다.
   * @param {{fetchImpl:typeof fetch,googleKey:string,encodePolyline:(p:any[])=>string,ringPts:(p:any,r:number)=>any[],haversine:(a:any,b:any)=>number,inKorea:(p:any)=>boolean}} deps
   */
  function createRoutingClient(deps){
    const {fetchImpl,googleKey,encodePolyline,ringPts,haversine,inKorea}=deps;
    /** @type {Record<string,string>} */
    const GMODE={car:'DRIVE',taxi:'DRIVE',transit:'TRANSIT',walk:'WALK',bike:'BICYCLE'};

    /** @param {any[]} pts @returns {string|null} */
    function encodePts(pts){
      if(!pts||!pts.length) return null;
      const step=Math.max(1,Math.floor(pts.length/300));
      const sampled=pts.filter((_,i)=>i%step===0);
      if(sampled[sampled.length-1]!==pts[pts.length-1]) sampled.push(pts[pts.length-1]);
      return encodePolyline(sampled);
    }

    /** @param {Point} a @param {Point} b @returns {Promise<any>} */
    async function kakaoTry(a,b){
      try{
        const response=await fetchImpl('/api/kakao-directions',{
          method:'POST',headers:{'Content-Type':'application/json'},
          body:JSON.stringify({origin:{lat:+a.lat,lng:+a.lng},destination:{lat:+b.lat,lng:+b.lng}})
        });
        const json=await response.json().catch(()=>null);
        // 경로 없음(카카오 result_code)은 프록시가 422로 싣는다 — 그 밖의 실패 응답·네트워크 예외는 '잠깐'이다
        if(!response.ok) return {code:(json&&Number(json.code))||-1,transient:transientRouteFailure(response)};
        const route=json&&json.route;
        if(!route) return {code:-1,transient:true};
        if(route.result_code!==0||!route.summary) return {code:route.result_code};
        return {rt:route};
      }catch(_){return {code:-1,transient:true};}
    }

    /** @param {any} route @param {{a:Point,b:Point}} original @param {boolean} snapped @returns {RouteResult} */
    function buildKakaoResult(route,original,snapped){
      const pts=[];
      (route.sections||[]).forEach((/** @type {any} */section)=>(section.roads||[]).forEach((/** @type {any} */road)=>{
        const values=road.vertexes||[];
        for(let i=0;i+1<values.length;i+=2) pts.push({lat:values[i+1],lng:values[i]});
      }));
      if(snapped&&pts.length){pts.unshift({lat:+original.a.lat,lng:+original.a.lng});pts.push({lat:+original.b.lat,lng:+original.b.lng});}
      return {sec:route.summary.duration,m:route.summary.distance,path:encodePts(pts),taxi:(route.summary.fare&&route.summary.fare.taxi)||0,snapped:snapped?1:0};
    }

    /** @param {Point} a @param {Point} b @returns {Promise<RouteResult|null>} */
    async function kakaoRoute(a,b){
      const original={a,b};
      let A={lat:+a.lat,lng:+a.lng},B={lat:+b.lat,lng:+b.lng},snapped=false;
      for(let attempt=0;attempt<3;attempt++){
        const {rt,code}=await kakaoTry(A,B);
        if(rt) return buildKakaoResult(rt,original,snapped);
        const fixA=code===102,fixB=code===103;
        if(!fixA&&!fixB) return null;
        const base=fixA?A:B;
        let hit=null;
        outer:for(const radius of [500,1000,1600,2400]){
          for(const candidate of ringPts(base,radius)){
            const tried=await kakaoTry(fixA?candidate:A,fixA?B:candidate);
            if(tried.rt) return buildKakaoResult(tried.rt,original,true);
            if(tried.transient) return null;   // 429·5xx·오프라인 — 남은 후보(최대 32곳)를 계속 두드리면 같은 분의 다른 구간까지 막힌다
            if(fixA?tried.code===103:tried.code===102){hit=candidate;break outer;}
          }
        }
        if(!hit)return null;
        if(fixA)A=hit;else B=hit;
        snapped=true;
      }
      return null;
    }

    /** @param {Point} a @param {Point} b @param {string} mode @param {string|null|undefined} when @returns {Promise<RouteResult|null>} */
    async function googleRoute(a,b,mode,when){
      /** @type {any} */
      const body={origin:{location:{latLng:{latitude:+a.lat,longitude:+a.lng}}},destination:{location:{latLng:{latitude:+b.lat,longitude:+b.lng}}},travelMode:GMODE[mode]||'DRIVE'};
      if(when&&body.travelMode==='TRANSIT') body.departureTime=when;
      const response=await fetchImpl('https://routes.googleapis.com/directions/v2:computeRoutes',{
        method:'POST',headers:{'Content-Type':'application/json','X-Goog-Api-Key':googleKey,'X-Goog-FieldMask':'routes.duration,routes.distanceMeters,routes.polyline.encodedPolyline'},body:JSON.stringify(body)
      });
      if(!response.ok)return null;
      const json=await response.json(),route=json.routes&&json.routes[0];
      if(!route||!route.duration)return null;
      return {sec:parseInt(route.duration),m:route.distanceMeters||0,path:(route.polyline&&route.polyline.encodedPolyline)||null};
    }

    /** @param {Point} a @param {Point} b @param {RouteResult} result @returns {boolean} */
    function transitImplausible(a,b,result){const km=haversine(a,b);return km>=2&&result.sec>0&&(km/(result.sec/3600))<8;}

    /** @param {Point} a @param {Point} b @param {string|null|undefined} when @returns {Promise<RouteResult|null>} */
    async function googleTransitRoute(a,b,when){
      const first=await googleRoute(a,b,'transit',when);
      if(!first||!transitImplausible(a,b,first))return first;
      for(const radius of [600,1200])for(const candidate of ringPts(a,radius)){
        const tried=await googleRoute(candidate,b,'transit',when);
        if(tried&&!transitImplausible(a,b,tried))return {...tried,snapped:1};
      }
      return first;
    }

    /** @param {Point} a @param {Point} b @param {string} mode @param {string|null|undefined} when @returns {Promise<RouteResult|null>} */
    async function fetchLeg(a,b,mode,when){
      if(mode==='flight'){const km=haversine(a,b);return {sec:Math.round(km/700*3600+40*60),m:Math.round(km*1000),path:null,est:1,mode:'flight'};}
      if(mode==='train'){const km=haversine(a,b)*1.1;return {sec:Math.round(km/160*3600+10*60),m:Math.round(km*1000),path:null,est:1,mode:'train'};}
      const korea=inKorea(a)&&inKorea(b);
      if(korea){
        if(mode==='car'||mode==='taxi'){const result=await kakaoRoute(a,b);return result&&{...result,mode};}
        if(mode==='transit'){const result=await googleTransitRoute(a,b,when);return result&&{...result,mode};}
        const result=await kakaoRoute(a,b);if(!result)return null;
        const mps=mode==='walk'?1.25:4.17;
        return {sec:Math.round(result.m/mps),m:result.m,path:result.path,snapped:result.snapped,est:1,mode};
      }
      const result=mode==='transit'?await googleTransitRoute(a,b,when):await googleRoute(a,b,mode,when);
      return result&&{...result,mode};
    }

    return {fetchLeg,kakaoRoute,googleRoute,googleTransitRoute,transitImplausible};
  }

  // ── 구간 캐시 정책 (app.js의 legCache · localStorage `tripcanvas_legs_v4`) ──
  /** 잠깐인 실패(오프라인·429·5xx)를 기억하는 시간 — 지나면 다시 묻는다. 기기에 남기지 않고, 그 사이 렌더마다 다시 묻지만 않게 한다. */
  const LEG_FAIL_TTL_MS=10*60*1000;
  /** 경로 없음을 기억하는 시간 — 이건 기기에 남긴다. 국내 구간 하나의 인근 도로 탐색이 최대 33번이라, 열 때마다 되풀이하면
   *  그것만으로 프록시의 분당 30번(`api/kakao-directions.js`)을 넘겨 같은 분의 다른 구간까지 429가 된다. */
  const LEG_NOROUTE_TTL_MS=24*60*60*1000;
  /** 기기에 남기는 구간 수 상한 — 폴리라인이 쌓여 여행 데이터(`tripcanvas_v1`)와 localStorage 용량을 다투지 않게 */
  const LEG_CACHE_MAX=400;

  /**
   * 경로 조회 응답이 '잠깐인 실패'인가 — 다시 물으면 답이 달라질 수 있다(429·5xx·출처·키 문제).
   * 경로 없음은 카카오의 답을 프록시가 422로 싣는 것이라 잠깐이 아니다. 네트워크 예외는 호출부가 잠깐으로 본다.
   * @param {{ok:boolean,status:number}} response @returns {boolean}
   */
  function transientRouteFailure(response){ return !response.ok&&response.status!==422; }

  /**
   * 실패 기록이 아직 재조회를 막는가 — 경로 없음(`permanent`)은 하루, 잠깐인 실패는 10분.
   * 실패가 아니거나 TTL이 지났거나 시각이 미래(기기 시계가 바뀜)면 false.
   * @param {any} entry @param {number} now @returns {boolean}
   */
  function legFailActive(entry,now){
    if(!entry||!entry.fail) return false;
    const age=now-Number(entry.fail);
    return age>=0&&age<(entry.permanent?LEG_NOROUTE_TTL_MS:LEG_FAIL_TTL_MS);
  }

  /**
   * 기기에 남길 구간 캐시 — 저장·불러오기 때 지난다(메모리의 캐시는 그대로 둔다).
   * - 잠깐인 실패는 남기지 않는다. 남기면 오프라인 한 순간이 그 기기에서 영원한 직선 추정이 된다.
   *   경로 없음(`permanent`)은 TTL 동안 남긴다 — 다시 열 때마다 인근 도로 탐색을 되풀이하지 않게.
   * - 출발 시각이 박힌 대중교통 키(`…@시간대@ISO`)는 그 시각이 지나면 다시 쓰이지 않으므로 버린다
   *   (지난 출발 시각은 기본 키로 묻는다 — app.js `planDepartISO`).
   * - `keepSince` 뒤에 쓴 항목(`at`)은 상한과 상관없이 남긴다 — 지금 열어 둔 여행의 구간이다. 상한보다 구간이 많은
   *   여행이 저장할 때마다 제 구간을 버리고 다음에 열 때 다시 묻지 않게. 상한은 남은 자리에서 나머지에만 건다.
   * - 나머지는 마지막으로 쓴 때(`at`)가 오래된 것부터 버린다. `at`이 없는 예전 항목이 먼저 나간다.
   * @param {Record<string,any>|null|undefined} cache @param {number} now @param {number} [max] @param {number} [keepSince]
   * @returns {Record<string,any>}
   */
  function compactLegCache(cache,now,max,keepSince){
    const limit=max==null?LEG_CACHE_MAX:max;
    /** @type {[string,any][]} */
    const kept=[];
    /** @type {[string,any][]} */
    const rest=[];
    for(const [key,entry] of Object.entries(cache||{})){
      if(!entry||typeof entry!=='object') continue;
      if(entry.fail&&!(entry.permanent&&legFailActive(entry,now))) continue;
      const sep=key.lastIndexOf('@');
      if(sep>=0&&!(Date.parse(key.slice(sep+1))>now)) continue;
      (keepSince!=null&&Number(entry.at)>=keepSince?kept:rest).push([key,entry]);
    }
    rest.sort((a,b)=>(Number(b[1].at)||0)-(Number(a[1].at)||0));
    return Object.fromEntries(kept.concat(rest.slice(0,Math.max(0,limit-kept.length))));
  }

  const API={createRoutingClient,transientRouteFailure,legFailActive,compactLegCache,LEG_FAIL_TTL_MS,LEG_NOROUTE_TTL_MS,LEG_CACHE_MAX};
  if(typeof module!=='undefined'&&module.exports)module.exports=API;
  else /** @type {any} */(root).TC_ROUTING=API;
})(typeof window!=='undefined'?window:globalThis);
