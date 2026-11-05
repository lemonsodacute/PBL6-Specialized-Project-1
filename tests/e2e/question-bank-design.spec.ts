import { expect, test } from '@playwright/test';
import { designBanks, questionBankDesignSession } from './question-bank-design-fixture';

test.use({ locale: 'vi-VN', timezoneId: 'Asia/Ho_Chi_Minh' });

for (const width of [320, 390, 768, 1024, 1440]) for (const theme of ['light', 'dark'] as const) {
  test(`question bank reference ${width}px ${theme}: illustrations, real counters and no overflow`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
    await questionBankDesignSession(page);
    await page.goto('/dashboard/question-banks');
    await expect(page.getByRole('heading', { level: 1, name: 'Ngân hàng câu hỏi', exact: true })).toBeVisible();
    const cards = page.locator('.question-bank-card');
    await expect(cards).toHaveCount(6);
    const stats = page.locator('dl[aria-label="Tổng quan ngân hàng"]');
    await expect(stats.locator('dd')).toHaveText(['6', '41', '26/10/2026']);
    for (const bank of designBanks) await expect(page.getByRole('link', { name: `Mở ngân hàng ${bank.name}`, exact: true })).toHaveAttribute('href', `/dashboard/question-banks/${bank.id}`);
    await expect(page.getByRole('link', { name: 'Mở ngân hàng Quản trị mạng', exact: true })).toHaveText('Thêm câu hỏi');
    for (const image of await cards.locator('img').all()) {
      await image.scrollIntoViewIfNeeded();
      await expect.poll(() => image.evaluate(image => (image as HTMLImageElement).complete && (image as HTMLImageElement).naturalWidth > 0)).toBe(true);
    }
    expect(new Set(await cards.locator('img').evaluateAll(images => images.map(image => (image as HTMLImageElement).src))).size).toBe(6);
    // The shared reduced-motion rule uses 0.01ms rather than literal zero.
    expect(await cards.first().evaluate(card => Math.max(...getComputedStyle(card).transitionDuration.split(',').map(parseFloat)))).toBeLessThanOrEqual(0.001);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    const columns = await cards.evaluateAll(nodes => new Set(nodes.map(node => Math.round(node.getBoundingClientRect().left))).size);
    expect(columns).toBe(width >= 1200 ? 3 : width > 600 ? 2 : 1);
    const create = page.getByRole('button', { name: '+ Tạo ngân hàng', exact: true });
    expect((await create.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
  });
}

test('question bank search and sort keep existing URL/API parameters and update visible totals', async ({ page }) => {
  const state = await questionBankDesignSession(page);
  await page.goto('/dashboard/question-banks');
  await expect(page.locator('.question-bank-card')).toHaveCount(6);
  await page.getByRole('searchbox', { name: 'Tìm ngân hàng câu hỏi', exact: true }).fill('HTML');
  await expect(page.locator('.question-bank-card')).toHaveCount(1);
  await expect(page.locator('dl dd')).toHaveText(['1', '10', '24/10/2026']);
  await page.getByRole('combobox', { name: 'Sắp xếp', exact: true }).selectOption('name');
  await expect.poll(() => state.requests.some(url => { const p = new URL(url).searchParams; return p.get('q') === 'HTML' && p.get('sort') === 'name'; })).toBe(true);
  await expect(page).toHaveURL(/q=HTML.*sort=name/);
  await page.getByRole('button', { name: 'Xóa bộ lọc', exact: true }).click();
  await expect(page.locator('.question-bank-card')).toHaveCount(6);
  await page.getByRole('searchbox', { name: 'Tìm ngân hàng câu hỏi', exact: true }).fill('không có ngân hàng này');
  await expect(page.getByText('Không tìm thấy kết quả phù hợp.', { exact: true })).toBeVisible();
  await expect(page.locator('dl dd')).toHaveText(['0', '0', '—']);
});
