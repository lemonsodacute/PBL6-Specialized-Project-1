import { expect, test, type Page } from '@playwright/test';
import { uiSession } from './ui-fixtures';

const key = 'proctoowl-sidebar-collapsed';
const route = { student: '/student', teacher: '/teacher', admin: '/admin' };
async function visit(page: Page, role: keyof typeof route = 'student', saved?: boolean) {
  await uiSession(page, role);
  await page.context().addCookies([{ name: 'auth_token', value: `fixture.${Buffer.from(JSON.stringify({role})).toString('base64url')}.signature`, url: process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000' }]);
  if (saved !== undefined) await page.addInitScript(({key,saved}) => {
    if (!sessionStorage.getItem('sidebar-fixture-pref')) { localStorage.setItem(key,String(saved)); sessionStorage.setItem('sidebar-fixture-pref','yes'); }
  },{key,saved});
  await page.goto(route[role]);
  // Keep Next.js development tools from intercepting the bottom Help icon.
  await page.addStyleTag({ content: 'nextjs-portal { display: none !important; }' });
}
const sidebar = (page: Page) => page.locator('#workspace-sidebar');
const collapsed = (page: Page) => expect(page.locator('.app-shell')).toHaveAttribute('data-sidebar-collapsed','true');
async function width(page: Page, expected: number) {
  await expect.poll(async()=>Math.round((await sidebar(page).boundingBox())!.width)).toBe(expected);
}

for(const role of ['student','teacher','admin'] as const)test(`${role}: collapse gains content width, keeps named routes and persists across reload`,async({page})=>{
  await visit(page,role);const toggle=page.getByRole('button',{name:'Thu gọn thanh điều hướng',exact:true});
  await expect(toggle).toBeEnabled();await width(page,260);
  await expect(sidebar(page).getByRole('button',{name:'Thu gọn thanh điều hướng',exact:true})).toBeVisible();
  await expect(page.locator('.topbar').getByRole('button',{name:/thanh điều hướng/})).toHaveCount(0);
  // Measure the settled layout: initial data/font loading also repositions the
  // collision-aware chat launcher, independently of sidebar collapse.
  await expect(page.locator('main .loading-skeleton')).toHaveCount(0);
  await page.evaluate(()=>document.fonts.ready);
  // A legacy brand rule used transparent text fill, hiding Teacher/Admin wordmarks
  // even though their text, font size and normal color were present.
  await expect(sidebar(page).locator('.brand')).toHaveCSS('-webkit-text-fill-color','rgb(255, 255, 255)');
  await expect(sidebar(page).locator('.brand')).toHaveCSS('font-size','24px');
  await page.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))));
  const before=(await page.locator('.workspace').boundingBox())!;
  const expandedRail=(await sidebar(page).boundingBox())!,toggleBox=(await toggle.boundingBox())!;
  expect(toggleBox.x).toBeGreaterThanOrEqual(expandedRail.x+expandedRail.width-60);
  expect(toggleBox.x+toggleBox.width).toBeLessThanOrEqual(expandedRail.x+expandedRail.width);
  const routeBefore=page.url();
  const chat=page.getByRole('button',{name:'Mở tin nhắn hỗ trợ',exact:true});const chatBefore=await chat.boundingBox();
  const home=sidebar(page).locator('nav a').first();const homeName=await home.innerText();const homeHref=await home.getAttribute('href');
  await page.screenshot({path:`artifacts/collapsible-sidebar/${role}-expanded.png`});
  await toggle.click();await collapsed(page);await width(page,80);
  const expand=sidebar(page).getByRole('button',{name:'Hiện thanh điều hướng',exact:true});
  await expect(expand).toBeVisible();
  const expandBox=(await expand.boundingBox())!,rail=(await sidebar(page).boundingBox())!;
  expect(expandBox.width).toBeGreaterThanOrEqual(44);
  expect(expandBox.x).toBeGreaterThanOrEqual(rail.x);
  expect(expandBox.x+expandBox.width).toBeLessThanOrEqual(rail.x+rail.width);
  const after=(await page.locator('.workspace').boundingBox())!;
  expect(page.url()).toBe(routeBefore);
  expect(Math.round(after.width-before.width)).toBe(180);expect(Math.round(after.x)).toBe(Math.round(rail.x+rail.width));
  const headerInset=await page.locator('.topbar').evaluate(el=>parseFloat(getComputedStyle(el).marginLeft));
  expect(await page.locator('.topbar').evaluate(el=>Math.round(el.getBoundingClientRect().left))).toBe(Math.round(after.x+headerInset));
  await expect(sidebar(page).getByRole('link',{name:homeName,exact:true})).toHaveAttribute('href',homeHref!);
  await expect(sidebar(page).locator('nav [aria-current="page"]')).toHaveCount(1);
  expect(await sidebar(page).locator('.brand').evaluate(el=>getComputedStyle(el).backgroundImage)).toContain('proctoowl-mark.svg');
  await expect(sidebar(page).locator('.brand')).toHaveCSS('background-repeat','no-repeat');
  await expect(sidebar(page).locator('.brand')).toHaveCSS('background-position','50% 50%');
  expect(await sidebar(page).evaluate(el=>getComputedStyle(el).backgroundColor)).toBe('rgb(0, 109, 119)');
  if(role==='student') {
    for(const name of ['Trang chủ','Lớp học phần','Lớp học trực tuyến','Bài kiểm tra','Điểm số / Kết quả','Cài đặt','Trợ giúp']) {
      const icon=sidebar(page).getByRole(name==='Bài kiểm tra'?'button':'link',{name,exact:true});
      await icon.hover();await expect(page.getByRole('tooltip',{name,exact:true})).toBeVisible();
      await page.mouse.move(700,100);await icon.focus();
      await expect(page.getByRole('tooltip',{name,exact:true})).toBeVisible();
      await page.keyboard.press('Escape');await expect(page.getByRole('tooltip')).toHaveCount(0);
    }
    const active=sidebar(page).locator('nav [aria-current="page"]');
    expect(await active.evaluate(el=>getComputedStyle(el).backgroundColor)).not.toBe('rgba(0, 0, 0, 0)');
    expect(await active.locator('.nav-label').evaluate(el=>getComputedStyle(el).clipPath)).toBe('inset(50%)');
  }
  const settings=sidebar(page).getByRole('link',{name:'Cài đặt',exact:true});
  await settings.hover();await expect(page.getByRole('tooltip',{name:'Cài đặt',exact:true})).toBeVisible();
  await page.getByRole('tooltip',{name:'Cài đặt',exact:true}).hover();await expect(page.getByRole('tooltip',{name:'Cài đặt',exact:true})).toBeVisible();
  await page.mouse.move(700,100);await settings.focus();await expect(page.getByRole('tooltip',{name:'Cài đặt',exact:true})).toBeVisible();
  await page.keyboard.press('Escape');await expect(page.getByRole('tooltip')).toHaveCount(0);
  if(chatBefore){const box=(await chat.boundingBox())!;expect(box.x).toBe(chatBefore.x);expect(box.y).toBe(chatBefore.y);}
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(1440);
  await page.screenshot({path:`artifacts/collapsible-sidebar/${role}-collapsed.png`});
  expect(await page.evaluate(key=>localStorage.getItem(key),key)).toBe('true');
  await page.reload();await expect(page.getByRole('button',{name:'Hiện thanh điều hướng',exact:true})).toBeEnabled();await width(page,80);
  await page.getByRole('button',{name:'Hiện thanh điều hướng',exact:true}).click();await width(page,260);
  expect(await page.evaluate(key=>localStorage.getItem(key),key)).toBe('false');
  expect(page.url()).toBe(routeBefore);
  if(role==='student')await expect(sidebar(page).locator('.student-profile')).toContainText('Nguyễn Minh Anh');
});

