const {test,expect}=require('@playwright/test');
const {prepare}=require('./helpers');

test.beforeEach(async({context,page})=>{await prepare(context);await page.goto('/');});

test('장소·일자 점 메뉴의 편집은 Safari에서도 클릭 전에 닫히지 않는다',async({page})=>{
  // Safari는 버튼을 눌러도 포커스를 주지 않고 tabindex가 있는 일정 패널로 옮긴다.
  // 이때 focusout으로 메뉴를 닫으면 mouseup이 다른 요소에 도착해 편집 click이 사라진다.
  for(const mobile of [false,true]){
    await page.setViewportSize(mobile?{width:390,height:844}:{width:1280,height:720});
    const spot=page.locator('.spot .actionMenu').first();
    await spot.locator('summary').click();
    await spot.locator('button[title="편집"]').click();
    await expect(page.locator('#spotModalBg')).toBeVisible();
    await expect(page.locator('#spotName')).toHaveValue('바라하스 공항 (MAD)');
    await page.locator('#spotCancel').click();

    const day=page.locator('.dayHead .actionMenu').first();
    await day.locator('summary').click();
    await day.locator('button[title="일자 편집"]').click();
    await expect(page.locator('#dayModalBg')).toBeVisible();
    await expect(page.locator('#dayModalTitle')).toContainText('Day 1 편집');
    await page.locator('#dayCancel').click();

    // Tab으로 메뉴 밖으로 나가면 기존대로 닫혀야 한다.
    await spot.locator('summary').click();
    await spot.locator('button[title="삭제"]').focus();
    await page.keyboard.press('Tab');
    await expect(spot).not.toHaveAttribute('open','');
  }
});

