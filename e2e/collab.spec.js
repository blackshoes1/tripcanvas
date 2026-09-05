const {test,expect}=require('@playwright/test');
const {prepare,createTrip,clickMore}=require('./helpers');

// 함께하기 — 실제 브라우저에서 초대 링크·진입점이 동작하는지.
// 로그인·역할은 Supabase 대역으로, **함께하기는 TripCanvas API를 가로채** 대신한다(PR12) — 네트워크 없이도 흐름은 그대로여야 한다.
// 접근 제어 자체는 test/rls.integration.test.js가 DB에서, 규칙은 collabService.test.ts가 PGlite에서 검증한다.
const TOKEN='E2E_'+'t'.repeat(28);

async function fakeSupabase(context,options={}){
  await context.addInitScript(({token,preview})=>{
    window.__rpc=[];
    // 함께하기는 이제 TripCanvas API를 지난다(PR12). api.js보다 먼저 도는 스크립트라 TC_API를 아직 못 바꾼다 —
    // fetch를 가로채면 로드 순서를 타지 않는다.
    window.__TC_API_BASE='https://api.e2e.test';
    const originalFetch=window.fetch;
    window.fetch=async(url,init)=>{
      const u=String(url&&url.url?url.url:url), method=(init&&init.method)||'GET';
      if(u.indexOf('https://api.e2e.test/')!==0) return originalFetch(url,init);
      const path=u.replace('https://api.e2e.test','');
      // /api/v1/auth-config는 부팅 때 무엇으로 로그인할지 묻는 것이라 데이터 호출이 아니다(PR11).
      // 여기 섞으면 "초대 때 무엇을 보냈나"를 보는 검사가 흔들린다.
      if(path.indexOf('/api/v1/auth-config')!==0) window.__rpc.push([path,method]);
      const body=u.indexOf('/api/v1/invites/')>=0 ? {preview} : {};
      return new Response(JSON.stringify(body),{status:200,headers:{'content-type':'application/json'}});
    };
    window.supabase={createClient:()=>({
      auth:{
        onAuthStateChange(cb){ setTimeout(()=>cb('INITIAL_SESSION',null),0); return {data:{subscription:{unsubscribe(){}}}}; },
        getSession:async()=>({data:{session:null}}),   // 로그아웃 상태 — 미리보기는 토큰 없이도 된다
        signInWithPassword:async()=>({error:null}), signUp:async()=>({data:{},error:null}), signOut:async()=>{}
      },
      rpc:async(name,args)=>{ window.__rpc.push([name,args]);
        if(name==='invite_preview') return {data:[preview],error:null};
        if(name==='my_trip_roles') return {data:[],error:null};
        return {data:null,error:null}; },
      from:()=>({select:()=>({eq:async()=>({data:[],error:null}),is:()=>({order:async()=>({data:[],error:null})})}),insert:async()=>({error:null})})
    })};
  },{token:TOKEN,preview:options.preview||{valid:true,reason:'OK',trip_name:'스페인 여행',start_date:'2026-10-25',day_count:14,role:'EDITOR',already_member:false}});
}

test.beforeEach(async({context})=>{ await prepare(context); });

test('초대 링크(#join=)로 열면 여행 본문 없이 미리보기와 참여 안내가 뜬다',async({context,page})=>{
  await fakeSupabase(context);
  await page.goto('/#join='+TOKEN);
  await expect(page.locator('#joinModalBg')).toHaveClass(/show/);
  await expect(page.locator('#joinTripName')).toHaveText('스페인 여행');
  await expect(page.locator('#joinTripMeta')).toContainText('10/25 ~ 11/7 · 14일');
  await expect(page.locator('#joinTripMeta')).toContainText('편집 권한');
  await expect(page.locator('#joinAccept')).toHaveText('로그인하고 참여하기');
  const rpc=await page.evaluate(()=>window.__rpc);
  expect(rpc[0][0]).toBe('/api/v1/invites/'+TOKEN);   // 토큰만 실려 간다 — 여행 id·역할은 URL에 없다(§5)
  expect(rpc[0][1]).toBe('GET');
  await expect(page.locator('#tripSel')).not.toContainText('스페인 여행');   // 참여 전에는 여행이 내려오지 않는다
  // 로그인하고 참여하기 → 로그인 모달
  await page.locator('#joinAccept').click();
  await expect(page.locator('#authModalBg')).toHaveClass(/show/);
  await page.locator('#authCancel').click();
  // 나중에 → 모달이 닫히고 해시가 정리된다
  await page.locator('#joinCancel').click();
  await expect(page.locator('#joinModalBg')).not.toHaveClass(/show/);
  expect(await page.evaluate(()=>location.hash)).toBe('');
});