test('student compact submenu supports keyboard, Escape, outside click and existing child navigation',async({page})=>{
  await visit(page,'student',true);await collapsed(page);await width(page,80);
  const group=sidebar(page).getByRole('button',{name:'Bài kiểm tra',exact:true});
  await group.focus();await page.keyboard.press('ArrowRight');
  const flyout=page.getByRole('region',{name:'Bài kiểm tra',exact:true});
  await expect(flyout.getByRole('link',{name:'Làm kiểm tra',exact:true})).toBeFocused();
  await page.keyboard.press('ArrowDown');await expect(flyout.getByRole('link',{name:'Lịch sử làm bài',exact:true})).toBeFocused();
  await page.screenshot({path:'artifacts/collapsible-sidebar/student-flyout.png'});
  await page.keyboard.press('Escape');await expect(flyout).toHaveCount(0);await expect(group).toBeFocused();
  await group.click();await flyout.getByRole('link',{name:'Lịch sử làm bài',exact:true}).click();
  await expect(page).toHaveURL(/\/student\/history$/);await expect(flyout).toHaveCount(0);await collapsed(page);
  await expect(group).toHaveClass(/is-active/);
  await group.click();await expect(flyout.getByRole('link',{name:'Lịch sử làm bài',exact:true})).toHaveAttribute('aria-current','page');
  await page.mouse.click(700,100);await expect(flyout).toHaveCount(0);
  await group.click();await flyout.getByRole('link',{name:'Lịch sử làm bài',exact:true}).focus();await page.keyboard.press('Tab');
  await expect(flyout).toHaveCount(0);await expect(sidebar(page).getByRole('link',{name:'Điểm số / Kết quả',exact:true})).toBeFocused();
  await page.getByRole('button',{name:'Hiện thanh điều hướng',exact:true}).click();
  await expect(sidebar(page).getByRole('link',{name:'Lịch sử làm bài',exact:true})).toBeVisible();
});

