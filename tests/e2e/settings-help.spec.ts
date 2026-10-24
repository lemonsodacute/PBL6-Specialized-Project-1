import { expect, test, type Page } from '@playwright/test';
import { uiSession } from './ui-fixtures';
import type { PersonalSettings, SystemSettings } from '../../lib/settings';

async function setup(page: Page, role: 'student' | 'teacher' | 'admin') {
  await uiSession(page, role);
  await page.context().addCookies([{ name: 'auth_token', value: `fixture.${Buffer.from(JSON.stringify({ role })).toString('base64url')}.signature`, url: 'http://localhost:3000' }]);
  const system: SystemSettings = { exam_duration_minutes:60, exam_require_camera:true, exam_require_mic:true, support_text:'Liên hệ văn phòng khoa để được hỗ trợ.', updated_at:'2026-10-12T00:00:00Z' };
  const personal: PersonalSettings = { theme:'light', notification_preferences:role === 'teacher' ? { violation_alert:true, exam_summary:true } : role === 'admin' ? { profile_verification_request:true } : {},
    notification_options:role === 'teacher' ? [{key:'violation_alert',label:'Cảnh báo giám sát'},{key:'exam_summary',label:'Tổng kết kỳ thi'}] : role === 'admin' ? [{key:'profile_verification_request',label:'Yêu cầu xác minh hồ sơ mới'}] : [],
    exam_defaults:role === 'student' ? null : { exam_duration_minutes:60, exam_require_camera:true, exam_require_mic:true },
    exam_overrides:role === 'teacher' ? { exam_duration_minutes:null, exam_require_camera:null, exam_require_mic:null } : null, updated_at:null };
  const state = { personal, system, patches:[] as Record<string,unknown>[], systemPatches:[] as Record<string,unknown>[], status:200, loadStatus:200, gate:null as Promise<void>|null };
  const headers = { 'access-control-allow-origin':'http://localhost:3000','access-control-allow-credentials':'true','access-control-allow-headers':'authorization,content-type','access-control-allow-methods':'GET,PATCH,OPTIONS' };
  await page.route('**/api/v1/settings/me', async route => {
    const method = route.request().method(); if (method === 'OPTIONS') return route.fulfill({status:204,headers});
    if (method === 'PATCH') {
      const body = route.request().postDataJSON(); state.patches.push(body);
      if (state.gate) await state.gate;
      if (state.status !== 200) return route.fulfill({status:state.status,headers,json:{error:{message:'PRIVATE_SERVER_ERROR'}}});
      if (body.theme) personal.theme=body.theme;
      if (body.notification_preferences) Object.assign(personal.notification_preferences,body.notification_preferences);
      if (personal.exam_overrides && personal.exam_defaults) for (const key of ['exam_duration_minutes','exam_require_camera','exam_require_mic'] as const) if (key in body) {
        (personal.exam_overrides as Record<string,unknown>)[key]=body[key];
        (personal.exam_defaults as unknown as Record<string,unknown>)[key]=body[key] ?? system[key];
      }
    } else if (state.loadStatus !== 200) return route.fulfill({status:state.loadStatus,headers,json:{error:{message:'PRIVATE_SERVER_ERROR'}}});
    return route.fulfill({headers,json:{data:personal}});
  });
  await page.route('**/api/v1/admin/settings', async route => {
    if (route.request().method()==='OPTIONS') return route.fulfill({status:204,headers});
    if (route.request().method()==='PATCH') { const body=route.request().postDataJSON();state.systemPatches.push(body); Object.assign(system,body); }
    return route.fulfill({headers,json:{data:system}});
  });
  await page.route('**/api/v1/settings/support', route => route.fulfill({headers,json:{data:{support_text:system.support_text}}}));
  return state;
}

