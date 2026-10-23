import { expect, test as setup } from '@playwright/test';
import { OWNER } from './fixtures';

setup('sign in as the demo owner', async ({ page }) => {
  await page.goto('/login');
  await page.getByTestId('login-email').fill(OWNER.email);
  await page.getByTestId('login-password').fill(OWNER.password);
  await page.getByTestId('login-submit').click();
  await expect(page.getByTestId('dashboard-metrics')).toBeVisible();
  await page.context().storageState({ path: 'e2e/.auth/owner.json' });
});
