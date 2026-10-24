import { expect, test, type Locator, type Page, type Route } from '@playwright/test';
import { fixtureUser, uiSession } from './ui-fixtures';

const longText = 'Tên lớp học và nội dung rất dài cần hiển thị đầy đủ, không kéo ngang biểu mẫu. '.repeat(5);
const longEmail = `${'student'.repeat(12)}@university.example.edu.vn`;
const student = { ...fixtureUser, email: longEmail, full_name: 'Nguyễn Thị Minh Anh', student_code: '001IT123',
  identity_profile_status: 'PENDING', identity_profile_version: 3, phone: '+84901234567' };
const teacher = { ...fixtureUser, id: 'teacher-1', role: 'teacher', full_name: 'Giảng viên Nguyễn Văn An', email: longEmail };
const classItem = { id: 'class-1', name: longText, description: longText, homeroom_teacher_id: teacher.id,
  teacher, students_count: 1, exams_count: 0, created_at: '2026-01-02T00:00:00Z' };

async function respond(route: Route, data: unknown, meta?: unknown) {
  const headers = { 'access-control-allow-origin': route.request().headers().origin ?? 'http://localhost:3000',
    'access-control-allow-credentials': 'true', 'access-control-allow-headers': 'authorization,content-type',
    'access-control-allow-methods': 'GET,POST,PATCH,OPTIONS' };
  if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
  return route.fulfill({ headers, json: { data, ...(meta ? { meta } : {}) } });
}

async function managementSession(page: Page, role: 'teacher' | 'admin') {
  const session = await uiSession(page, role);
  session.classes = [classItem];
  await page.route('**/api/v1/question-banks**', route => {
    const path=new URL(route.request().url()).pathname,bank={id:'bank-1',name:longText,questions_count:1};
    return respond(route,path.endsWith('/questions')
      ? [{ id: 'q-1', content: longText + 'X'.repeat(120), type: 'mcq_single', default_points: 1, question_bank_id: 'bank-1' }]
      : path.endsWith('/bank-1')?bank:[bank]);
  });
  await page.route('**/api/v1/users**', route => {
    const url = new URL(route.request().url());
    if (url.pathname.includes('/profile-verification/')) return respond(route,
      [{ id: '22222222-2222-4222-8222-222222222222', status: 'PENDING', student, requested_at: '2026-10-09T01:00:00Z' }], { total: 1 });
    return respond(route, url.searchParams.get('role') === 'teacher' ? [teacher] : [student]);
  });
  await page.route('**/api/v1/classes/class-1**', route => {
    const path = new URL(route.request().url()).pathname;
    return respond(route, path.endsWith('/enrollments/available') ? [student] : path.endsWith('/enrollments') ? [] : classItem);
  });
  await page.route('**/api/v1/exam-assignments**', route => respond(route, []));
  if (role === 'admin') await page.context().addCookies([{ name: 'auth_token',
    value: `fixture.${Buffer.from(JSON.stringify({ role })).toString('base64url')}.fixture`, url: test.info().project.use.baseURL! }]);
}

