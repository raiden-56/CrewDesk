import type { Page } from '@playwright/test';

export const DEMO_PASSWORD = 'demo-password-123';
export const OWNER = { email: 'owner@demo.local', password: DEMO_PASSWORD };
export const VIEWER = { email: 'viewer@demo.local', password: DEMO_PASSWORD };

/** Unique suffix so repeated runs against the same database do not collide. */
export const uid = () => Date.now().toString(36);

export async function login(page: Page, user: { email: string; password: string }) {
  await page.goto('/login');
  await page.getByTestId('login-email').fill(user.email);
  await page.getByTestId('login-password').fill(user.password);
  await page.getByTestId('login-submit').click();
}
