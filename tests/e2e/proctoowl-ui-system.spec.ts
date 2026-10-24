import { expect, test, type Page } from '@playwright/test';
import { uiSession } from './ui-fixtures';

const base = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000';
const routes = {
  student: ['/student', '/student/exams', '/student/grades'],
  teacher: ['/dashboard', '/dashboard/question-banks', '/dashboard/monitor'],
  admin: ['/admin', '/dashboard/users', '/admin/student-cards'],
};
async function setup(page: Page, role: string) {
  const state = await uiSession(page, role);
  await page.context().addCookies([{ name: 'auth_token', value: `fixture.${Buffer.from(JSON.stringify({ role })).toString('base64url')}.signature`, url: base }]);
  if (role === 'admin') await page.route('**/api/v1/admin/student-cards?**', route => {
    const headers = { 'access-control-allow-origin': base, 'access-control-allow-credentials': 'true', 'access-control-allow-headers': 'authorization,content-type', 'access-control-allow-methods': 'GET,OPTIONS' };
    return route.request().method() === 'OPTIONS' ? route.fulfill({ status: 204, headers })
      : route.fulfill({ headers, json: { data: [], meta: { total: 0, page: 1, limit: 20 } } });
  });
  // Fixtures are isolated browser responses, never production content/data.
  state.exams = [{ id: 'visual-exam', title: 'Cơ sở dữ liệu — Kiểm tra giữa kỳ', status: 'published', duration_minutes: 60, start_time: '2026-10-23T08:00:00+07:00', end_time: '2026-10-25T10:00:00+07:00', classes: [{ id: 'class-1', name: 'Kiểm thử phần mềm' }], require_camera: true, require_mic: false }];
  state.attempts = [{ id: 'visual-attempt', exam_id: 'old-exam', exam_title: 'Cấu trúc dữ liệu', status: 'graded', score: 8, max_score: 10, started_at: '2026-10-20T08:00:00+07:00', submitted_at: '2026-10-20T09:00:00+07:00', classes: [{ id: 'class-1', name: 'Kiểm thử phần mềm' }] }];
  await page.clock.setFixedTime(new Date('2026-10-22T08:00:00+07:00'));
}
for (const role of ['student', 'teacher', 'admin'] as const) for (const theme of ['light', 'dark'] as const) for (const width of [1440, 1024, 768, 390]) {
  test(`${role} visual system ${width} ${theme}`, async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width, height: 1000 });
    await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
    await setup(page, role);
    for (const route of routes[role]) {
      await page.goto(route);
      await expect(page.locator('main')).toBeVisible();
      await expect(page.locator('main .loading-skeleton')).toHaveCount(0);
      await expect(page.locator('main .ui-card').first()).toBeVisible();
      await expect(page.locator('main')).not.toContainText(/Cannot read properties|undefined is not|SQL internal/i);
      await page.evaluate(() => document.fonts.ready);
      const metrics = await page.evaluate(() => {
        const root = getComputedStyle(document.documentElement);
        const content = getComputedStyle(document.querySelector('main')!);
        const owner = getComputedStyle(document.querySelector('.app-shell')!);
        // Student toolbars now use a transparent wrapper and a white search fieldset.
        // Measure a content card rather than that presentation-only wrapper.
        const student = document.querySelector('.app-shell')?.getAttribute('data-role') === 'student';
        const card = getComputedStyle(document.querySelector(student ? 'main .ui-card:not(:has([role="search"]))' : 'main .ui-card')!);
        const heading = document.querySelector('main h1, main h2, main h3');
        return {
          primary: root.getPropertyValue('--color-primary').trim(), body: content.fontFamily,
          expectedBody: owner.getPropertyValue('--font-body').trim(), expectedHeading: owner.getPropertyValue('--font-heading').trim(),
          expectedHeader: owner.getPropertyValue('--background').trim(),
          heading: heading ? getComputedStyle(heading).fontFamily : null,
          surface: card.backgroundColor, header: getComputedStyle(document.querySelector('.topbar')!).backgroundColor,
          cardPattern: card.backgroundImage, radius: parseFloat(card.borderRadius),
          sidebar: getComputedStyle(document.querySelector('.sidebar')!).backgroundColor,
          overflow: document.documentElement.scrollWidth > innerWidth,
        };
      });
      const stack = (s: string) => [...new Set(s.replaceAll('"', '').split(',').map(v => v.trim()))].join(',');
      expect(stack(metrics.body)).toBe(stack(metrics.expectedBody));
      if (metrics.heading) expect(stack(metrics.heading)).toBe(stack(metrics.expectedHeading));
      expect(metrics.primary.toLowerCase()).toBe('#006d77');
      expect(metrics.sidebar).toBe('rgb(0, 109, 119)');
      if(role==='student') {
        expect(metrics.surface).toBe(theme==='light'?'rgb(255, 255, 255)':'rgb(25, 46, 53)');
        expect(metrics.header).toBe(theme==='light'?'rgb(255, 248, 243)':'rgb(16, 30, 37)');
      } else expect(metrics.surface).toBe(metrics.header);
      expect(metrics.cardPattern).toBe('none');
      expect(metrics.radius).toBeGreaterThanOrEqual(12);
      expect(metrics.overflow, route).toBe(false);
      if (width === 1440 || (width === 390 && theme === 'light')) {
        await page.screenshot({ path: `artifacts/proctoowl-ui/${role}-${route.replaceAll('/', '_')}-${width}-${theme}.png`, fullPage: true, animations: 'disabled' });
      }
    }
  });
}
