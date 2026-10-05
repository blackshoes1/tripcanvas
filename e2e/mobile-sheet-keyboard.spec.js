// #341(모바일 한 손 탐색) 뒤에 드러난 두 회귀를 막는다(2026-10-05 UX 점검).
//  1) 창 안 Tab 순환 규칙이 처음 화면에서 모든 창으로 넓어지며, 제목·접기 머리(summary)에서 Tab이 멈췄다.
//  2) 하단 동작 바(115px)가 생긴 만큼 시트가 위로 밀려, 375×812에서 지도가 38px만 보였다(전에는 153px).
const {test,expect}=require('@playwright/test');
const {prepare}=require('./helpers');

/** 창 안에서 Tab을 누른 뒤 포커스가 닿은 요소를 읽는다 — 눈에 보이는 곳이어야 한다 */
async function focusState(page,bgSelector){
  return page.evaluate(sel=>{
    const bg=document.querySelector(sel), a=document.activeElement;
    const closed=a&&a.closest('details:not([open])');
    const hiddenInClosed=!!closed&&!(a.tagName==='SUMMARY'&&a.parentElement===closed);
    const r=a&&a.getBoundingClientRect();
    return {inside:!!bg&&bg.contains(a), tag:a&&a.tagName, id:a&&a.id, visible:!!r&&r.width>0&&r.height>0&&!hiddenInClosed};
  },bgSelector);
}

for(const [name,size] of [['모바일',{width:375,height:812}],['데스크톱',{width:1280,height:800}]]){
  test.describe(`${name} 장소 편집기의 Tab`,()=>{
    test.beforeEach(async({context,page})=>{
      await prepare(context);
      await page.setViewportSize(size);
      await page.goto('/');
      await page.evaluate(()=>openSpotModal(0,1));
      await expect(page.locator('#spotModalBg')).toHaveClass(/show/);
    });

    test('제목에서 Tab을 누르면 창 안의 보이는 첫 칸으로 간다',async({page})=>{
      await page.locator('#spotModalTitle').focus();
      await page.keyboard.press('Tab');
      const s=await focusState(page,'#spotModalBg');
      expect(s.inside).toBe(true);
      expect(s.id).not.toBe('spotModalTitle');
      expect(s.visible).toBe(true);
    });

    test('접기 머리(summary)에서 Tab을 누르면 다음 칸으로 가고 멈추지 않는다',async({page})=>{
      const head=page.locator('#spotAdmBox > summary');
      await head.focus();
      await page.keyboard.press('Tab');
      const s=await focusState(page,'#spotModalBg');
      expect(s.inside).toBe(true);
      expect(await head.evaluate(el=>el===document.activeElement),'같은 머리에 머문다').toBe(false);
      expect(s.visible).toBe(true);
    });

    test('Tab을 계속 눌러도 포커스는 창 안의 보이는 곳만 지나 한 바퀴 돈다',async({page})=>{
      await page.locator('#spotModalTitle').focus();
      const seen=new Set();
      for(let i=0;i<60;i++){
        await page.keyboard.press('Tab');
        const s=await focusState(page,'#spotModalBg');
        expect(s.inside,`${i}번째 Tab`).toBe(true);
        expect(s.visible,`${i}번째 Tab — 접힌 칸에 포커스가 들어갔다`).toBe(true);
        seen.add(await page.evaluate(()=>{ const a=document.activeElement; return (a.id||a.tagName)+':'+(a.textContent||'').trim().slice(0,12); }));
      }
      expect(seen.size).toBeGreaterThan(8);
    });

    test('Shift+Tab은 제목에서 마지막 칸으로 간다',async({page})=>{
      await page.locator('#spotModalTitle').focus();
      await page.keyboard.press('Shift+Tab');
      const s=await focusState(page,'#spotModalBg');
      expect(s.inside).toBe(true);
      expect(s.visible).toBe(true);
    });
  });
}

test.describe('모바일 일정 시트 높이',()=>{
  test.beforeEach(async({context,page})=>{
    await prepare(context);
    await page.setViewportSize({width:375,height:812});
    await page.goto('/');
    await expect(page.locator('#mobilePlanActions')).toBeVisible();
    await expect(page.locator('#sampleBar')).toBeVisible();   // 샘플 띠·일자 칩이 그려진 뒤의 높이를 잰다
    await expect(page.locator('#filterbar .chip').first()).toBeVisible();
    await page.waitForTimeout(500);
  });

  /** 시트 위로 지도가 보이는 높이 — 필터바 아래 끝에서 시트 위 끝까지 */
  const mapGap=page=>page.evaluate(()=>{
    const fb=document.getElementById('filterbar').getBoundingClientRect().bottom, sb=document.getElementById('sidebar').getBoundingClientRect().top;
    return Math.round(sb-fb);
  });

  test('처음 열면 지도가 알아볼 만큼 보인다 — 시트 위 끝이 화면의 38% 아래에 있다',async({page})=>{
    // 하단 바(115px)가 생기기 전 시트는 화면의 60%라 위 끝이 40%였다. 바만큼 시트를 줄이지 않으면 26%까지 밀려 지도가 거의 안 보인다
    const top=await page.evaluate(()=>document.getElementById('sidebar').getBoundingClientRect().top/innerHeight);
    expect(top).toBeGreaterThanOrEqual(0.38);
    expect(await mapGap(page)).toBeGreaterThanOrEqual(120);
  });

  test('접힘 < 반 < 펼침이고, 시트는 하단 바 바로 위에서 끝난다',async({page})=>{
    const heights={};
    for(const snap of ['collapsed','half','expanded']){
      await page.evaluate(s=>setSheetSnap(s),snap);
      await page.waitForTimeout(450);   // 높이 전환
      heights[snap]=await page.evaluate(()=>{
        const sb=document.getElementById('sidebar').getBoundingClientRect(), bar=document.getElementById('mobilePlanActions').getBoundingClientRect();
        return {h:Math.round(sb.height), gapToBar:Math.round(bar.top-sb.bottom)};
      });
      expect(Math.abs(heights[snap].gapToBar),`${snap}: 시트와 하단 바 사이`).toBeLessThanOrEqual(1);
    }
    expect(heights.collapsed.h).toBeLessThan(heights.half.h);
    expect(heights.half.h).toBeLessThan(heights.expanded.h);
    expect(heights.collapsed.h).toBeGreaterThanOrEqual(48);   // 손잡이(40px)는 늘 눌린다
  });

  test('손잡이를 끌면 가까운 단계로 붙는다',async({page})=>{
    const grab=async(dy)=>{
      const b=await page.locator('#sheetHandle').boundingBox();
      const x=b.x+b.width/2, y=b.y+20;
      await page.mouse.move(x,y); await page.mouse.down();
      await page.mouse.move(x,y+dy/2,{steps:4}); await page.mouse.move(x,y+dy,{steps:4}); await page.mouse.up();
      await page.waitForTimeout(450);
    };
    await grab(-200);
    expect(await page.locator('#sidebar').getAttribute('data-snap')).toBe('expanded');
    await grab(60);   // 조금만 내리면 그대로 펼침
    expect(await page.locator('#sidebar').getAttribute('data-snap')).toBe('expanded');
    await grab(250);
    expect(await page.locator('#sidebar').getAttribute('data-snap')).toBe('half');
    await grab(300);
    expect(await page.locator('#sidebar').getAttribute('data-snap')).toBe('collapsed');
  });
});
