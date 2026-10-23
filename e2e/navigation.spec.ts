import { expect, test } from '@playwright/test';

const PAGES: Array<{ path: string; heading: RegExp }> = [
  { path: '/', heading: /AI Team Overview/ },
  { path: '/team', heading: /AI Team Members/ },
  { path: '/tasks', heading: /^Tasks$/ },
  { path: '/workflows', heading: /Agent Workflows/ },
  { path: '/tools', heading: /Tool Registry/ },
  { path: '/knowledge', heading: /Knowledge Base/ },
  { path: '/files', heading: /^Files$/ },
  { path: '/approvals', heading: /Approval Center/ },
  { path: '/activity', heading: /Activity History/ },
  { path: '/analytics', heading: /Usage & Cost Analytics/ },
  { path: '/integrations', heading: /Integrations/ },
  { path: '/settings/profile', heading: /Settings/ },
  { path: '/settings/members', heading: /Settings/ },
  { path: '/settings/budgets', heading: /Settings/ },
  { path: '/settings/system', heading: /Settings/ },
];

test.describe('every page renders without errors', () => {
  for (const p of PAGES) {
    test(p.path, async ({ page }) => {
      const errors: string[] = [];
      page.on('pageerror', (err) => errors.push(err.message));
      page.on('console', (msg) => {
        if (msg.type() === 'error' && !/favicon|ResizeObserver|Failed to load resource/.test(msg.text())) errors.push(msg.text());
      });
      await page.goto(p.path);
      await expect(page.getByRole('heading', { level: 1, name: p.heading })).toBeVisible();
      await expect(page.locator('[aria-busy="true"]')).toHaveCount(0, { timeout: 20_000 });
      await expect(page.getByRole('alert').filter({ hasText: 'Something went wrong' })).toHaveCount(0);
      expect(errors, errors.join('\n')).toEqual([]);
    });
  }
});

test('sidebar navigation and global search work', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name: 'Knowledge Base' }).click();
  await expect(page).toHaveURL(/\/knowledge$/);
  await page.keyboard.press('Control+k');
  const search = page.getByRole('textbox', { name: 'Global search' });
  await search.fill('Alex');
  await page.getByRole('button', { name: /Alex/ }).first().click();
  await expect(page).toHaveURL(/\/team\/.+/);
});

test('theme toggle switches to dark mode', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('theme-toggle').click();
  await page.getByTestId('theme-dark').click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.getByTestId('theme-toggle').click();
  await page.getByTestId('theme-system').click();
});
