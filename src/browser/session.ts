import fs from 'node:fs';
import path from 'node:path';
import { browserbase, localBrowser, type StagehandBrowser } from '@browserbasehq/stagehand';
import { chromium, type BrowserContext } from 'playwright';
import { config } from '../config.js';
import { log } from '../log.js';

/**
 * Hard ceiling for one run, enforced twice: Browserbase's own session timeout
 * and a local watchdog, so a hang can never leave a paid session running.
 */
export const SESSION_BUDGET_MS = 5 * 60 * 1000;

export interface Session {
  context: BrowserContext;
  replayUrl: string | null;
  remainingMs(): number;
  close(): Promise<void>;
}

/**
 * Stagehand owns the browser process; Playwright drives it over CDP.
 * No Stagehand instance, no model, no agent — the extraction is deterministic.
 */
async function launch(): Promise<{ handle: StagehandBrowser; connectUrl: string }> {
  if (config.browserbase.enabled) {
    log.info('runner: Browserbase');
    const handle = await browserbase.launch({
      apiKey: config.browserbase.apiKey!,
      // Project is inferred from the API key.
      api_timeout: SESSION_BUDGET_MS / 1000,
      keepAlive: false,
      browserSettings: {
        viewport: { width: 1600, height: 1000 },
        blockAds: true,
        ...(config.browserbase.contextId
          ? { context: { id: config.browserbase.contextId, persist: true } }
          : {}),
      },
    });
    const connectUrl = `wss://connect.browserbase.com?apiKey=${config.browserbase.apiKey}&sessionId=${handle.sessionId}`;
    return { handle, connectUrl };
  }

  log.info(`runner: local Chromium (headless=${config.headless})`);
  const handle = await localBrowser.launch({
    headless: config.headless,
    viewport: { width: 1600, height: 1000 },
  });
  return { handle, connectUrl: handle.cdpUrl! };
}

export async function openSession({ reuseAuth = true } = {}): Promise<Session> {
  const startedAt = Date.now();
  const { handle, connectUrl } = await launch();
  const browser = await chromium.connectOverCDP(connectUrl);
  const context = browser.contexts()[0] ?? (await browser.newContext());

  context.setDefaultTimeout(30_000);
  context.setDefaultNavigationTimeout(45_000);

  if (reuseAuth && fs.existsSync(config.authStatePath)) {
    const state = JSON.parse(fs.readFileSync(config.authStatePath, 'utf8')) as {
      cookies?: Parameters<BrowserContext['addCookies']>[0];
    };
    if (state.cookies?.length) await context.addCookies(state.cookies);
    log.info(`reusing saved login from ${path.relative(process.cwd(), config.authStatePath)}`);
  }

  const replayUrl = handle.sessionId
    ? `https://www.browserbase.com/sessions/${handle.sessionId}`
    : null;
  if (replayUrl) log.info(`session ${handle.sessionId} (5m budget) — ${replayUrl}`);

  let closed = false;
  const close = async (): Promise<void> => {
    if (closed) return;
    closed = true;
    clearTimeout(watchdog);
    await browser.close().catch(() => {});
    await handle.close().catch(() => {});
    log.info(`session open for ${((Date.now() - startedAt) / 1000).toFixed(1)}s`);
  };

  const watchdog = setTimeout(() => {
    log.warn('5-minute budget reached — killing the session');
    void close();
  }, SESSION_BUDGET_MS);
  watchdog.unref?.();

  process.once('SIGINT', () => void close());
  process.once('SIGTERM', () => void close());

  return {
    context,
    replayUrl,
    remainingMs: () => Math.max(0, SESSION_BUDGET_MS - (Date.now() - startedAt)),
    close,
  };
}

export async function saveAuthState(context: BrowserContext): Promise<void> {
  fs.mkdirSync(path.dirname(config.authStatePath), { recursive: true });
  await context.storageState({ path: config.authStatePath });
  log.done(`saved login to ${path.relative(process.cwd(), config.authStatePath)}`);
}

/** Runs `fn` with a session and guarantees teardown. */
export async function withSession<T>(fn: (s: Session) => Promise<T>): Promise<T> {
  const session = await openSession();
  try {
    return await fn(session);
  } finally {
    await session.close();
  }
}
