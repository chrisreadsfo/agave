import type { Page } from 'playwright';
import { config } from '../config.js';
import { log } from '../log.js';
import { NetworkCapture } from '../browser/capture.js';
import { signIn } from '../browser/auth.js';
import { withSession } from '../browser/session.js';

type Raw = Record<string, unknown>;

const API = 'https://app.fieldwire.com/api/v3';
const COMPOSER = 'textarea[placeholder*="Enter message" i]';
const SUBMIT = '[data-e2e="task-edit-bubble-submit-button"] button';
const TASK_ROW = '[data-e2e="task-name-ontaskpage"]';

/** Fieldwire opens an onboarding/upsell overlay that swallows clicks. */
async function clearOverlays(page: Page): Promise<boolean> {
  for (let i = 0; i < 8; i++) {
    const backdrop = page.locator('.cdk-overlay-backdrop-showing').first();
    if (!(await backdrop.isVisible({ timeout: 1_000 }).catch(() => false))) return true;
    const close = page.locator('[aria-label*="close" i], [data-e2e*="close" i], mat-dialog-container button').first();
    if (await close.isVisible({ timeout: 500 }).catch(() => false)) await close.click().catch(() => {});
    else await page.keyboard.press('Escape');
    await page.waitForTimeout(900);
  }
  return false;
}

/** Posts `text` as a message on a task owned by the signed-in user. */
export async function messageMyTask(text: string): Promise<void> {
  await withSession(async (session) => {
    const capture = new NetworkCapture(session.context).attach();
    const page = await session.context.newPage();
    await signIn(page);

    const projectId = config.fieldwire.projectId;
    if (!projectId) throw new Error('set FIELDWIRE_PROJECT_ID');

    await page.goto(`https://app.fieldwire.com/projects/${projectId}/tasks`, { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle').catch(() => {});
    await page.waitForTimeout(3_000);
    log.info(`overlay cleared: ${await clearOverlays(page)}`);

    // Replay the app's own API with its session to pick the target deterministically.
    const headers = capture.find(/\/api\/v3\//)!.authHeaders;
    const get = async <T>(path: string): Promise<T> =>
      (await (await session.context.request.get(`${API}${path}`, { headers })).json()) as T;

    const me = await get<Raw>('/current_user');
    log.info(`signed in as ${me['email']} (${me['id']})`);

    const tasks = await get<Raw[]>(`/projects/${projectId}/tasks`);
    const mine = tasks.filter((t) => t['owner_user_id'] === me['id']);
    if (mine.length === 0) throw new Error(`no task assigned to ${me['email']}`);

    const task = mine[0]!;
    log.info(`${mine.length} tasks assigned to me; target #${task['sequence_number']} ${task['name']}`);

    await clearOverlays(page);
    const row = page.locator(TASK_ROW).filter({ hasText: String(task['name']) }).first();
    await row.waitFor({ state: 'visible' });
    // The upsell backdrop can re-appear mid-click; a dispatched event ignores hit-testing.
    await row.click({ timeout: 8_000 }).catch(async () => {
      log.warn('click intercepted — dispatching the event directly');
      await row.dispatchEvent('click');
    });
    await page.waitForTimeout(3_000);
    await clearOverlays(page);

    // Fieldwire calls task comments "bubbles"; Enter inserts a newline, so submit explicitly.
    const box = page.locator(COMPOSER).first();
    await box.scrollIntoViewIfNeeded();
    await box.fill(text);
    await page.locator(SUBMIT).first().click();
    await page.waitForTimeout(3_000);

    const write = capture.calls.find((c) => c.method === 'POST' && /\/bubbles/.test(c.url));
    const visible = await page
      .locator('[data-e2e="task-comment-component"]')
      .filter({ hasText: text })
      .first()
      .isVisible({ timeout: 8_000 })
      .catch(() => false);

    await page.screenshot({ path: `${config.outDir}/message.png` });
    if (!write && !visible) throw new Error(`submitted "${text}" but saw no confirmation — see out/message.png`);
    log.done(
      `posted "${text}" on task #${task['sequence_number']} ${task['name']}` +
        (write ? ` (POST ${new URL(write.url).pathname} -> ${write.status})` : ''),
    );
  });
}
