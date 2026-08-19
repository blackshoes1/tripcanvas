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
        if(!response.ok) return {code:(json&&Number(json.code))||-1};
        const route=json&&json.route;
        if(!route) return {code:-1};
        if(route.result_code!==0||!route.summary) return {code:route.result_code};
        return {rt:route};
      }catch(_){return {code:-1};}
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

  const API={createRoutingClient};
  if(typeof module!=='undefined'&&module.exports)module.exports=API;
  else /** @type {any} */(root).TC_ROUTING=API;
})(typeof window!=='undefined'?window:globalThis);
