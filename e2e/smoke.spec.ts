import { test, expect, devices } from '@playwright/test';

const BASE = process.env.E2E_BASE_URL || 'https://emergency.brigadaonse.org';

test.describe('Public shell', () => {
  test('login page loads and has no horizontal overflow at iPhone 14', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${BASE}/login`);
    await expect(page.getByRole('heading', { name: /sign in|login|brigada/i }).first()).toBeVisible({ timeout: 20000 });
    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    const clientWidth = await page.evaluate(() => document.documentElement.clientWidth);
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 2);
  });

  test('health endpoint reports checks', async ({ request }) => {
    const res = await request.get(`${BASE}/api/health`);
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.checks?.api).toBeTruthy();
    expect(body.checks?.database).toBeTruthy();
  });
});

test.describe('Role route protection', () => {
  test('admin route redirects unauthenticated users', async ({ page }) => {
    await page.goto(`${BASE}/admin/dispatch`);
    await expect(page).toHaveURL(/login/i, { timeout: 20000 });
  });

  test('citizen route redirects unauthenticated users', async ({ page }) => {
    await page.goto(`${BASE}/citizen`);
    await expect(page).toHaveURL(/login/i, { timeout: 20000 });
  });
});

for (const size of [
  { w: 320, h: 568 },
  { w: 390, h: 844 },
  { w: 768, h: 1024 },
  { w: 1366, h: 768 },
]) {
  test(`login responsive ${size.w}x${size.h}`, async ({ page }) => {
    await page.setViewportSize({ width: size.w, height: size.h });
    await page.goto(`${BASE}/login`);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(2);
  });
}

test.use({ ...devices['iPhone 14'] });
test('iPhone 14 login viewport', async ({ page }) => {
  await page.goto(`${BASE}/login`);
  await expect(page.locator('body')).toBeVisible();
});