test('만료된 초대는 참여 버튼 없이 이유만 보여준다',async({context,page})=>{
  await fakeSupabase(context,{preview:{valid:false,reason:'EXPIRED',trip_name:'스페인 여행',role:'VIEWER'}});
  await page.goto('/#join='+TOKEN);
  await expect(page.locator('#joinModalBg')).toHaveClass(/show/);
  await expect(page.locator('#joinHint')).toContainText('만료');
  await expect(page.locator('#joinAccept')).toBeHidden();
});

test('형식이 어긋난 #join= 해시는 서버에 보내지 않고 조용히 무시한다',async({context,page})=>{
  await fakeSupabase(context);
  await page.goto('/#join=<script>alert(1)</script>');
  await page.waitForTimeout(300);
  await expect(page.locator('#joinModalBg')).not.toHaveClass(/show/);
  expect(await page.evaluate(()=>window.__rpc.length)).toBe(0);
});

test('로그아웃 상태: 헤더 배지는 숨고, 메뉴의 함께하기는 로그인으로 안내한다',async({context,page})=>{
  await fakeSupabase(context);
  await page.goto('/');
  await createTrip(page,'E2E 협업');
  await expect(page.locator('#membersBtn')).toBeHidden();
  await expect(page.locator('#roleBar')).toBeHidden();
  await clickMore(page,'#membersMenuBtn');
  await expect(page.locator('#authModalBg')).toHaveClass(/show/);
  await expect(page.locator('#toast')).toContainText('로그인하면');
  // 혼자 쓰는 여행은 예전처럼 전부 편집된다(§95)
  await page.locator('#authCancel').click();
  await expect(page.locator('.addSpot').first()).toBeVisible();
  expect(await page.evaluate(()=>readOnly())).toBe(false);
});

test('로그아웃 상태: 가고 싶은 곳도 로그인으로 안내한다 — 혼자 쓰는 여행은 그대로 편집된다(§95)',async({context,page})=>{
  await fakeSupabase(context);
  await page.goto('/');
  await createTrip(page,'E2E 후보');
  await clickMore(page,'#candMenuBtn');
  await expect(page.locator('#authModalBg')).toHaveClass(/show/);
  await expect(page.locator('#toast')).toContainText('로그인하면');
  await expect(page.locator('#candModalBg')).not.toHaveClass(/show/);
  await page.locator('#authCancel').click();
  await expect(page.locator('.addSpot').first()).toBeVisible();
});

