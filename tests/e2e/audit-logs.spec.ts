import { test, expect, type Page } from '@playwright/test';
import { uiSession } from './ui-fixtures';
import { type AuditRow, formatAuditDetails, formatAuditAction, formatAuditTarget, formatRawAuditMetadata } from '../../lib/audit-log-formatters';

test.use({ trace: 'off' });
const targetId = '9857643f-acbe-47d3-b39a-5ce521548fc3';
const base: AuditRow = {
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', action: 'PROFILE_UPDATED', entity_type: 'user', entity_id: targetId,
  created_at: '2026-10-16T05:51:45Z', user: { id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', full_name: 'System Admin', email: 'admin@example.test', role: 'admin' },
  target: { name: 'Trương Quang Đạt', role: 'student', student_code: '102230057' }, metadata: { fields: ['phone'] },
};
const rows: AuditRow[] = [base,
  { ...base, id: 'multiple', action: 'user_updated', metadata: { fields: ['student_code', 'full_name', 'phone', 'role'], identity_profile_version: 2 } },
  { ...base, id: 'card', action: 'CARD_NOTIFICATION_SENT', entity_type: 'student_card', metadata: { reason: null, actor_name: 'Historical Admin', actor_role: 'admin', student_id: targetId, reference_id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', notification_id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', unknown: { nested: ['retain this'] } } },
  { ...base, id: 'settings', action: 'SYSTEM_SETTINGS_UPDATED', entity_type: 'system_settings', entity_id: null, target: null, metadata: { changes: { exam_require_camera: { old: false, new: true }, support_text: { old: 'Nội dung cũ', new: 'Nội dung mới' } } } },
  { ...base, id: 'unknown', action: 'unexpected_future_action', target: null, metadata: { unknown: { nested: ['do not render'] }, reason: { invalid: true } } },
];
async function setup(page: Page) {
  await uiSession(page, 'admin');
  await page.context().addCookies([{ name: 'auth_token', value: `fixture.${Buffer.from(JSON.stringify({ role: 'admin' })).toString('base64url')}.signature`, url: process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000' }]);
  const queries: URLSearchParams[] = [];
  await page.route('**/api/v1/audit-logs?**', async route => {
    const headers = { 'access-control-allow-origin': route.request().headers().origin ?? 'http://localhost:3000', 'access-control-allow-credentials': 'true', 'access-control-allow-headers': 'authorization,content-type' };
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
    const query = new URL(route.request().url()).searchParams; queries.push(query);
    const filtered = rows.filter(row => !query.get('action') || row.action === query.get('action'));
    await route.fulfill({ headers, json: { data: filtered, meta: { total: filtered.length, page: 1, limit: 20 } } });
  });
  return queries;
}

test('malformed and unknown metadata stays out of human summaries and is preserved for audit', () => {
  for (const metadata of [null, [], ['phone'], '{malformed', '{"fields":["phone"]}', { fields: [null, {}, ['phone']], reason: {}, unknown: { nested: true } }]) {
    const row = { ...base, metadata };
    expect(formatAuditDetails(row).summary).not.toMatch(/\[object Object\]|malformed|nested|\{/);
    expect(formatRawAuditMetadata(metadata)).toBe(JSON.stringify(metadata, null, 2));
  }
  expect(formatAuditAction('constructor')).toBe('Hoạt động khác');
  expect(formatAuditDetails({ ...base, action: 'CARD_VERIFIED', metadata: { notification_id: targetId, reason: null } }).facts).toEqual([]);
  expect(formatAuditTarget({ ...base, target: null }).name).not.toContain('đã xóa');
  expect(formatAuditTarget({ ...base, target: null }).name).not.toContain(targetId);
});

test('Vietnamese table, full details, raw disclosure, copy, keyboard and original action filter', async ({ page, context }) => {
  test.setTimeout(90_000);
  const queries = await setup(page);
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto('/admin/action-logs');
  const table = page.getByRole('region', { name: 'Nhật ký hệ thống', exact: true }).getByRole('table');
  await expect(table).toBeVisible({ timeout: 45_000 });
  await expect(table).toContainText('Cập nhật: Số điện thoại');
  await expect(table).toContainText('MSSV: 102230057');
  await expect(table).not.toContainText(targetId);
  await expect(table).not.toContainText('PROFILE_UPDATED');
  await expect(table).not.toContainText('actor_name');
  await expect(table).not.toContainText('[object Object]');
  await page.screenshot({ path: 'artifacts/audit-logs-light.png', fullPage: true });
  const multiple = table.getByRole('row').filter({ hasText: 'Cập nhật người dùng' });
  await multiple.getByRole('button', { name: /Xem chi tiết/ }).click();
  const dialog = page.getByRole('dialog', { name: 'Chi tiết nhật ký' });
  await expect(dialog).toContainText('Phiên bản hồ sơ xác minh');
  await expect(dialog.getByRole('list')).toContainText('Số điện thoại');
  await expect(dialog.getByRole('list')).toContainText('Vai trò');
  await expect(dialog.locator('details')).not.toHaveAttribute('open', '');
  await page.screenshot({ path: 'artifacts/audit-logs-human-details.png' });
  expect((await dialog.boundingBox())!.width).toBeGreaterThanOrEqual(600);
  expect((await dialog.boundingBox())!.width).toBeLessThanOrEqual(720);
  await page.keyboard.press('Escape');
  await expect(multiple.getByRole('button')).toBeFocused();
  await table.getByRole('row').filter({ hasText: 'Gửi thông báo về thẻ sinh viên' }).getByRole('button').click();
  await expect(dialog).not.toContainText('Lý do: null');
  await expect(dialog.getByText('Lý do', { exact: true })).toHaveCount(0);
  await expect(dialog.getByText('Đã gửi thông báo', { exact: true })).toBeVisible();
  await expect(dialog.locator('pre')).not.toBeVisible();
  await dialog.getByText('Thông tin kỹ thuật', { exact: true }).click();
  await expect(dialog.locator('pre')).toContainText('retain this');
  await dialog.getByRole('button', { name: 'Sao chép reference_id', exact: true }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee');
  await dialog.getByRole('button', { name: 'Sao chép JSON', exact: true }).click();
  expect(JSON.parse(await page.evaluate(() => navigator.clipboard.readText()))).toEqual(rows[2].metadata);
  await page.screenshot({ path: 'artifacts/audit-logs-detail-light.png', fullPage: true });
  await page.keyboard.press('Escape');
  await table.getByRole('row').filter({ hasText: 'Cập nhật cài đặt hệ thống' }).getByRole('button').click();
  await expect(dialog.getByRole('region', { name: 'Giá trị trước và sau' })).toContainText('Nội dung cũ');
  await expect(dialog.getByRole('region', { name: 'Giá trị trước và sau' })).toContainText('Nội dung mới');
  await page.keyboard.press('Escape');
  await page.getByRole('combobox', { name: 'Hành động', exact: true }).selectOption('CARD_NOTIFICATION_SENT');
  await expect(table.getByRole('row')).toHaveCount(2);
  expect(queries.at(-1)!.get('action')).toBe('CARD_NOTIFICATION_SENT');
  await page.reload();
  await expect(page.getByRole('combobox', { name: 'Hành động', exact: true })).toHaveValue('CARD_NOTIFICATION_SENT');
});

test('shared dashboard route and dark mobile technical details fit the viewport', async ({ page }) => {
  test.setTimeout(90_000);
  await setup(page);
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/dashboard/action-logs');
  await page.getByRole('table').getByRole('row').filter({ hasText: 'Gửi thông báo về thẻ sinh viên' }).getByRole('button').click();
  const dialog = page.getByRole('dialog');
  await dialog.getByText('Thông tin kỹ thuật', { exact: true }).click();
  const technical = dialog.locator('pre');
  await expect(technical).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await technical.scrollIntoViewIfNeeded();
  expect(await dialog.evaluate(node => node.scrollWidth <= node.clientWidth + 1)).toBe(true);
  expect(await technical.evaluate(node => node.scrollWidth <= node.clientWidth + 1)).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.screenshot({ path: 'artifacts/audit-logs-detail-dark-mobile.png' });
});
