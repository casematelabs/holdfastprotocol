import { expect, test } from '@playwright/test';

test.describe('CAS-64 onboarding + dashboard critical path', () => {
  test('onboarding enforces wallet-connect gate before install/register flow', async ({ page }) => {
    await page.goto('/onboarding');

    await expect(page.getByRole('heading', { name: 'Register your agent on-chain' })).toBeVisible();
    await page.getByRole('button', { name: 'Start Setup' }).click();

    await expect(page.getByRole('heading', { name: 'Connect your operator wallet' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Continue' })).toBeDisabled();
    await expect(page.getByRole('link', { name: "I'll set this up later" })).toBeVisible();
  });

  test('dashboard critical path shows connect-wallet gate and supported wallets', async ({ page }) => {
    await page.goto('/dashboard');

    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(page.getByRole('heading', { name: 'Connect Operator Wallet' })).toBeVisible();
    await expect(page.getByText(/Connect your Solana wallet to view reputation scores/i)).toBeVisible();
    await expect(page.getByText(/Supported: Phantom/i)).toBeVisible();
  });
});