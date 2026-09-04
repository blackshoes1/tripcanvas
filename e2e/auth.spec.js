const {test,expect}=require('@playwright/test');
const {prepare}=require('./helpers');

// 자체 Auth로 넘어간 웹(PR11). 실제 브라우저에서 확인하는 것은 셋이다:
//   1. 무엇으로 로그인할지는 **서버가 정한다** — 웹이 고르지 않는다
//   2. 예전 사용자가 들어올 수 있는가(§19) — 비밀번호 해시를 옮기지 않으므로 재설정 길이 반드시 열려 있어야 한다
//   3. 계정이 있는지 **떠볼 수 없다** — 재설정 응답은 이메일이 있든 없든 같다
//
// 규칙 자체는 test/auth-client.test.js가, 서버 판정은 authConfig.test.ts가 본다. 여기는 배선이다.

/** 자체 Auth를 쓰는 서버인 척한다 */
async function fakeApi(context,options={}){
  await context.addInitScript(({signInStatus})=>{
    window.__calls=[];
    window.__TC_API_BASE='https://api.e2e.test';
    const originalFetch=window.fetch;
    window.fetch=async(url,init)=>{
      const u=String(url&&url.url?url.url:url), method=(init&&init.method)||'GET';
      if(u.indexOf('https://api.e2e.test/')!==0) return originalFetch(url,init);
      const path=u.replace('https://api.e2e.test','');
      window.__calls.push([path,method,init&&init.body?JSON.parse(init.body):null]);

      if(path==='/api/v1/auth-config') return new Response(JSON.stringify({provider:'TRIPCANVAS',passwordResetRequiredForLegacyUsers:true}),{status:200});
      if(path==='/api/auth/sign-in/email'){
        if(signInStatus!==200) return new Response(JSON.stringify({message:'Invalid email or password'}),{status:signInStatus});
        return new Response(JSON.stringify({user:{id:'u1',email:'a@example.com'}}),
          {status:200,headers:{'set-auth-token':'tok-e2e','content-type':'application/json'}});
      }
      // 재설정은 계정 유무를 알려주지 않는다 — 서버도 같은 답을 준다
      if(path==='/api/auth/request-password-reset') return new Response('{}',{status:200});
      // 새 비밀번호 — 링크는 한 번만 쓸 수 있다. 만료·재사용은 400이다
      if(path==='/api/auth/reset-password'){
        const body=init&&init.body?JSON.parse(init.body):{};
        if(body.token!=='good-token') return new Response(JSON.stringify({message:'invalid token'}),{status:400});
        return new Response('{}',{status:200});
      }
      if(path==='/api/v1/me') return new Response(JSON.stringify({trips:[],realtime:{provider:'NONE',url:null}}),{status:200});
      if(path==='/api/v1/trips') return new Response(JSON.stringify({trips:[]}),{status:200});
      return new Response('{}',{status:200});
    };
    // Supabase SDK는 실려 있지만 로그인에는 쓰이지 않아야 한다
    window.__supabaseAuthUsed=false;
    window.supabase={createClient:()=>({
      auth:{
        onAuthStateChange(){ window.__supabaseAuthUsed=true; return {data:{subscription:{unsubscribe(){}}}}; },
        getSession:async()=>({data:{session:null}}),
        signInWithPassword:async()=>{ window.__supabaseAuthUsed=true; return {error:null}; },
        signUp:async()=>({data:{},error:null}), signOut:async()=>{}
      },
      from:()=>({select:()=>({eq:async()=>({data:[],error:null}),is:()=>({order:async()=>({data:[],error:null})})}),insert:async()=>({error:null})})
    })};
  },{signInStatus:options.signInStatus||401});
}

async function openLogin(page){
  await page.locator('#moreBtn').click();
  await page.locator('#authBtn').click();
  await expect(page.locator('#authModalBg')).toHaveClass(/show/);
}

test.beforeEach(async({context})=>{ await prepare(context); });

test('서버가 자체 Auth라고 하면 Supabase 로그인을 쓰지 않는다',async({context,page})=>{
  await fakeApi(context,{signInStatus:200});
  await page.goto('/');
  await openLogin(page);
  await page.locator('#authEmail').fill('a@example.com');
  await page.locator('#authPass').fill('pw123456');
  await page.locator('#authLogin').click();

  await expect(page.locator('#authModalBg')).not.toHaveClass(/show/);
  await expect(page.locator('#authBtn')).toContainText('a');           // 로그인 배지
  expect(await page.evaluate(()=>window.__supabaseAuthUsed)).toBe(false);
  const paths=await page.evaluate(()=>window.__calls.map(c=>c[0]));
  expect(paths).toContain('/api/auth/sign-in/email');
  // 세션 토큰은 헤더로 받아 둔다 — 교차 출처라 쿠키를 쓰지 않는다
  expect(await page.evaluate(()=>localStorage.getItem('tripcanvas_auth_v1'))).toBe('tok-e2e');
});