async function fits(page: Page, region: Locator, modal = false) {
  await expect(region).toBeVisible();
  // A visible main region can still contain a loading skeleton after navigation.
  await expect(region.locator('.ui-field').first()).toBeVisible();
  const width = page.viewportSize()!.width;
  const bounds = (await region.boundingBox())!;
  expect(bounds.x).toBeGreaterThanOrEqual(-1);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(width + 1);
  if (modal) {
    expect(bounds.width).toBeLessThanOrEqual(Math.min(960,width-24));
    expect(bounds.width).toBeGreaterThanOrEqual(Math.min(960,width-48)*.85);
    expect(bounds.height).toBeLessThanOrEqual(page.viewportSize()!.height);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  const overflow = await region.evaluate(element => Array.from(element.querySelectorAll<HTMLElement>(
    '.modal-body, .form-grid, .form-two-col, .check-grid, .ui-field, .review-details, label'))
    .filter(item => item.getClientRects().length && !(item instanceof HTMLInputElement || item instanceof HTMLTextAreaElement))
    .filter(item => item.scrollWidth > item.clientWidth + 1)
    .map(item => `${item.tagName}.${item.className}`));
  expect(overflow).toEqual([]);
  const controls = await region.locator('.ui-field').evaluateAll(elements => elements.map(element => {
    const rect = element.getBoundingClientRect();
    const parent = element.parentElement!.getBoundingClientRect();
    return { height: rect.height, textarea: element.tagName === 'TEXTAREA',
      inside: rect.left >= parent.left - 1 && rect.right <= parent.right + 1 };
  }));
  expect(controls.length).toBeGreaterThan(0);
  for (const control of controls) {
    expect(control.inside).toBe(true);
    expect(control.height).toBeGreaterThanOrEqual(control.textarea ? 128 : 44);
  }
}

for (const width of [320, 375, 768, 1024, 1440]) {
  test(`exam settings and grading forms fit ${width}px`, async ({ page }, testInfo) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width, height: 900 });
    await managementSession(page, 'teacher');
    await page.route('**/api/v1/exams/exam-web-001', route => respond(route, { id: 'exam-web-001', title: 'Đề thi kiểm tra layout', status: 'draft', start_time: '2026-12-25T01:00:00Z', end_time: '2026-12-25T03:00:00Z', duration_minutes: 60, require_camera: true, classes: [], questions: [] }));
    await page.route('**/api/v1/attempts/attempt-003/result',route=>respond(route,{
      id:'attempt-003',exam_id:'exam-web-002',exam_title:'Đề tự luận',status:'submitted',attempt_number:1,student,
      started_at:'2026-10-10T01:00:00Z',submitted_at:'2026-10-10T02:00:00Z',score:null,max_score:3,
      questions:[{question_id:'essay',answer_id:'essay-answer',type:'essay',content:longText,student_answer:longText,correct_answer:longText,points:3,points_awarded:null,is_correct:null,options_json:null,explanation:null}],
    }));
    await page.goto('/dashboard/exams/exam-web-001');
    await page.getByRole('combobox', { name: 'Ngân hàng câu hỏi', exact: true }).selectOption('bank-1');
    await page.getByRole('button', { name: 'Chọn nhanh / Ngẫu nhiên', exact: true }).click();
    await fits(page, page.locator('.random-question-picker'));
    await fits(page, page.getByRole('region', { name: '3. Giao cho lớp & cấu hình thi', exact: true }));
    await page.goto('/dashboard/exams/exam-web-002/grade/attempt-003');
    await fits(page, page.getByRole('main'));
    await page.screenshot({ path: testInfo.outputPath(`grading-${width}.png`), fullPage: true });
  });

  test(`teacher exam, question and live-class forms fit ${width}px`, async ({ page }, testInfo) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width, height: 900 });
    await managementSession(page, 'teacher');
    await page.goto('/dashboard/exams');
    await page.getByRole('button', { name: '+ Tạo đề thi', exact: true }).click();
    let dialog = page.getByRole('dialog');
    await dialog.getByLabel('Bắt đầu', { exact: true }).fill('2026-12-25T08:30');
    await dialog.getByLabel('Kết thúc', { exact: true }).fill('2026-12-25T10:30');
    await dialog.getByRole('combobox', { name: 'Ngân hàng câu hỏi', exact: true }).selectOption('bank-1');
    await expect(dialog.getByText('X'.repeat(120), { exact: false })).toBeVisible();
    await fits(page, dialog, true);
    const dates = await dialog.locator('input[type="datetime-local"]').evaluateAll(elements => elements.map(element => {
      const rect = element.getBoundingClientRect(); return { x: rect.x, y: rect.y, width: rect.width };
    }));
    expect(dates[0].width).toBeGreaterThanOrEqual(Math.min(250,width-100));
    if (width >= 1024) expect(dates[0].y).toBeCloseTo(dates[1].y, 0);
    else expect(dates[1].y).toBeGreaterThan(dates[0].y);
    await dialog.getByRole('button', { name: 'Xuất bản', exact: true }).scrollIntoViewIfNeeded();
    await expect(dialog.getByRole('button', { name: 'Xuất bản', exact: true })).toBeInViewport();
    await page.screenshot({ path: testInfo.outputPath(`exam-${width}.png`) });
    await page.keyboard.press('Escape');

    await page.goto('/dashboard/question-banks/bank-1');
    await page.getByRole('button', { name: '+ Thêm câu hỏi', exact: true }).click();
    dialog = page.getByRole('dialog');
    await dialog.getByLabel('Nội dung câu hỏi', { exact: true }).fill(longText);
    await dialog.getByPlaceholder('Phương án 1').fill(longText);
    await fits(page, dialog, true);
    await dialog.getByRole('combobox', { name: 'Loại câu', exact: true }).selectOption('essay');
    await fits(page, dialog, true);
    await page.screenshot({ path: testInfo.outputPath(`question-${width}.png`) });
    await page.keyboard.press('Escape');

    await page.goto('/dashboard/live-classes');
    await page.getByRole('button', { name: '+ Tạo buổi học', exact: true }).click();
    await fits(page, page.getByRole('dialog'), true);
  });

  test(`admin user, profile-review and class forms fit ${width}px`, async ({ page }, testInfo) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width, height: 900 });
    await managementSession(page, 'admin');
    await page.goto('/dashboard/users');
    await page.getByRole('button', { name: '+ Thêm người dùng', exact: true }).click();
    let dialog = page.getByRole('dialog');
    await dialog.getByLabel('Email', { exact: true }).fill(longEmail);
    await fits(page, dialog, true);
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Xem hồ sơ', exact: true }).click();
    dialog = page.getByRole('dialog');
    await fits(page, dialog, true);
    await expect(dialog.getByText(longEmail, { exact: true })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath(`review-${width}.png`) });
    await dialog.getByRole('button', { name: 'Chỉnh sửa hồ sơ', exact: true }).click();
    await expect(dialog).toHaveAccessibleName('Chỉnh sửa tài khoản');
    await fits(page, dialog, true);
    await page.keyboard.press('Escape');

    for (const path of ['/admin/classes/new', '/admin/classes/class-1']) {
      const loaded = page.waitForResponse(response => {
        const url = new URL(response.url());
        return url.pathname.endsWith('/users') && url.searchParams.get('role') === 'teacher' && response.request().method() === 'GET';
      });
      await page.goto(path);
      await loaded;
      await expect(page.getByText('Giáo viên chủ nhiệm', { exact: false }).first()).toBeVisible();
      await fits(page, page.locator('.form-panel'));
    }
    await page.getByRole('button', { name: `Sinh viên (${classItem.students_count})`, exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Thêm sinh viên', exact: true })).toBeVisible();
    await fits(page, page.getByRole('main'));
  });
}

