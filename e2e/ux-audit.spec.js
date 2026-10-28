const {test,expect}=require('@playwright/test');
const {prepare,createTrip,clickMore}=require('./helpers');

// feat/ux-structure-audit (2026-10-16) — 실제 브라우저에서만 보이는 것:
//   AC-10·AC-11 후보를 넣을 날짜 목록(키보드·포커스 복귀) / AC-12 로그인 칸 옆 오류 / AC-14 터치 높이.
// 기준은 .claude/agent-work/spec.md. 순수 로직·배선은 test/에 있다.

test.beforeEach(async({context})=>{ await prepare(context); });

async function candidateScene(page,{fail=false}={}){
  await page.goto('/');
  await createTrip(page,'E2E 날짜 목록');
  await page.evaluate(({fail})=>{
    user={id:'u1'};
    const id=store.activeId;
    // 둘째 날을 만들어 목록이 둘 이상이게 한다
    syncMeta[id]={revision:3,status:'clean'};
    tripRoles[id]={role:'EDITOR',count:2,owner:false,serverId:''};
    window.__sent=[];
    window.__rows=[{id:1,title:'카사 바트요',status:'PROPOSED',lat:41.39,lng:2.16,
      must_count:1,ok_count:0,pass_count:0,my_reaction:'MUST',proposed_by_label:'민수',mine:true,created_at:'2026-01-01',
      reactions:[{user_id:'u1',name:'민수',reaction:'MUST',me:true}]}];
    window.__fail=fail;
    TC_API.rpc=async(name,args)=>{ window.__sent.push([name,args]);
      if(name==='list_trip_members') return {data:[],error:null};
      if(name==='list_trip_candidates') return {data:window.__rows,error:null};
      if(name==='manage_trip_candidate'){
        if(window.__fail) return {data:null,error:{message:'Failed to fetch'}};
        const r=window.__rows.find(x=>x.id===args.p_candidate_id); if(r) r.status='SCHEDULED'; return {data:true,error:null}; }
      return {data:[],error:null}; };
    window.prompt=()=>{ window.__prompted=true; return '1'; };
  },{fail});
  await clickMore(page,'#candMenuBtn');
}

test('AC-10·AC-11: 일정에 넣기는 날짜 목록을 열고, 화살표로 고르고 Enter로 넣으며, Esc는 아무것도 바꾸지 않고 연 버튼으로 돌아온다',async({page})=>{
  await candidateScene(page);
  const open=page.locator('.candActions button',{hasText:'일정에 넣기'}).first();
  await expect(open).toBeVisible();
  await open.focus();
  await page.keyboard.press('Enter');

  const dlg=page.locator('#modePicker');
  await expect(dlg).toBeVisible();
  expect(await page.evaluate(()=>!!window.__prompted)).toBe(false);
  const opts=page.locator('#modePickerList .modeOpt');
  expect(await opts.count()).toBeGreaterThanOrEqual(2);
  await expect(opts.first()).toContainText(/^Day 1 · /);
  // Tab 정지는 목록 전체가 한 번 — 고른 항목에 포커스가 있다
  await expect(page.locator('#modePickerList .modeOpt[aria-checked="true"]')).toBeFocused();

  // Esc: 닫히고 아무것도 들어가지 않고, 포커스는 연 버튼으로
  await page.keyboard.press('Escape');
  await expect(dlg).toBeHidden();
  expect(await page.evaluate(()=>trip().days.reduce((n,d)=>n+d.spots.length,0))).toBe(0);
  expect(await page.evaluate(()=>window.__sent.filter(x=>x[0]==='manage_trip_candidate').length)).toBe(0);
  await expect(open).toBeFocused();

  // 다시 열어 화살표로 옮기고 Enter — 화살표만으로는 적용되지 않는다
  await page.keyboard.press('Enter');
  await expect(dlg).toBeVisible();
  const n=await opts.count();
  await page.keyboard.press('End');
  await expect(opts.nth(n-1)).toHaveAttribute('aria-checked','true');
  expect(await page.evaluate(()=>trip().days.reduce((n,d)=>n+d.spots.length,0))).toBe(0);
  await page.keyboard.press('Home');
  await expect(opts.first()).toHaveAttribute('aria-checked','true');
  await page.keyboard.press('ArrowDown');
  await expect(opts.nth(1)).toHaveAttribute('aria-checked','true');
  await page.keyboard.press('Enter');
  await expect(dlg).toBeHidden();
  const spots=await page.evaluate(()=>trip().days.map(d=>d.spots.map(s=>s.name)));
  expect(spots[1]).toEqual(['카사 바트요']);   // 고른 날의 맨 뒤
  expect(spots[0]).toEqual([]);
  await expect(page.locator('#toast')).toContainText('일정에 넣었어요');
});

