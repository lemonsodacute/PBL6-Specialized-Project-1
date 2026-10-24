import { expect, test, type Page } from '@playwright/test';
import { uiSession } from './ui-fixtures';

// Assert the user-facing contract independently of the implementation's nav array.
const menu = [
  { label: 'Tổng quan hệ thống', href: '/dashboard' },
  { label: 'Quản lý lớp học', href: '/admin/classes' },
  { label: 'Danh sách người dùng', href: '/dashboard/users' },
  { label: 'Xác thực thẻ sinh viên', href: '/admin/student-cards' },
  { label: 'Quản lý đề thi', href: '/dashboard/exams' },
  { label: 'Tin nhắn', href: '/admin/messages' },
  { label: 'Báo cáo & thống kê', href: '/dashboard/reports' },
  { label: 'Nhật ký hệ thống', href: '/dashboard/action-logs' },
];

async function setup(page: Page, role = 'admin') {
  const state = await uiSession(page, role); state.classes = [];
  await page.context().addCookies([{ name: 'auth_token', value: `fixture.${Buffer.from(JSON.stringify({ role })).toString('base64url')}.signature`, url: test.info().project.use.baseURL ?? 'http://localhost:3000' }]);
  return state;
}

async function checkMenu(page: Page, activeLabel: string) {
  const sidebar = page.locator('#workspace-sidebar');
  const nav = sidebar.getByRole('navigation', { name: 'Điều hướng hệ thống' });
  await expect(page.locator('#workspace-sidebar')).toHaveCount(1);
  await expect(page.locator('.topbar')).toHaveCount(1);
  await expect(sidebar.getByRole('link', { name: 'ProctoOwl — Trang chủ', exact: true })).toHaveCount(1);
  const parent = nav.getByRole('button', { name: 'Quản lý người dùng', exact: true });
  const childActive = ['Danh sách người dùng', 'Xác thực thẻ sinh viên'].includes(activeLabel);
  if (childActive) {
    await expect(parent).toHaveAttribute('aria-expanded', 'true');
    await expect(parent).toHaveClass(/is-active/);
  } else await expect(parent).not.toHaveClass(/is-active/);
  if (await parent.getAttribute('aria-expanded') !== 'true') await parent.click();
  await expect(nav.getByRole('link')).toHaveText(menu.map(item => item.label));
  for (const item of menu) await expect(nav.getByRole('link', { name: item.label, exact: true })).toHaveAttribute('href', item.href);
  await expect(nav.locator('[aria-current=page]')).toHaveCount(1);
  await expect(nav.locator('[aria-current=page]')).toHaveText(activeLabel);
  await expect(sidebar.getByText('Cài đặt', { exact: true })).toHaveCount(1);
  await expect(sidebar.getByRole('link', { name: 'Cài đặt', exact: true })).toHaveCount(1);
  await expect(sidebar.getByRole('link', { name: 'Trợ giúp', exact: true })).toHaveAttribute('href', '/admin/help');
  await expect(nav.locator(':scope > a, :scope > .sidebar-nav-section > button')).toHaveText([
    'Tổng quan hệ thống', 'Quản lý lớp học', 'Quản lý người dùng', 'Quản lý đề thi', 'Tin nhắn', 'AI Support', 'Báo cáo & thống kê', 'Nhật ký hệ thống',
  ]);
  await expect(nav.locator('a[href="/admin/student-cards"]')).toHaveCount(1);
  await expect(nav.locator(':scope > a[href="/admin/student-cards"]')).toHaveCount(0);
}

test('admin sidebar stays complete across client navigation, history and hard reload', async ({ page }) => {
  test.setTimeout(120_000);
  await setup(page);
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('/dashboard'); await checkMenu(page, 'Tổng quan hệ thống');
  // Cross both layout boundaries repeatedly, including the original failing route.
  for (const index of [3, 4, 5, 1, 2, 6, 0, 3]) {
    const item = menu[index];
    await page.locator('#workspace-sidebar').getByRole('link', { name: item.label, exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`${item.href}$`));
    await checkMenu(page, item.label);
  }
  await page.goBack(); await checkMenu(page, 'Tổng quan hệ thống');
  await page.goForward(); await checkMenu(page, 'Xác thực thẻ sinh viên');
  await page.reload(); await checkMenu(page, 'Xác thực thẻ sinh viên');
  expect(errors).toEqual([]);
});

test('legacy admin URLs keep the same menu and highlight their canonical item', async ({ page }) => {
  await setup(page);
  await page.goto('/admin'); await checkMenu(page, 'Tổng quan hệ thống');
  await page.goto('/admin/action-logs'); await checkMenu(page, 'Nhật ký hệ thống');
});