for (const width of [320, 375, 768, 1024, 1440]) {
  test(`student phone and card preview keep long fields inside ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 960 });
    const session = await uiSession(page);
    Object.assign(session.user, { email: longEmail, phone: null, identity_profile_status: 'VERIFIED', student_code: '001IT123' });
    const pixel = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=', 'base64');
    await page.route('**/api/v1/identity/student-card/**', route => {
      const path = new URL(route.request().url()).pathname;
      if (route.request().method() === 'OPTIONS') return respond(route, {});
      if (path.includes('/previews/')) return route.fulfill({ contentType: 'image/png', body: pixel,
        headers: { 'access-control-allow-origin': route.request().headers().origin ?? 'http://localhost:3000', 'access-control-allow-credentials': 'true' } });
      if (path.endsWith('/preview')) return respond(route, {
        preview_id: '22222222-2222-4222-8222-222222222222', expires_at: new Date(Date.now() + 600_000).toISOString(),
        card_preview_url: '/api/v1/identity/student-card/previews/22222222-2222-4222-8222-222222222222/card', face_preview_url: '/api/v1/identity/student-card/previews/22222222-2222-4222-8222-222222222222/face',
        extracted: { full_name: longText, ocr_display_name: longText, student_code: '001IT123', major: longText, class_name: 'X'.repeat(100) },
        comparison: { name_match: false, student_code_match: true }, can_confirm: false, blocking_errors: ['NAME_MISMATCH'], warnings: [],
      });
      return respond(route, { identity_profile_status: 'VERIFIED', student_card_status: 'NOT_SUBMITTED', has_reference: false });
    });
    await page.goto('/student/profile');
    await page.getByRole('button', { name: 'Thêm số điện thoại', exact: true }).click();
    await fits(page, page.getByRole('main'));
    await page.getByLabel('Ảnh thẻ sinh viên', { exact: true }).setInputFiles({ name: 'card.png', mimeType: 'image/png', buffer: pixel });
    const card = page.getByRole('region', { name: 'Xác minh danh tính', exact: true });
    await expect(card.getByRole('img', { name: 'Khuôn mặt được phát hiện' })).toBeVisible();
    await expect(card.getByRole('button', { name: 'Xác nhận thẻ sinh viên', exact: true })).toBeDisabled();
    expect(await card.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    await page.screenshot({ path: testInfo.outputPath(`profile-card-${width}.png`), fullPage: true });
  });
}
