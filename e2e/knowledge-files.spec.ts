import { expect, test } from '@playwright/test';
import { uid } from './fixtures';

test('add a text knowledge source and find it with test retrieval', async ({ page }) => {
  const title = `E2E note ${uid()}`;
  await page.goto('/knowledge');
  await page.getByTestId('knowledge-add').click();
  await page.getByRole('tab', { name: 'Paste text' }).click();
  await page.getByTestId('knowledge-title').fill(title);
  await page.getByTestId('knowledge-content').fill('Fabrikam invoices are archived for seven years in cold storage.');
  await page.getByTestId('knowledge-submit').click();
  const row = page.getByTestId('knowledge-table').getByRole('row', { name: new RegExp(title) });
  await expect(row).toBeVisible();
  await expect(row.getByText(/ready/i)).toBeVisible({ timeout: 30_000 });

  await page.getByRole('button', { name: 'Test retrieval' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Query').fill('Fabrikam invoices archived');
  await dialog.getByRole('button', { name: 'Search' }).click();
  await expect(dialog.getByText(title).first()).toBeVisible();
  await dialog.getByRole('button', { name: 'Close' }).click();

  await row.getByRole('button', { name: `Revoke ${title}` }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Revoke' }).click();
  await expect(row.getByText(/revoked/i)).toBeVisible();
});

test('upload a file, preview it and delete it', async ({ page }) => {
  const name = `e2e-${uid()}.csv`;
  await page.goto('/files');
  await page.getByTestId('file-upload-input').setInputFiles({ name, mimeType: 'text/csv', buffer: Buffer.from('vendor,price\nContoso,10\nFabrikam,12\n') });
  const row = page.getByTestId('files-table').getByRole('row', { name: new RegExp(name) });
  await expect(row).toBeVisible();
  await row.getByRole('button', { name: `Preview ${name}` }).click();
  await expect(page.getByTestId('artifact-preview').getByText('Fabrikam')).toBeVisible();
  await page.getByTestId('artifact-preview').getByRole('button', { name: 'Close' }).click();
  await row.getByRole('button', { name: `Delete ${name}` }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Delete' }).click();
  await expect(row).toHaveCount(0);
});