test('후보 보드: 한 번의 탭으로 의견을 바꾸고, 다시 누르면 거둔다',async({context,page})=>{
  await fakeSupabase(context);
  await page.goto('/');
  await createTrip(page,'E2E 후보');
  // 로그인한 편집자 상태로 만들고 서버 응답을 후보 하나로 고정한다
  await page.evaluate(()=>{
    user={id:'u1'};
    const id=store.activeId;
    syncMeta[id]={revision:3,status:'clean'};
    tripRoles[id]={role:'EDITOR',count:3,owner:false};
    window.__sent=[];
    TC_API.rpc=async(name,args)=>{ window.__sent.push([name,args]);
      if(name==='list_trip_candidates') return {data:[{id:1,title:'사그라다 파밀리아',status:'PROPOSED',
        must_count:2,ok_count:0,pass_count:0,my_reaction:null,proposed_by_label:'민수',mine:false,
        created_at:'2026-01-01',reactions:[{name:'민수',reaction:'MUST',me:false},{name:'영희',reaction:'MUST',me:false}]}],error:null};
      return {data:true,error:null}; };
  });
  await clickMore(page,'#candMenuBtn');
  await expect(page.locator('#candModalBg')).toHaveClass(/show/);
  await expect(page.locator('.candCard')).toContainText('사그라다 파밀리아');
  await expect(page.locator('.candCard')).toContainText('민수가 추가');
  // 셋 중 하나도 눌려 있지 않다
  await expect(page.locator('.candReact button[aria-pressed="true"]')).toHaveCount(0);
  await page.locator('.candReact button', {hasText:'꼭 가고 싶어요'}).click();
  await expect(page.locator('.candReact button[aria-pressed="true"]')).toHaveCount(1);
  expect(await page.evaluate(()=>window.__sent.filter(x=>x[0]==='react_to_candidate').map(x=>x[1].p_reaction))).toEqual(['MUST']);
  // 마음이 바뀌면 표가 옮겨간다 — 한 사람 한 표
  await page.locator('.candReact button', {hasText:'이번엔 패스'}).click();
  await expect(page.locator('.candReact button[aria-pressed="true"]')).toHaveCount(1);
  await expect(page.locator('.candReact button[aria-pressed="true"]')).toContainText('이번엔 패스');
  // 눌린 것을 다시 누르면 의견을 거둔다
  await page.locator('.candReact button', {hasText:'이번엔 패스'}).click();
  await expect(page.locator('.candReact button[aria-pressed="true"]')).toHaveCount(0);
  expect(await page.evaluate(()=>window.__sent.filter(x=>x[0]==='react_to_candidate').map(x=>x[1].p_reaction))).toEqual(['MUST','PASS',null]);
});

test('후보 한마디: 펼치면 불러오고, 남기면 바로 목록에 붙는다',async({context,page})=>{
  await fakeSupabase(context);
  await page.goto('/');
  await createTrip(page,'E2E 한마디');
  await page.evaluate(()=>{
    user={id:'u1'};
    const id=store.activeId;
    syncMeta[id]={revision:3,status:'clean'};
    tripRoles[id]={role:'EDITOR',count:3,owner:false,serverId:''};
    window.__sent=[]; window.__cm=[{id:1,body:'야경 보고 저녁 먹자',author_label:'민수',mine:false,created_at:'2026-09-02T10:00:00Z'}];
    TC_API.rpc=async(name,args)=>{ window.__sent.push([name,args]);
      if(name==='list_trip_candidates') return {data:[{id:1,title:'사그라다 파밀리아',status:'PROPOSED',must_count:1,ok_count:0,pass_count:0,
        comment_count:window.__cm.length,my_reaction:null,proposed_by_label:'민수',mine:false,created_at:'2026-01-01',reactions:[]}],error:null};
      if(name==='list_candidate_comments') return {data:window.__cm,error:null};
      if(name==='add_candidate_comment'){ window.__cm=window.__cm.concat([{id:2,body:args.p_body,author_label:'나',mine:true,created_at:'2026-09-02T10:05:00Z'}]); return {data:2,error:null}; }
      return {data:true,error:null}; };
  });
  await clickMore(page,'#candMenuBtn');
  const cbtn=page.locator('.candActions button',{hasText:'💬'});
  await expect(cbtn).toHaveText('💬 1');
  await expect(page.locator('.candComments')).toHaveCount(0);
  await cbtn.click();
  await expect(page.locator('.commentRow')).toHaveCount(1);
  await expect(page.locator('.commentRow').first()).toContainText('야경 보고 저녁 먹자');
  await page.locator('.commentForm input').fill('저녁 예약이랑 가까움');
  await page.locator('.commentForm input').press('Enter');
  await expect(page.locator('.commentRow')).toHaveCount(2);
  await expect(cbtn).toHaveText('💬 2');
  expect(await page.evaluate(()=>window.__sent.find(x=>x[0]==='add_candidate_comment')[1])).toEqual({p_candidate_id:1,p_body:'저녁 예약이랑 가까움'});
});

