import { expect, test } from '@playwright/test';
import { uid } from './fixtures';

test('create an agent with the wizard, then pause and resume it', async ({ page }) => {
  const name = `E2E Agent ${uid()}`;
  await page.goto('/team');
  await page.getByTestId('new-agent-button').click();
  const wizard = page.getByTestId('agent-wizard');
  await wizard.getByTestId('wizard-name').fill(name);
  for (let i = 0; i < 5; i++) await wizard.getByTestId('wizard-next').click();
  await wizard.getByTestId('wizard-save').click();
  await expect(page).toHaveURL(/\/team\/.+/);
  await expect(page.getByRole('heading', { level: 1 })).toContainText(name);

  await page.getByRole('button', { name: 'Pause' }).click();
  await expect(page.getByRole('button', { name: 'Resume' })).toBeVisible();
  await page.getByRole('button', { name: 'Resume' }).click();
  await expect(page.getByRole('button', { name: 'Pause' })).toBeVisible();

  for (const tab of ['Tasks', 'Activity', 'Versions', 'Knowledge', 'Overview']) await page.getByRole('tab', { name: tab }).click();
  await page.getByRole('button', { name: 'Archive' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Archive' }).click();
  await expect(page.getByRole('button', { name: 'Delete' })).toBeVisible();
  await page.getByRole('button', { name: 'Delete' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Delete' }).click();
  await expect(page).toHaveURL(/\/team$/);
});

test('assign a task, watch it complete, and preview its report', async ({ page }) => {
  const title = `E2E report ${uid()}`;
  await page.goto('/tasks');
  await page.getByTestId('new-task-button').click();
  await page.getByTestId('task-title').fill(title);
  await page.getByTestId('task-description').fill('Compare two storage vendors in a short table.');
  await page.getByTestId('task-submit').click();

  const drawer = page.getByTestId('task-drawer');
  await expect(drawer.getByRole('heading', { name: title })).toBeVisible();
  await expect(drawer.getByText('Completed', { exact: true }).first()).toBeVisible({ timeout: 60_000 });
  await expect(drawer.getByTestId('execution-timeline')).toBeVisible();
  await drawer.getByRole('tab', { name: 'Result' }).click();
  await drawer.getByRole('tab', { name: /Artifacts/ }).click();
  await drawer.getByRole('button', { name: 'Preview' }).first().click();
  await expect(page.getByTestId('artifact-preview')).toBeVisible();
  await page.getByTestId('artifact-preview').getByRole('button', { name: 'Close' }).click();
  await drawer.getByRole('button', { name: 'Close task' }).click();

  await page.getByRole('textbox', { name: 'Search tasks' }).fill(title);
  await expect(page.getByTestId('tasks-table').getByText(title)).toBeVisible();
});