test('예전 계정으로 로그인 실패하면 "틀렸다"로 끝내지 않고 가입 길을 연다 (§19)',async({context,page})=>{
  await fakeApi(context,{signInStatus:401});
  await page.goto('/');
  await openLogin(page);
  await expect(page.locator('#authResetHint')).toBeHidden();   // 처음부터 보이지는 않는다

  await page.locator('#authEmail').fill('old@example.com');
  await page.locator('#authPass').fill('pw123456');
  await page.locator('#authLogin').click();

  await expect(page.locator('#authResetHint')).toBeVisible();
  // 예전 계정에는 새 Auth의 계정 행이 없어 재설정이 닿지 않는다 — 길은 같은 이메일로 **가입**이다
  await expect(page.locator('#authResetHint')).toContainText('가입');
  await expect(page.locator('#authSignup')).toBeVisible();
  await expect(page.locator('#authModalBg')).toHaveClass(/show/);   // 모달은 열린 채 — 바로 이어서 할 수 있게
  await expect(page.locator('#authReset')).toBeVisible();
});

test('재설정 요청은 계정 유무를 알려주지 않는다',async({context,page})=>{
  await fakeApi(context);
  await page.goto('/');
  await openLogin(page);
  await page.locator('#authEmail').fill('없는사람@example.com');
  await page.locator('#authReset').click();

  await expect(page.locator('#toast')).toContainText('가입된 이메일이라면');
  const reset=await page.evaluate(()=>window.__calls.filter(c=>c[0]==='/api/auth/request-password-reset'));
  expect(reset.length).toBe(1);
  expect(reset[0][2].email).toBe('없는사람@example.com');
  // 응답 문구가 "없는 계정"이라고 말하지 않는다
  await expect(page.locator('#toast')).not.toContainText('없');
});

test('이메일 없이 재설정을 누르면 서버에 보내지 않는다',async({context,page})=>{
  await fakeApi(context);
  await page.goto('/');
  await openLogin(page);
  await page.locator('#authReset').click();
  await expect(page.locator('#toast')).toContainText('이메일을 먼저');
  expect(await page.evaluate(()=>window.__calls.filter(c=>c[0].indexOf('/api/auth/')===0).length)).toBe(0);
});

// 메일의 재설정 링크로 들어오는 길 — API 호스트에는 화면이 없어서 링크는 웹으로 온다(#reset=<token>).
test('#reset= 링크로 새 비밀번호를 정하고, 토큰은 주소창에 남지 않는다',async({context,page})=>{
  await fakeApi(context);
  await page.goto('/#reset=good-token');

  await expect(page.locator('#resetModalBg')).toHaveClass(/show/);
  expect(await page.evaluate(()=>location.hash)).toBe('');   // 토큰을 기록에 남기지 않는다

  await page.locator('#resetPass').fill('12345');
  await page.locator('#resetSubmit').click();
  await expect(page.locator('#toast')).toContainText('6자 이상');   // 짧으면 서버까지 가지 않는다
  expect(await page.evaluate(()=>window.__calls.filter(c=>c[0]==='/api/auth/reset-password').length)).toBe(0);

  await page.locator('#resetPass').fill('newpw123456');
  await page.locator('#resetSubmit').click();

  await expect(page.locator('#resetModalBg')).not.toHaveClass(/show/);
  await expect(page.locator('#authModalBg')).toHaveClass(/show/);   // 바로 로그인으로 이어 준다
  const sent=await page.evaluate(()=>window.__calls.find(c=>c[0]==='/api/auth/reset-password'));
  expect(sent[2]).toEqual({newPassword:'newpw123456',token:'good-token'});
});

test('만료된 재설정 링크는 다시 요청하라고 말한다 — 조용히 실패하지 않는다',async({context,page})=>{
  await fakeApi(context);
  await page.goto('/#reset=stale-token');
  await page.locator('#resetPass').fill('newpw123456');
  await page.locator('#resetSubmit').click();
  await expect(page.locator('#toast')).toContainText('다시 요청');
  await expect(page.locator('#resetModalBg')).toHaveClass(/show/);   // 열어 둔다 — 새 링크를 받아 다시 넣을 수 있게
});

test('가입 확인을 마치고 돌아오면 로그인으로 이어 준다',async({context,page})=>{
  await fakeApi(context);
  await page.goto('/#verified=1');
  await expect(page.locator('#toast')).toContainText('이메일이 확인됐어요');
  await expect(page.locator('#authModalBg')).toHaveClass(/show/);
  expect(await page.evaluate(()=>location.hash)).toBe('');
});
