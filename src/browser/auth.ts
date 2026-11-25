import type { Page } from 'playwright';
import { config } from '../config.js';
import { log } from '../log.js';
import { retry } from '../log.js';
import { saveAuthState } from './session.js';

/**
 * Signed in means: on a fieldwire.com page that is not the sign-in form.
 * Fieldwire lands on /index/projects, so the authenticated routes are the tell
 * rather than any one piece of chrome.
 */
async function isSignedIn(page: Page): Promise<boolean> {
  const url = page.url();
  if (!url.includes('fieldwire.com')) return false;
  if (/sign_in|sign-in|sign_up|login|password/i.test(url)) return false;
  if (/\/index\//.test(url) || /\/projects/.test(url)) return true;
  return !(await page
    .locator('input[type="password"]')
    .first()
    .isVisible({ timeout: 1_500 })
    .catch(() => false));
}

/**
 * Deterministic login. No LLM, no agent: fixed selectors with a couple of
 * fallbacks, which is how a production connector handles a stable login form.
 */
export async function signIn(page: Page, { force = false } = {}): Promise<void> {
  await retry('open Fieldwire', () =>
    page.goto(config.fieldwire.appUrl, { waitUntil: 'domcontentloaded' }),
  );
  await page.waitForTimeout(1_500);

  if (!force && (await isSignedIn(page))) {
    log.done('already signed in (reused session)');
    return;
  }

  log.step('signing in');
  await page.goto(config.fieldwire.signInUrl, { waitUntil: 'domcontentloaded' });

  const email = page
    .locator('input[type="email"], input[name="email"], input#email, input[autocomplete="username"]')
    .first();
  await email.waitFor({ state: 'visible' });
  await email.fill(config.fieldwire.email);

  const password = page
    .locator('input[type="password"], input[name="password"], input#password')
    .first();
  // Fieldwire sometimes gates the password behind a "Continue" step.
  if (!(await password.isVisible({ timeout: 2_000 }).catch(() => false))) {
    await page.getByRole('button', { name: /continue|next/i }).first().click();
    await password.waitFor({ state: 'visible' });
  }
  await password.fill(config.fieldwire.password);

  await Promise.all([
    page.waitForLoadState('networkidle').catch(() => {}),
    page
      .getByRole('button', { name: /sign in|log in|continue/i })
      .first()
      .click(),
  ]);
  await page.waitForTimeout(3_000);

  if (!(await isSignedIn(page))) {
    const url = page.url();
    const error = await page
      .locator('[class*="error"], [role="alert"]')
      .first()
      .textContent()
      .catch(() => null);
    throw new Error(
      `sign-in did not land in the app (url=${url})${error ? ` — page said: ${error.trim()}` : ''}`,
    );
  }

  log.done('signed in');
  await saveAuthState(page.context());
}