test('admin compact flyouts preserve both groups and fit a short scrolling sidebar',async({page})=>{
  await page.setViewportSize({width:1280,height:560});await visit(page,'admin',true);await collapsed(page);
  const users=sidebar(page).getByRole('button',{name:'Quản lý người dùng',exact:true});await users.click();
  const panel=page.getByRole('region',{name:'Quản lý người dùng',exact:true});
  await expect(panel.getByRole('link',{name:'Danh sách người dùng',exact:true})).toHaveAttribute('href','/dashboard/users');
  await expect(panel.getByRole('link',{name:'Xác thực thẻ sinh viên',exact:true})).toHaveAttribute('href','/admin/student-cards');
  await page.keyboard.press('Escape');
  await sidebar(page).getByRole('button',{name:'AI Support',exact:true}).click();
  const ai=page.getByRole('region',{name:'AI Support',exact:true});await expect(ai).toBeVisible();
  const box=(await ai.boundingBox())!;expect(box.x).toBeGreaterThan(70);expect(box.y).toBeGreaterThanOrEqual(12);expect(box.y+box.height).toBeLessThanOrEqual(548);
  await expect(ai.getByRole('link',{name:'Knowledge Base',exact:true})).toHaveAttribute('href','/admin/ai-support/knowledge');
  await page.screenshot({path:'artifacts/collapsible-sidebar/admin-flyout.png'});
  await page.setViewportSize({width:1300,height:600});await expect(ai).toHaveCount(0);
});