test('함께하기 모달의 최근 활동은 사람 말 한 줄이고, 실시간이 없으면 그렇다고 표시한다',async({context,page})=>{
  await fakeSupabase(context);
  await page.goto('/');
  await createTrip(page,'E2E 활동');
  await page.evaluate(()=>{
    user={id:'u1'};
    const id=store.activeId;
    syncMeta[id]={revision:3,status:'clean'};
    tripRoles[id]={role:'OWNER',count:2,owner:true,serverId:''};
    TC_API.rpc=async(name)=>{
      if(name==='list_trip_members') return {data:[{id:1,user_id:'u1',role:'OWNER',status:'ACTIVE',display_name:'민수',joined_at:null,me:true},{id:2,user_id:'u2',role:'EDITOR',status:'ACTIVE',display_name:'영희',joined_at:'2026-09-01',me:false}],error:null};
      if(name==='list_trip_activity') return {data:[
        {id:2,kind:'REACTION',actor_label:'영희',mine:false,subject:{title:'구엘 공원',candidate_id:1,reaction:'MUST'},created_at:'2026-09-02T10:05:00Z'},
        {id:1,kind:'CANDIDATE_PROPOSED',actor_label:'영희',mine:false,subject:{title:'구엘 공원',candidate_id:1},created_at:'2026-09-02T10:00:00Z'}],error:null};
      return {data:[],error:null}; };
  });
  await clickMore(page,'#membersMenuBtn');
  await expect(page.locator('#membersModalBg')).toHaveClass(/show/);
  await expect(page.locator('#activityList .activityRow')).toHaveCount(2);
  await expect(page.locator('#activityList')).toContainText('영희님이 구엘 공원을 "꼭 가고 싶어요"로 골랐어요');
  await expect(page.locator('#activityList')).toContainText('영희님이 구엘 공원을 후보로 담았어요');
  await expect(page.locator('#liveState')).toContainText('새로고침으로 갱신');
});

test('여행 취향: 칩 한 번의 탭으로 고르고 저장하면 정규화된 값이 가고, 그룹 요약이 문장으로 바뀐다',async({context,page})=>{
  await fakeSupabase(context);
  await page.goto('/');
  await createTrip(page,'E2E 취향');
  await page.evaluate(()=>{
    user={id:'u1'};
    const id=store.activeId;
    syncMeta[id]={revision:3,status:'clean'};
    tripRoles[id]={role:'OWNER',count:2,owner:true,serverId:''};
    window.__sent=[];
    window.__rows=[{user_id:'u1',label:'민수',role:'OWNER',mine:true,prefs:{}},
                   {user_id:'u2',label:'영희',role:'EDITOR',mine:false,prefs:{pace:'RELAXED',interests:['미술관']}}];
    TC_API.rpc=async(name,args)=>{ window.__sent.push([name,args]);
      if(name==='list_trip_members') return {data:[{id:1,user_id:'u1',role:'OWNER',status:'ACTIVE',display_name:'민수',joined_at:null,me:true},{id:2,user_id:'u2',role:'EDITOR',status:'ACTIVE',display_name:'영희',joined_at:'2026-09-01',me:false}],error:null};
      if(name==='list_trip_preferences') return {data:window.__rows,error:null};
      if(name==='set_trip_preference'){ window.__rows=window.__rows.map(r=>r.mine?Object.assign({},r,{prefs:args.p_prefs}):r); return {data:args.p_prefs,error:null}; }
      return {data:[],error:null}; };
  });
  await clickMore(page,'#membersMenuBtn');
  await expect(page.locator('#membersModalBg')).toHaveClass(/show/);
  await expect(page.locator('#prefGroup')).toContainText('2명 중 1명이 취향을 남겼어요');
  await expect(page.locator('#prefOthers')).toContainText('영희: 여유롭게 · 관심: 미술관');
  await page.locator('#prefSection .prefChips[data-pref="pace"] button',{hasText:'여유롭게'}).click();
  await page.locator('#prefSection .prefChips[data-pref="interests"] button',{hasText:'미술관'}).click();
  await page.locator('#prefSection .prefChips[data-pref="time"] button',{hasText:'늦은 밤은 싫어요'}).click();
  await page.locator('#prefNote').fill('  신혼여행이라 여유롭게 ');
  await page.locator('#prefSave').click();
  await expect(page.locator('#toast')).toContainText('취향을 저장했어요');
  expect(await page.evaluate(()=>window.__sent.find(x=>x[0]==='set_trip_preference')[1].p_prefs))
    .toEqual({pace:'RELAXED',night:false,interests:['미술관'],note:'신혼여행이라 여유롭게'});
  // 다시 읽은 그룹 요약: 둘 다 여유롭게 · 둘 다 미술관
  await expect(page.locator('#prefGroup')).toContainText('2명 중 2명이 취향을 남겼어요');
  await expect(page.locator('#prefGroup')).toContainText('2명이 "여유롭게"를 원해요');
  await expect(page.locator('#prefGroup')).toContainText('함께 관심: 미술관');
  await expect(page.locator('#prefGroup')).toContainText('늦은 밤은 싫어요 (나)');
  await expect(page.locator('#prefSection .prefChips[data-pref="pace"] button[aria-pressed="true"]')).toHaveText('여유롭게');
});