for (const role of ['student','teacher','admin'] as const) test(`${role} settings and help use own sidebar, links and content`, async ({page}) => {
  test.setTimeout(120_000); await setup(page,role);
  await page.goto(`/${role}/settings`);
  await expect(page.getByRole('heading',{name:'Cài đặt cá nhân',exact:true})).toBeVisible();
  const sidebar=page.locator('#workspace-sidebar');
  await expect(sidebar).toHaveCount(1); await expect(sidebar.getByRole('link',{name:'Cài đặt',exact:true})).toHaveAttribute('aria-current','page');
  await expect(sidebar.getByRole('link',{name:'Trợ giúp',exact:true})).toHaveAttribute('href',`/${role}/help`);
  if (role !== 'admin') await expect(page.getByRole('heading',{name:'Cài đặt hệ thống'})).toHaveCount(0);
  if (role !== 'teacher') await expect(page.getByRole('form',{name:'Mặc định khi tạo đề'})).toHaveCount(0);
  await sidebar.getByRole('link',{name:'Trợ giúp',exact:true}).click();
  await expect(page.getByRole('searchbox',{name:'Tìm kiếm hướng dẫn'})).toBeVisible({timeout:45_000});
  await expect(sidebar.getByRole('link',{name:'Trợ giúp',exact:true})).toHaveAttribute('aria-current','page');
  await expect(page.getByRole('searchbox',{name:'Tìm kiếm hướng dẫn'})).toBeVisible();
  await expect(page.getByText('Liên hệ văn phòng khoa để được hỗ trợ.',{exact:true})).toBeVisible();
  const expected = role==='student' ? 'Xác thực thẻ sinh viên' : role==='teacher' ? 'Tạo câu hỏi từ Word/PDF' : 'Cài đặt hệ thống';
  await expect(page.getByRole('heading',{name:expected,exact:true})).toBeVisible();
  if (role==='student') { await expect(page.getByRole('heading',{name:'Tạo đề thi',exact:true})).toHaveCount(0); await expect(page.getByRole('heading',{name:'Cài đặt hệ thống',exact:true})).toHaveCount(0); }
});

test('theme saves only after response, persists reload and system follows OS', async ({page}) => {
  const state=await setup(page,'student'); await page.goto('/student/settings');
  const form=page.getByRole('form',{name:'Giao diện'});
  await expect(form.getByRole('button',{name:'Lưu thay đổi'})).toBeDisabled();
  await form.getByLabel('Chế độ giao diện').selectOption('dark');
  let release!:()=>void;state.gate=new Promise<void>(resolve=>{release=resolve;});
  await form.getByRole('button',{name:'Lưu thay đổi'}).click();
  await expect(form.getByRole('button',{name:'Đang lưu...'})).toBeDisabled();
  await expect(form.getByRole('status')).toHaveCount(0);
  await expect(page.locator('html')).toHaveAttribute('data-theme','light');
  release();state.gate=null;
  await expect(form.getByRole('status')).toContainText('Đã lưu cài đặt');
  await expect(page.locator('html')).toHaveAttribute('data-theme','dark');
  await page.reload();await expect(form.getByLabel('Chế độ giao diện')).toHaveValue('dark');await expect(page.locator('html')).toHaveAttribute('data-theme','dark');
  await form.getByLabel('Chế độ giao diện').selectOption('system');await form.getByRole('button',{name:'Lưu thay đổi'}).click();
  await expect(form.getByRole('status')).toBeVisible();
  await page.emulateMedia({colorScheme:'dark'});await expect(page.locator('html')).toHaveAttribute('data-theme','dark');
  await page.emulateMedia({colorScheme:'light'});await expect(page.locator('html')).toHaveAttribute('data-theme','light');
  expect(state.patches.map(item=>item.theme)).toEqual(['dark','system']);
  await expect(page.locator('input[type=file]')).toHaveCount(0);
});

test('failed save leaves preference unchanged, exposes safe retry and no success', async ({page}) => {
  const state=await setup(page,'student'); await page.goto('/student/settings');
  const form=page.getByRole('form',{name:'Giao diện'});await form.getByLabel('Chế độ giao diện').selectOption('dark');
  state.status=500;await form.getByRole('button',{name:'Lưu thay đổi'}).click();
  await expect(form.getByRole('alert')).toContainText('Không thể lưu cài đặt');await expect(form.getByRole('status')).toHaveCount(0);
  await expect(page.getByText('PRIVATE_SERVER_ERROR')).toHaveCount(0);expect(state.personal.theme).toBe('light');
  state.status=200;await form.getByRole('button',{name:'Lưu thay đổi'}).click();await expect(form.getByRole('status')).toBeVisible();
});

test('load failure has retry and no editable placeholder settings', async ({page}) => {
  const state=await setup(page,'student');state.loadStatus=500;await page.goto('/student/settings');
  await expect(page.locator('main').getByRole('alert')).toContainText('Không tải được cài đặt');
  await expect(page.getByRole('form',{name:'Giao diện'})).toHaveCount(0);
  state.loadStatus=200;await page.getByRole('button',{name:'Thử lại'}).click();
  await expect(page.getByRole('form',{name:'Giao diện'})).toBeVisible();
});

test('account cache cannot override server theme or leak another account preference', async ({page}) => {
  await setup(page,'student');
  await page.addInitScript(()=>{localStorage.setItem('ai-proctoring-theme:another-account','dark');localStorage.setItem('ai-proctoring-theme:11111111-1111-4111-8111-111111111111','dark');});
  await page.goto('/student/settings');
  await expect(page.getByLabel('Chế độ giao diện')).toHaveValue('light');
  await expect(page.locator('html')).toHaveAttribute('data-theme','light');
});