test('AC-3: 표시 저장이 실패해도 장소는 남고 "표시만 못 했어요"가 화면에 남는다 — 다시 시도하면 한 번만 들어가 있다',async({page})=>{
  await candidateScene(page,{fail:true});
  await page.locator('.candActions button',{hasText:'일정에 넣기'}).first().click();
  await page.locator('#modePickerList .modeOpt',{hasText:/^Day 1/}).click();
  const toast=page.locator('#toast');
  await expect(toast).toContainText('Day 1에 넣었어요');
  await expect(toast).toContainText('후보 표시만');
  await expect(toast).not.toHaveText('변경을 저장하지 못했어요');
  expect(await page.evaluate(()=>trip().days[0].spots.map(s=>s.name))).toEqual(['카사 바트요']);
  // 연결이 돌아온 뒤 '표시 다시 시도'
  await page.evaluate(()=>{ window.__fail=false; });
  await toast.locator('button',{hasText:'표시 다시 시도'}).click();
  await expect(toast).toContainText('일정에 넣었어요');
  expect(await page.evaluate(()=>trip().days[0].spots.map(s=>s.name))).toEqual(['카사 바트요']);
});

test('AC-12: 로그인 창 — 이메일 형식이 틀리면 칸 아래에 이유가 남고 포커스가 가며, 고치면 지워진다. 8자 미만 비밀번호도 같다',async({page})=>{
  await page.goto('/');
  await page.evaluate(()=>openAuthModal());
  await page.locator('#authEmail').fill('이메일아님');
  await page.locator('#authPass').fill('12345678');
  await page.locator('#authLogin').click();
  await expect(page.locator('#authEmailErr')).toContainText('이메일');
  await expect(page.locator('#authEmailErr')).toHaveAttribute('role','alert');
  await expect(page.locator('#authEmail')).toBeFocused();
  await expect(page.locator('#authEmail')).toHaveAttribute('aria-invalid','true');
  await page.locator('#authEmail').fill('a@example.com');
  await expect(page.locator('#authEmailErr')).toHaveCount(0);

  await page.locator('#authPass').fill('1234567');
  await page.locator('#authSignup').click();
  await expect(page.locator('#authPassErr')).toContainText('8자 이상');
  await expect(page.locator('#authPass')).toBeFocused();
  await page.locator('#authPass').fill('12345678');
  await expect(page.locator('#authPassErr')).toHaveCount(0);
});

// AC-14: 같은 마크업을 pointer:fine / pointer:coarse에서 재 본다 — 겉모양(데스크톱)은 그대로, 손가락이 닿는 높이만 44px.
const TARGETS=[
  ['.btn.sm','<button class="btn sm">작은</button>'],
  ['.candOption .btn','<div class="candOption"><button class="btn">선택지</button></div>'],
  ['.proposalActions .btn','<div class="proposalActions"><button class="btn">제안</button></div>'],
  ['.pxActions .btn','<div class="pxActions"><button class="btn">가격</button></div>'],
];
async function heights(page){
  return page.evaluate((targets)=>{
    const host=document.createElement('div'); host.id='probeHost'; host.style.cssText='position:fixed;left:0;top:0;z-index:9999;background:#fff';
    document.body.appendChild(host);
    const out={coarse:matchMedia('(pointer:coarse)').matches};
    for(const [sel,html] of targets){
      host.innerHTML=html;
      const el=host.querySelector('button');
      out[sel]=Math.round(el.getBoundingClientRect().height);
    }
    // 실제 마크업의 새로고침 버튼 두 개는 숨은 창 안이라 크기를 잴 수 없다 — 계산된 min-height(규칙이 닿았는가)를 본다
    for(const id of ['membersRefresh','candRefresh']){
      const el=document.getElementById(id);
      out[id]=el? parseFloat(getComputedStyle(el).minHeight)||0 : -1;
    }
    out.realIds=['membersRefresh','candRefresh'].every(id=>!!document.getElementById(id));
    return out;
  },TARGETS);
}
test('AC-14(데스크톱): 작은 버튼의 겉모양은 그대로다 — 44px로 부풀지 않는다',async({page})=>{
  await page.goto('/');
  const h=await heights(page);
  expect(h.coarse).toBe(false);
  expect(h['.btn.sm']).toBeLessThan(40);
  expect(h['.candOption .btn']).toBeLessThan(40);
  expect(h['.proposalActions .btn']).toBeLessThan(40);
  expect(h.realIds).toBe(true);
  expect(h.membersRefresh).toBeLessThan(40);
  expect(h.candRefresh).toBeLessThan(40);
});
test.describe('AC-14(터치 기기)',()=>{
  test.use({viewport:{width:390,height:844},hasTouch:true,isMobile:true});
  test('pointer:coarse에서 작은 버튼 여섯 종류의 터치 높이가 44px 이상이다',async({page})=>{
    await page.goto('/');
    const h=await heights(page);
    expect(h.coarse).toBe(true);
    for(const [sel] of TARGETS) expect(h[sel],sel).toBeGreaterThanOrEqual(44);
    expect(h.membersRefresh,'#membersRefresh').toBeGreaterThanOrEqual(44);
    expect(h.candRefresh,'#candRefresh').toBeGreaterThanOrEqual(44);
  });
});
