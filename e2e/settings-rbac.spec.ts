import { expect, test } from '@playwright/test';
import { login, uid, VIEWER } from './fixtures';

test('create a project and a budget policy for it', async ({ page }) => {
  const name = `E2E project ${uid()}`;
  await page.goto('/settings/projects');
  await page.getByTestId('project-name').fill(name);
  await page.getByRole('button', { name: 'Create project' }).click();
  await expect(page.getByRole('main').getByText(name, { exact: true })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Main navigation' }).getByText(name)).toBeVisible();

  await page.getByRole('tab', { name: 'Budgets' }).click();
  await page.getByRole('combobox', { name: /^Scope/ }).click();
  await page.getByRole('option', { name: 'Project' }).click();
  await page.getByRole('combobox', { name: 'Project', exact: true }).click();
  await page.getByRole('option', { name }).click();
  await page.getByLabel('Hard limit (USD, est.)').fill('25');
  await page.getByRole('button', { name: 'Save policy' }).click();
  const row = page.getByTestId('budgets-table').getByRole('row', { name: new RegExp(name) });
  await expect(row).toBeVisible();
  await row.getByRole('button', { name: 'Delete budget policy' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Delete' }).click();
  await expect(row).toHaveCount(0);
});

test.describe('viewer role', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('sees data but no create or decide actions', async ({ page }) => {
    await login(page, VIEWER);
    await expect(page.getByTestId('dashboard-metrics')).toBeVisible();
    await expect(page.getByTestId('new-agent-button')).toHaveCount(0);
    await page.goto('/tasks');
    await expect(page.getByTestId('tasks-table')).toBeVisible();
    await expect(page.getByTestId('new-task-button')).toHaveCount(0);
    await page.goto('/knowledge');
    await expect(page.getByTestId('knowledge-add')).toHaveCount(0);
    await page.goto('/workflows');
    await expect(page.getByTestId('new-workflow')).toHaveCount(0);
  });
});
