import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import { draftProblems, normalizeDraftContent, type DocumentSession } from '../../lib/question-documents';

test.skip(process.env.AI_DOCUMENT_REAL_E2E !== '1', 'Explicit opt-in: uses the existing document and real AI quota; never imports questions.');
test('real document generation resumes only failed sections and leaves official questions untouched', async ({ browser, request }) => {
  test.setTimeout(420000);
  const fixture = JSON.parse(fs.readFileSync('backend/private/ai-document-generation-validation.json', 'utf8'));
  const headers = { Authorization: `Bearer ${fixture.token}` };
  const base = `http://localhost:8000/api/v1/question-banks/${fixture.bank_id}/documents/${fixture.document_id}`;
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: 'vi-VN', timezoneId: 'Asia/Ho_Chi_Minh' });
  await context.addInitScript(({ user, token }) => {
    sessionStorage.setItem('ai-proctoring-current-user', JSON.stringify(user));
    sessionStorage.setItem('ai-proctoring-access-token', token);
  }, { user: fixture.user, token: fixture.token });
  const page = await context.newPage();
  const calls: string[] = [];
  page.on('request', req => { if (req.method() === 'POST' && req.url().includes(`/documents/${fixture.document_id}/`)) calls.push(new URL(req.url()).pathname); });
  const url = `/dashboard/question-banks/${fixture.bank_id}/documents?document=${fixture.document_id}`;
  const read = async () => { const response = await request.get(base, { headers }); expect(response.status()).toBe(200); return (await response.json()).data as DocumentSession; };
  try {
    let current = await read();
    await page.goto(url);
    expect(current.filename).toBe('Tai_lieu_thu_nghiem_tao_cau_hoi_AI.docx');
    await expect(page.getByRole('list', { name: 'Các bước tạo câu hỏi', exact: true })).toBeVisible();
    if (current.batches.some(batch => !batch.complete)) await expect(page.getByRole('button', { name: 'Thử lại phần lỗi', exact: true })).toBeVisible();
    await page.screenshot({ path: 'artifacts/ai-document-generation-fix/before-real-retry.png', fullPage: true });
    // Process one failed section through the real API first. The UI must then
    // retry only the other failed section, preserving the successful draft IDs.
    if (!current.batches.some(batch => batch.complete)) {
      const first = current.batches.find(batch => !batch.complete)!;
      const response = await request.post(`${base}/batches/${first.index}`, { headers, data: {}, timeout: 195000 });
      expect(response.status(), 'real AI generation must succeed').toBe(200);
      current = (await response.json()).data;
    }
    const completed = current.batches.filter(batch => batch.complete).map(batch => batch.index);
    const failed = current.batches.filter(batch => !batch.complete).map(batch => batch.index);
    const successful = structuredClone(current.questions);
    expect(successful.length).toBeGreaterThan(0);
    await page.reload();
    if (failed.length) {
      const retry = page.getByRole('button', { name: 'Thử lại phần lỗi', exact: true });
      await expect(retry).toBeVisible();
      calls.length = 0;
      const responses = failed.map(index => page.waitForResponse(response =>
        response.request().method() === 'POST' && response.url().endsWith(`/documents/${fixture.document_id}/batches/${index}`), { timeout: 200000 }));
      await retry.click();
      for (const response of await Promise.all(responses)) expect(response.status(), 'real failed-section retry').toBe(200);
      await expect(retry).not.toBeVisible({ timeout: 200000 });
      expect(calls.filter(path => /\/batches\/\d+$/.test(path)).map(path => Number(path.split('/').at(-1)))).toEqual(failed);
      expect(calls.some(path => path.endsWith('/drafts'))).toBe(false);
    }
    const result = await read();
    expect(result.batches.every(batch => batch.complete)).toBe(true);
    expect(result.questions.length).toBeGreaterThan(0);
    for (const draft of successful) expect(result.questions.find(question => question.id === draft.id)).toEqual(draft);
    for (const draft of result.questions) {
      expect(draftProblems(draft), `draft ${draft.id} must have valid answers/options`).toEqual([]);
      expect(draft.type).toBe('mcq_single');
      expect(draft.answers).toHaveLength(1);
      expect(draft.options).toContain(draft.answers[0]);
    }
    expect(new Set(result.questions.map(draft => normalizeDraftContent(draft.content))).size).toBe(result.questions.length);
    await expect(page.locator('.document-draft-card')).toHaveCount(result.questions.length);
    await expect(page.getByText(result.questions[0].content, { exact: true }).first()).toBeVisible();
    await expect(page.locator('li[aria-current="step"]')).toContainText('Xem câu hỏi');
    await page.screenshot({ path: 'artifacts/ai-document-generation-fix/after-real-preview.png', fullPage: true });
    const repeated = await request.post(`${base}/batches/${completed[0]}`, { headers, data: {}, timeout: 15000 });
    expect(repeated.status()).toBe(200);
    expect((await repeated.json()).data.questions).toEqual(result.questions);
    expect(calls.some(path => path.endsWith('/import'))).toBe(false);
    expect(result.imported_count).toBeNull();
    fs.writeFileSync('artifacts/ai-document-generation-fix/real-frontend-result.json', JSON.stringify({
      document_id: fixture.document_id, generated_questions: result.questions.length, completed_sections: result.batches.length,
      previously_completed: completed, retried_sections: failed, existing_drafts_preserved: true,
      options_and_answers_valid: true, duplicate_contents: false, idempotent_completed_section: true, imported: false,
    }, null, 2));
  } finally { await context.close(); }
});