test('갈린 후보: 선택지에서 "이번 일정에서는 제외"를 고르면 뺀 묶음으로 가고, 되돌릴 수 있다 · 반대 없는 후보는 제안 카드에 정리된다',async({context,page})=>{
  await fakeSupabase(context);
  await page.goto('/');
  await createTrip(page,'E2E 결정');
  await page.evaluate(()=>{
    user={id:'u1'};
    const id=store.activeId;
    syncMeta[id]={revision:3,status:'clean'};
    tripRoles[id]={role:'EDITOR',count:3,owner:false,serverId:''};
    window.__sent=[];
    window.__rows=[
      {id:1,title:'캄프 누',status:'PROPOSED',must_count:1,ok_count:0,pass_count:1,my_reaction:null,proposed_by_label:'민수',mine:false,created_at:'2026-01-01',
       reactions:[{name:'민수',reaction:'MUST',me:false},{name:'영희',reaction:'PASS',me:false}]},
      {id:2,title:'구엘 공원',status:'PROPOSED',must_count:2,ok_count:1,pass_count:0,my_reaction:null,proposed_by_label:'민수',mine:false,created_at:'2026-01-02',
       reactions:[{name:'민수',reaction:'MUST',me:false},{name:'영희',reaction:'MUST',me:false},{name:'철수',reaction:'OK',me:false}]}];
    TC_API.rpc=async(name,args)=>{ window.__sent.push([name,args]);
      if(name==='list_trip_candidates') return {data:window.__rows,error:null};
      if(name==='manage_trip_candidate'){ const r=window.__rows.find(x=>x.id===args.p_candidate_id); if(r) r.status=args.p_action==='REJECT'?'REJECTED':'PROPOSED'; return {data:true,error:null}; }
      return {data:[],error:null}; };
  });
  await clickMore(page,'#candMenuBtn');
  await expect(page.locator('.proposalCard')).toBeVisible();
  await expect(page.locator('.proposalCard')).toContainText('이 1곳은 다들 좋아해요');
  await expect(page.locator('.proposalCard')).toContainText('구엘 공원');
  // 어느 날에 더해 그 날 언제인지까지(§63) — 자리를 찾았으면 시간대와 시각이 함께 나온다
  await expect(page.locator('.proposalCard .pt')).toHaveText(/Day \d+ (오전|점심|오후|저녁) \d\d:\d\d · 구엘 공원/);
  await expect(page.locator('.candConflict')).toContainText('의견이 갈려 있어요');
  await page.locator('.candOption[data-option="SKIP"] button').click();
  await expect(page.locator('#toast')).toContainText('이번 일정에서는 뺐어요');
  await expect(page.locator('.candGroup',{hasText:'이번엔 뺐어요'})).toBeVisible();
  await expect(page.locator('.candConflict')).toHaveCount(0);
  expect(await page.evaluate(()=>window.__sent.find(x=>x[0]==='manage_trip_candidate')[1])).toEqual({p_candidate_id:1,p_action:'REJECT',p_value:null});
  await page.locator('.candActions button',{hasText:'후보로 되돌리기'}).click();
  await expect(page.locator('#toast')).toContainText('후보로 되돌렸어요');
  await expect(page.locator('.candConflict')).toHaveCount(1);
});

