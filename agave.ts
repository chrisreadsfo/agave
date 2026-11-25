/**
 * agave — a Fieldwire connector that drives the web app.
 *
 * Fieldwire's API is sales-gated (Enterprise, or Pro/Business "in conjunction
 * with our sales team") while anyone can open a free account. So the integration
 * surface is the UI: sign in as the customer and click exactly where they click.
 *
 * Runs top to bottom. No LLM, no agent — every step is a fixed Playwright call.
 *
 *   npm run local                      headful Chromium on this machine
 *   npm run cloud                      the same run on a Browserbase session
 *   npm run local -- --message "Hi Dave"   also post on the first task of mine
 *   npm run local -- --headless            no window
 */
import 'dotenv/config';
import fs from 'node:fs';
import Browserbase from '@browserbasehq/sdk';
import { localBrowser } from '@browserbasehq/stagehand';
import { chromium, type Page } from 'playwright';

const ARGV = process.argv.slice(2);
const has = (f: string) => ARGV.includes(`--${f}`);
const arg = (f: string) => (has(f) ? ARGV[ARGV.indexOf(`--${f}`) + 1] ?? null : null);

const MODE = ARGV[0] === 'cloud' ? 'cloud' : 'local';
const MESSAGE = arg('message');
const PROJECT = arg('project') ?? process.env.FIELDWIRE_PROJECT ?? null;
const BUDGET_S = 300;

const t0 = Date.now();
const log = (m: string) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s] ${m}`);

/** Fieldwire interrupts with coach-marks whose backdrop silently eats clicks. */
const dismissModal = async (page: Page) => {
  const close = page.locator('[data-text="Close"]').first();
  if (!(await close.isVisible({ timeout: 1_000 }).catch(() => false))) return;
  await close.click();
  await close.waitFor({ state: 'hidden' });
};

/* ── 1. open a browser ──────────────────────────────────────────────────────
   Stagehand launches and owns the browser; Playwright drives it over CDP. Local
   by default so remote minutes stay unspent; --remote runs this same code on a
   Browserbase session, capped server-side by api_timeout. */

let replay: string | null = null;
let connectUrl: string;
let local: Awaited<ReturnType<typeof localBrowser.launch>> | null = null;

if (MODE === 'cloud') {
  const bb = new Browserbase({ apiKey: process.env.BROWSERBASE_API_KEY! });
  const session = await bb.sessions.create({ api_timeout: BUDGET_S, keepAlive: false });
  log(`Browserbase ${session.id} — live debug: ${(await bb.sessions.debug(session.id)).debuggerUrl}`);
  connectUrl = session.connectUrl;
  replay = `https://browserbase.com/sessions/${session.id}`;
} else {
  log(`local Chromium (headless=${has('headless')})`);
  local = await localBrowser.launch({ headless: has('headless'), viewport: { width: 1600, height: 1000 } });
  connectUrl = local.cdpUrl!;
}

const browser = await chromium.connectOverCDP(connectUrl);
const watchdog = setTimeout(() => void browser.close(), BUDGET_S * 1_000);

try {
  // Work in the tab the browser already opened rather than adding another.
  const context = browser.contexts()[0]!;
  context.setDefaultTimeout(30_000);
  const page = context.pages()[0] ?? (await context.newPage());
  // Browserbase's captcha solver reports through the page console.
  page.on('console', (m) => m.text().startsWith('browserbase-solving') && log(m.text()));

  /* ── 2. sign in ─────────────────────────────────────────────────────────── */

  await page.goto('https://app.fieldwire.com/#/sign_in', { waitUntil: 'domcontentloaded' });
  await page.locator('input[type="email"], input[name="email"]').first().fill(process.env.FIELDWIRE_EMAIL!);

  // Fieldwire gates the password behind a Continue step while it checks for SSO.
  const password = page.locator('input[type="password"]').first();
  if (!(await password.isVisible({ timeout: 3_000 }).catch(() => false))) {
    await page.getByRole('button', { name: /continue|next/i }).first().click();
  }
  await password.fill(process.env.FIELDWIRE_PASSWORD!);
  await page.getByRole('button', { name: /sign in|log in/i }).first().click();
  await page.waitForURL(/\/index\//);
  log('signed in');

  /* ── 3. click into the project, then onto my tasks ──────────────────────── */

  await dismissModal(page);
  await page
    .locator(PROJECT ? `[data-e2e="${PROJECT}-project-card-name"]` : '[data-e2e$="-project-card-name"]')
    .first()
    .click();
  await page.waitForURL(/\/projects\/[0-9a-f-]+\//);
  log(`opened project ${page.url().split('/')[4]}`);

  await page.locator('[data-e2e="project-sidebar-tasks-tab"]').click();
  // A dispatched event ignores hit-testing, so a coach-mark backdrop can't eat it.
  await page.locator('[data-e2e="sidebar-my-tasks-filter"]').dispatchEvent('click');

  /* ── 4. read what the customer sees ─────────────────────────────────────── */

  const rows = page.locator('[data-e2e="task-name-ontaskpage"]');
  await rows.first().waitFor({ state: 'visible' });
  // The "Overdue tasks has moved" coach-mark only lands once the board renders,
  // so this is the first moment there is anything to dismiss.
  await dismissModal(page);
  const names = (await rows.allInnerTexts()).map((n) => n.trim());
  log(`${names.length} tasks assigned to me: ${names.join(' | ')}`);

  /* ── 5. post a message ──────────────────────────────────────────────────────
     Fieldwire calls task comments "bubbles". Enter inserts a newline, so the
     submit button has to be clicked, and the POST is the proof it landed. */

  if (MESSAGE) {
    await rows.first().dispatchEvent('click');

    // The activity panel scrolls itself as images load; without this it fights
    // Playwright's scroll-into-view on every action.
    await page.addStyleTag({ content: '*{scroll-behavior:auto!important;animation:none!important}' });

    const box = page.locator('textarea[placeholder*="Enter message" i]').first();
    await box.waitFor({ state: 'visible' });
    await box.fill(MESSAGE);

    const posted = page.waitForResponse((r) => r.request().method() === 'POST' && r.url().includes('/bubbles'));
    // Fail fast if something is covering the button, rather than retrying for 30s.
    await page.locator('[data-e2e="task-edit-bubble-submit-button"] button').click({ timeout: 10_000 });
    log(`posted "${MESSAGE}" — POST /bubbles -> ${(await posted).status()}`);
    fs.mkdirSync('out', { recursive: true });
    await page.screenshot({ path: 'out/message.png' });
  }
} finally {
  clearTimeout(watchdog);
  await browser.close().catch(() => {});
  await local?.close().catch(() => {});
  if (replay) log(`recording: ${replay}`);
  log('done');
}
