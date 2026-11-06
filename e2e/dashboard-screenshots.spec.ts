import { test, expect } from '@playwright/test';
import path from 'path';
import fs from 'fs';

const BASE = process.env.E2E_BASE_URL || 'https://emergency.brigadaonse.org';
const EMAIL = process.env.E2E_ADMIN_EMAIL || 'admin@sunvalley.gov.ph';
const PASSWORD = process.env.E2E_ADMIN_PASSWORD || 'Password123!';
const OUT = path.join(process.cwd(), 'docs', 'screenshots');

async function login(page: import('@playwright/test').Page) {
  await page.goto(`${BASE}/login`);
  await page.locator('#email').fill(EMAIL);
  await page.locator('#password').fill(PASSWORD);
  await page.getByRole('button', { name: /^sign in$/i }).click();
  await page.waitForURL(/\/admin/, { timeout: 30000 });
}

test.describe('Dashboard screenshots (authenticated)', () => {
  test.beforeAll(() => {
    fs.mkdirSync(OUT, { recursive: true });
  });

  test('desktop dashboard', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await login(page);
    await page.goto(`${BASE}/admin/dashboard`);
    await expect(page.getByRole('heading', { name: /live dashboard/i })).toBeVisible({ timeout: 30000 });
    await page.waitForTimeout(2500);
    await page.screenshot({
      path: path.join(OUT, 'dashboard-desktop.png'),
      fullPage: true,
    });
  });

  test('mobile dashboard', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await login(page);
    await page.goto(`${BASE}/admin/dashboard`);
    await expect(page.getByRole('heading', { name: /live dashboard/i })).toBeVisible({ timeout: 30000 });
    await page.waitForTimeout(2500);
    await page.screenshot({
      path: path.join(OUT, 'dashboard-mobile.png'),
      fullPage: true,
    });
  });

  test('role-gated panels load for admin', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await login(page);
    await page.goto(`${BASE}/admin/dashboard`);
    await expect(page.getByText(/personnel management/i)).toBeVisible({ timeout: 30000 });
    await expect(page.getByText(/digital documentation/i)).toBeVisible();
    await expect(page.getByText(/attendance & shift/i)).toBeVisible();
  });
});
