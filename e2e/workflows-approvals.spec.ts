import { expect, test, type Page } from '@playwright/test';
import { uid } from './fixtures';

async function createFromTemplate(page: Page, template: RegExp, name: string) {
  await page.goto('/workflows');
  await page.getByTestId('new-workflow').click();
  await page.getByRole('dialog').getByRole('button', { name: template }).click();
  await page.getByTestId('workflow-name').fill(name);
  await page.getByTestId('workflow-create').click();
  await expect(page).toHaveURL(/\/workflows\/(?!executions).+/);
  await expect(page.getByTestId('flow-node-START')).toBeVisible();
}

test('build, validate and dry-run a workflow', async ({ page }) => {
  await createFromTemplate(page, /Research → Review/, `E2E dry run ${uid()}`);
  await page.getByTestId('workflow-validate').click();
  await expect(page.getByText(/Workflow is valid|Valid, with warnings/)).toBeVisible();

  // Palette and inspector: add a step, then delete it so the graph stays unchanged and runnable.
  await page.getByTestId('palette-DELAY').click();
  await expect(page.getByTestId('node-inspector')).toBeVisible();
  await page.getByTestId('node-inspector').getByRole('button', { name: 'Delete step' }).click();
  await page.getByTestId('workflow-run').click();
  await page.getByTestId('run-input-topic').fill('object storage');
  await page.getByLabel(/Dry run/).check();
  await page.getByTestId('workflow-run-confirm').click();
  await expect(page).toHaveURL(/\/workflows\/executions\/.+/);
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Completed');
  await expect(page.getByTestId('execution-steps')).toContainText('Final report');
});

test('run a workflow through an approval and a human task', async ({ page }) => {
  await createFromTemplate(page, /Plan → Draft tasks/, `E2E approval ${uid()}`);
  await page.getByTestId('workflow-run').click();
  await page.getByTestId('run-input-objective').fill('Launch the partner portal');
  await page.getByTestId('workflow-run-confirm').click();
  await expect(page).toHaveURL(/\/workflows\/executions\/.+/);

  const review = page.getByRole('link', { name: 'Waiting for approval: review it' });
  await expect(review).toBeVisible({ timeout: 60_000 });
  await review.click();
  await expect(page.getByTestId('approval-detail')).toBeVisible();
  await page.getByTestId('approval-approve').click();
  await page.getByRole('dialog').getByRole('button', { name: 'Approve' }).click();
  await expect(page.getByTestId('approval-detail').getByText('Approved', { exact: true }).first()).toBeVisible();

  await page.getByTestId('approval-detail').getByRole('link', { name: 'Open execution' }).click();
  await expect(page.getByTestId('human-task-complete')).toBeVisible({ timeout: 30_000 });
  await page.getByPlaceholder('Note (optional)').fill('Owner notified by email');
  await page.getByTestId('human-task-complete').click();
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Completed', { timeout: 30_000 });
});