for(const size of [390,768])test(`${size}px: saved desktop preference uses a full-width mobile/tablet drawer`,async({page})=>{
  await page.setViewportSize({width:size,height:900});await visit(page,'student',true);
  await expect(sidebar(page)).toBeHidden();await expect(page.getByRole('button',{name:'Hiện thanh điều hướng',exact:true})).toBeHidden();
  const workspace=(await page.locator('.workspace').boundingBox())!;expect(workspace.x).toBe(0);expect(workspace.width).toBe(size);
  const menu=page.getByRole('button',{name:'Mở menu',exact:true});await expect(menu).toBeEnabled();await menu.click();
  const dialog=page.getByRole('dialog',{name:'Menu điều hướng'});await expect(dialog).toBeVisible();
  await expect.poll(async()=>Math.round((await dialog.boundingBox())!.x)).toBe(8);
  await expect(dialog.getByRole('link',{name:'Lớp học phần',exact:true})).toBeVisible();
  expect(await dialog.locator('.nav-label').first().evaluate(el=>getComputedStyle(el).clipPath)).toBe('none');
  await page.evaluate(()=>document.fonts.ready);
  await page.screenshot({path:`artifacts/collapsible-sidebar/drawer-${size}.png`,animations:'disabled'});
  await dialog.getByRole('button',{name:'Đóng menu',exact:true}).click();await expect(dialog).toHaveCount(0);await expect(menu).toBeFocused();
  await menu.click();
  await page.keyboard.press('Escape');await expect(dialog).toHaveCount(0);await expect(menu).toBeFocused();
  await menu.click();await page.getByRole('button',{name:'Đóng menu bên ngoài',exact:true}).click({position:{x:size-12,y:650}});await expect(dialog).toHaveCount(0);
  await menu.click();await dialog.getByRole('link',{name:'Lớp học phần',exact:true}).click();await expect(page).toHaveURL(/\/student\/classes$/);await expect(dialog).toHaveCount(0);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(size);
  expect(await page.evaluate(key=>localStorage.getItem(key),key)).toBe('true');
});

test('resizing a drawer back to desktop restores compact preference and releases scroll lock',async({page})=>{
  await visit(page,'student',true);await collapsed(page);await page.setViewportSize({width:768,height:900});
  await page.getByRole('button',{name:'Mở menu',exact:true}).click();await expect(page.getByRole('dialog')).toBeVisible();
  await page.setViewportSize({width:1440,height:960});await expect(page.getByRole('dialog')).toHaveCount(0);await collapsed(page);await width(page,80);
  expect(await page.evaluate(()=>document.body.style.overflow)).not.toBe('hidden');
});

test('reduced motion disables width transitions and dark compact icons retain readable focus',async({page})=>{
  await page.emulateMedia({reducedMotion:'reduce',colorScheme:'dark'});await visit(page);
  await page.getByRole('button',{name:'Thu gọn thanh điều hướng',exact:true}).click();await width(page,80);
  // Existing global reduced-motion CSS uses a 0.01ms !important duration.
  expect(await sidebar(page).evaluate(el=>getComputedStyle(el).transitionProperty)).toBe('none');
  expect(await sidebar(page).evaluate(el=>parseFloat(getComputedStyle(el).transitionDuration))).toBeLessThanOrEqual(.001);
  const home=sidebar(page).getByRole('link',{name:'Trang chủ',exact:true});await home.focus();
  await page.keyboard.press('Shift+Tab');await page.keyboard.press('Tab');await expect(home).toBeFocused();
  await expect(page.getByRole('tooltip',{name:'Trang chủ',exact:true})).toBeVisible();
  expect(await home.evaluate(el=>getComputedStyle(el).outlineStyle)).not.toBe('none');
  await page.screenshot({path:'artifacts/collapsible-sidebar/student-collapsed-dark.png'});
});

test('blocked localStorage does not prevent collapsing or navigating',async({page})=>{
  await page.addInitScript(key=>{
    const get=Storage.prototype.getItem,set=Storage.prototype.setItem;
    Storage.prototype.getItem=function(name){if(this===localStorage&&name===key)throw new DOMException('Blocked','SecurityError');return get.call(this,name);};
    Storage.prototype.setItem=function(name,value){if(this===localStorage&&name===key)throw new DOMException('Blocked','SecurityError');return set.call(this,name,value);};
  },key);
  await visit(page);await page.getByRole('button',{name:'Thu gọn thanh điều hướng',exact:true}).click();await collapsed(page);await width(page,80);
  await sidebar(page).getByRole('link',{name:'Cài đặt',exact:true}).click();await expect(page).toHaveURL(/\/student\/settings$/);
});
