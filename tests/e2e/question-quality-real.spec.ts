import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import type { DocumentSession } from '../../lib/question-documents';

test.skip(process.env.AI_QUESTION_QUALITY_REAL_E2E !== '1', 'Opt-in normal owner authentication and real generated drafts; never imports.');
test('real quality preview preserves human control and official questions', async ({ browser, request }) => {
  test.setTimeout(120_000);
  const fixture = JSON.parse(fs.readFileSync('backend/private/ai-question-quality-ui.json', 'utf8'));
  const headers = { Authorization: `Bearer ${fixture.token}` };
  const bankUrl = `http://localhost:8000/api/v1/question-banks/${fixture.bank_id}`;
  const readBank = async () => { const response = await request.get(bankUrl, { headers }); expect(response.status()).toBe(200); return (await response.json()).data; };
  const before = await readBank();
  const response = await request.get(`${bankUrl}/documents/${fixture.document_id}`, { headers });
  expect(response.status()).toBe(200);
  const doc: DocumentSession = (await response.json()).data;
  expect(doc.questions.length).toBeGreaterThan(0);
  expect(doc.questions.every(question => question.quality_check)).toBe(true);
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: 'vi-VN' });
  await context.addInitScript(({ user, token }) => {
    sessionStorage.setItem('ai-proctoring-current-user', JSON.stringify(user));
    sessionStorage.setItem('ai-proctoring-access-token', token);
  }, { user: fixture.user, token: fixture.token });
  try {
    const page = await context.newPage();
    const mutations: string[] = [];
    page.on('request', req => { if (req.method() === 'POST' && req.url().includes(`/documents/${doc.id}/`)) mutations.push(new URL(req.url()).pathname); });
    await page.goto(`/dashboard/question-banks/${fixture.bank_id}/documents?document=${doc.id}`);
    const cards = page.locator('.document-draft-card');
    await expect(cards).toHaveCount(doc.questions.length);
    for (let index = 0; index < doc.questions.length; index++) {
      const question = doc.questions[index];
      await expect(cards.nth(index)).toContainText(question.content);
      await expect(cards.nth(index).getByRole('note', { name: 'Kiểm tra tự động' })).toContainText(question.quality_check?.status === 'pass' ? 'Đạt' : 'Cần xem lại');
      if (question.quality_check?.status === 'review') await expect(cards.nth(index).getByRole('checkbox')).not.toBeChecked();
      for (const answer of question.answers) await expect(cards.nth(index)).toContainText(answer);
      await expect(cards.nth(index).getByRole('button', { name: 'Sửa', exact: true })).toBeEnabled();
      await expect(cards.nth(index).getByRole('button', { name: 'Bỏ', exact: true })).toBeEnabled();
    }
    await page.getByRole('button', { name: 'Bỏ chọn tất cả', exact: true }).click();
    await expect(page.locator('.document-review-actions')).toContainText('Đã chọn: 0');
    await cards.first().getByRole('checkbox').check();
    await cards.first().getByRole('checkbox').uncheck();
    await cards.first().getByRole('button', { name: 'Sửa', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'Sửa câu hỏi đề xuất', exact: true })).toBeVisible();
    await page.getByRole('dialog').getByRole('button', { name: 'Hủy', exact: true }).click();
    for (const width of [1440, 390, 320]) {
      await page.setViewportSize({ width, height: 1000 });
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
      await page.screenshot({ path: `artifacts/ai-question-quality/real-preview-${width}.png`, fullPage: true });
    }
    await cards.last().getByRole('button', { name: 'Bỏ', exact: true }).click();
    await expect(cards).toHaveCount(doc.questions.length - 1);
    expect(mutations).toEqual([]);
    const after = await readBank();
    expect(after.questions).toEqual(before.questions);
    expect(doc.imported_count).toBeNull();
    fs.writeFileSync('artifacts/ai-question-quality/real-ui-result.json', JSON.stringify({ document_id: doc.id, drafts: doc.questions.length,
      quality_flags_visible: true, flagged_drafts_not_selected: true, answers_visible: true, editing_available: true,
      select_deselect_delete: true, widths_without_overflow: [1440, 390, 320], auto_import: false, official_questions_unchanged: true }, null, 2));
  } finally { await context.close(); }
});