test('nested class route highlights only class management', async ({ page }) => {
  await setup(page);
  await page.goto('/admin/classes/new');
  await checkMenu(page, 'Quản lý lớp học');
});

test('mobile admin menu stays complete and closes after route selection', async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 375, height: 812 });
  await setup(page); await page.goto('/dashboard');
  for (const index of [3, 4, 5, 1, 2, 6, 0]) {
    await page.getByRole('button', { name: 'Mở menu', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'Menu điều hướng', exact: true })).toBeVisible();
    const active = menu.find(item => item.href === new URL(page.url()).pathname)!;
    await checkMenu(page, active.label);
    await page.locator('#workspace-sidebar').getByRole('link', { name: menu[index].label, exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`${menu[index].href}$`));
    await expect(page.getByRole('dialog', { name: 'Menu điều hướng', exact: true })).toHaveCount(0);
  }
});

for (const width of [375, 1440]) test(`admin user group toggles without navigation and reopens after reload at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 900 });
  await setup(page);
  for (const route of ['/dashboard/users', '/admin/student-cards']) {
    await page.goto(route);
    if (width < 1024) await page.getByRole('button', { name: 'Mở menu', exact: true }).click();
    const sidebar = page.locator('#workspace-sidebar');
    const parent = sidebar.getByRole('button', { name: 'Quản lý người dùng', exact: true });
    await expect(parent).toHaveAttribute('aria-expanded', 'true');
    const url = page.url();
    await parent.click();
    await expect(parent).toHaveAttribute('aria-expanded', 'false');
    await expect(parent).toHaveClass(/is-active/);
    await expect(sidebar.getByRole('link', { name: 'Danh sách người dùng', exact: true })).toBeHidden();
    await expect(sidebar.getByRole('link', { name: 'Xác thực thẻ sinh viên', exact: true })).toBeHidden();
    await expect(page).toHaveURL(url);
    await parent.press('Enter');
    await expect(parent).toHaveAttribute('aria-expanded', 'true');
    await expect(sidebar.getByRole('link', { name: 'Xác thực thẻ sinh viên', exact: true })).toBeVisible();
    expect(await sidebar.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
    await parent.press('Space');
    await expect(parent).toHaveAttribute('aria-expanded', 'false');
    await page.reload();
    if (width < 1024) await page.getByRole('button', { name: 'Mở menu', exact: true }).click();
    await checkMenu(page, route === '/dashboard/users' ? 'Danh sách người dùng' : 'Xác thực thẻ sinh viên');
  }
});

test('teacher and student navigation retain their own labels and routes', async ({ page }) => {
  await setup(page, 'teacher'); await page.goto('/dashboard');
  const nav = page.locator('#workspace-sidebar nav');
  await expect(nav.getByRole('link', { name: 'Tổng quan', exact: true })).toHaveAttribute('href', '/dashboard');
  await expect(nav.getByRole('link', { name: 'Ngân hàng câu hỏi', exact: true })).toBeVisible();
  await expect(nav.getByRole('link', { name: 'Tổng quan hệ thống', exact: true })).toHaveCount(0);
  await expect(page.locator('#workspace-sidebar .sidebar-bottom').getByText('Cài đặt', { exact: true })).toBeVisible();
  // Use a fresh tab/session for the student account.
  const student = await page.context().newPage(); await setup(student, 'student');
  await student.goto('/student');
  const studentNav = student.getByRole('navigation', { name: 'Điều hướng sinh viên' });
  await expect(studentNav.getByRole('link', { name: 'Trang chủ', exact: true })).toHaveAttribute('href', '/student');
  await expect(studentNav.getByRole('link', { name: 'Lớp học phần', exact: true })).toBeVisible();
  await expect(studentNav.getByRole('link', { name: 'Xác thực thẻ sinh viên', exact: true })).toHaveCount(0);
  const testsGroup = studentNav.getByRole('button', { name: 'Bài kiểm tra', exact: true });
  await testsGroup.click();
  await expect(testsGroup).toHaveAttribute('aria-expanded', 'true');
  await studentNav.getByRole('link', { name: 'Lịch sử làm bài', exact: true }).click();
  await expect(student).toHaveURL(/\/student\/history$/);
  await expect(testsGroup).toHaveAttribute('aria-expanded', 'true');
  await expect(studentNav.getByRole('link', { name: 'Lịch sử làm bài', exact: true })).toHaveAttribute('aria-current', 'page');
  await testsGroup.click();
  await expect(testsGroup).toHaveAttribute('aria-expanded', 'false');
  await student.reload();
  await expect(testsGroup).toHaveAttribute('aria-expanded', 'true');
  await student.close();
});