test('갈린 후보를 "자유시간으로 분리"하면 같은 시간에 나란한 일정 두 개와 합류가 생기고, 일정에 참여자가 보인다',async({context,page})=>{
  await fakeSupabase(context);
  await page.goto('/');
  await createTrip(page,'E2E 분리');
  const U1='11111111-1111-4111-8111-111111111111';
  const U2='22222222-2222-4222-8222-222222222222';
  await page.evaluate(({u1,u2})=>{
    user={id:'u1'};
    const id=store.activeId;
    syncMeta[id]={revision:3,status:'clean'};
    tripRoles[id]={role:'EDITOR',count:2,owner:false,serverId:''};
    tripMembers=[{user_id:u1,display_name:'민수',me:true},{user_id:u2,display_name:'영희',me:false}];
    window.__sent=[];
    window.__rows=[{id:1,title:'캄프 누',status:'PROPOSED',lat:41.38,lng:2.12,
      must_count:1,ok_count:0,pass_count:1,my_reaction:'MUST',proposed_by_label:'민수',mine:true,created_at:'2026-01-01',
      reactions:[{user_id:u1,name:'민수',reaction:'MUST',me:true},{user_id:u2,name:'영희',reaction:'PASS',me:false}]}];
    // 웹은 함께하기를 TC_API로 지난다(Supabase RPC 직접 호출 없음) — 다른 시나리오와 같은 자리에 건다.
    TC_API.rpc=async(name,args)=>{ window.__sent.push([name,args]);
      if(name==='list_trip_candidates') return {data:window.__rows,error:null};
      if(name==='manage_trip_candidate'){ const r=window.__rows.find(x=>x.id===args.p_candidate_id); if(r) r.status='SCHEDULED'; return {data:true,error:null}; }
      return {data:[],error:null}; };
    window.prompt=()=>'1';
  },{u1:U1,u2:U2});

  await clickMore(page,'#candMenuBtn');
  await expect(page.locator('.candConflict')).toContainText('의견이 갈려 있어요');
  await page.locator('.candOption[data-option="SPLIT"] button').click();
  await expect(page.locator('#toast')).toContainText('같은 시간에 나란히 넣었어요');

  // 저장된 일정: 가는 쪽 · 자유시간 · 합류
  const spots=await page.evaluate(()=>trip().days[0].spots.map(s=>({name:s.name,who:s.who||null,split:s.split||null,reunion:!!s.reunion})));
  expect(spots.map(s=>s.name)).toEqual(['캄프 누','자유시간','다시 만나기']);
  expect(spots[0].who).toEqual([U1]);
  expect(spots[1].who).toEqual([U2]);
  expect(spots[0].split).toBe(spots[1].split);
  expect(spots[2].reunion).toBe(true);

  // 닫고 사이드바에서 확인 — 나란한 두 줄은 같은 시각에서 시작하고, 참여자와 합류가 보인다
  await page.locator('#candClose').click();
  await expect(page.locator('#sidebar .spot.inSplit')).toHaveCount(2);
  await expect(page.locator('#sidebar .spot.isReunion')).toHaveCount(1);
  await expect(page.locator('#sidebar .spot.inSplit').first().locator('.whoChip')).toContainText('나');
  await expect(page.locator('#sidebar .spot.inSplit').nth(1).locator('.whoChip')).toContainText('영희');
  const etas=await page.evaluate(()=>[...document.querySelectorAll('#sidebar .spot.inSplit .spotTime')].map(e=>e.textContent.replace(/[^\d:]/g,'')));
  expect(etas[0]).toBe(etas[1]);
});
