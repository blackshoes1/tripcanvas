const {test,expect}=require('@playwright/test');
const {prepare,clickMore}=require('./helpers');

test.beforeEach(async({context,page})=>{await prepare(context);await page.goto('/');});

test('모달은 포커스를 가두고 ESC로 닫은 뒤 호출 버튼에 돌려준다',async({page})=>{
  await clickMore(page,'#tripEditBtn');
  const dialog=page.locator('#tripModalBg .modal');
  await expect(dialog).toHaveAttribute('role','dialog');
  await expect(dialog).toHaveAttribute('aria-modal','true');
  await expect(page.locator('#tripName')).toBeFocused();

  await page.keyboard.press('Shift+Tab');
  await expect(page.locator('#tripSave')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.locator('#tripModalBg')).not.toHaveClass(/show/);
  await expect(page.locator('#moreBtn')).toBeFocused();
});

test('동적으로 생성된 클릭 영역은 Enter로 실행할 수 있다',async({page})=>{
  await page.locator('#tripPickerBtn').click();
  const row=page.locator('.tripRow .tn').first();
  await expect(row).toHaveAttribute('role','button');
  await expect(row).toHaveAttribute('tabindex','0');
  await row.focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#tripListBg')).not.toHaveClass(/show/);
});