test('teacher saved duration is consumed by new exam form, notifications persist separately', async ({page}) => {
  const state=await setup(page,'teacher'); await page.route('**/api/v1/question-banks',route=>route.fulfill({headers:{'access-control-allow-origin':'http://localhost:3000','access-control-allow-credentials':'true'},json:{data:[]}}));
  await page.goto('/teacher/settings');const form=page.getByRole('form',{name:'Mặc định khi tạo đề'});
  await form.getByLabel('Dùng mặc định hệ thống').uncheck();await form.getByLabel('Thời lượng mặc định (phút)').fill('90');
  await form.getByRole('button',{name:'Lưu thay đổi'}).click();await expect(form.getByRole('status')).toBeVisible();
  expect(state.personal.exam_defaults?.exam_duration_minutes).toBe(90);
  const notifications=page.getByRole('form',{name:'Thông báo trong ứng dụng'});
  await notifications.getByLabel('Tổng kết kỳ thi').uncheck();await notifications.getByRole('button',{name:'Lưu thay đổi'}).click();await expect(notifications.getByRole('status')).toBeVisible();
  expect(state.personal.notification_preferences.exam_summary).toBe(false);expect(state.personal.exam_defaults?.exam_duration_minutes).toBe(90);
  await page.goto('/dashboard/exams?create=1');
  const dialog=page.getByRole('dialog',{name:'Tạo đề thi'});await expect(dialog.getByLabel('Thời lượng (phút)')).toHaveValue('90');
});

test('admin saves real fields and help reads current support text', async ({page}) => {
  const state=await setup(page,'admin');await page.goto('/admin/settings');
  const form=page.getByRole('form',{name:'Mặc định đề thi'});await form.getByLabel('Thời lượng mặc định (phút)').fill('120');
  await form.getByRole('button',{name:'Lưu thay đổi'}).click();await expect(form.getByRole('status')).toBeVisible();expect(state.systemPatches[0]).toEqual({exam_duration_minutes:120,exam_require_camera:true,exam_require_mic:true});
  const contact=page.getByRole('form',{name:'Thông tin hỗ trợ'});await contact.getByLabel('Hướng dẫn liên hệ hỗ trợ').fill('Vui lòng liên hệ phòng đào tạo.');await contact.getByRole('button',{name:'Lưu thay đổi'}).click();await expect(contact.getByRole('status')).toBeVisible();
  await page.reload();await expect(form.getByLabel('Thời lượng mặc định (phút)')).toHaveValue('120');
  await page.locator('#workspace-sidebar').getByRole('link',{name:'Trợ giúp',exact:true}).click();await expect(page.getByText('Vui lòng liên hệ phòng đào tạo.',{exact:true})).toBeVisible();
});

test('help search accepts unaccented Vietnamese and shows only matching guides', async ({page}) => {
  await setup(page,'teacher');await page.goto('/teacher/help');
  await page.getByLabel('Tìm kiếm hướng dẫn').fill('diem sinh vien');
  await expect(page.getByRole('heading',{name:'Xem điểm sinh viên và báo cáo'})).toBeVisible();
  await expect(page.getByRole('heading',{name:'Tạo đề thi',exact:true})).toHaveCount(0);
  await page.getByLabel('Tìm kiếm hướng dẫn').fill('no matching guide');await expect(page.getByText('Không tìm thấy hướng dẫn phù hợp.')).toBeVisible();
});

for (const role of ['student','teacher','admin'] as const) test(`${role} settings/help fit mobile and dark theme`, async ({page}) => {
  test.setTimeout(120_000); await page.setViewportSize({width:375,height:812});const state=await setup(page,role);state.personal.theme='dark';
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  for (const path of [`/${role}/settings`,`/${role}/help`]) {
    await page.goto(path);await expect(page.getByRole(path.endsWith('settings')?'heading':'searchbox',{name:path.endsWith('settings')?'Cài đặt cá nhân':'Tìm kiếm hướng dẫn',exact:true})).toBeVisible({timeout:45_000});
    await expect(page.locator('html')).toHaveAttribute('data-theme','dark');
    expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
    await page.getByRole('button',{name:'Mở menu',exact:true}).click();
    await expect(page.locator('#workspace-sidebar').getByRole('link',{name:path.endsWith('settings')?'Cài đặt':'Trợ giúp',exact:true})).toHaveAttribute('aria-current','page');
    await page.getByRole('button',{name:'Đóng menu',exact:true}).click();
  }
  expect(errors).toEqual([]);
});
