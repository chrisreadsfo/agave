import fs from 'node:fs';
import { config } from './config.js';
import { log } from './log.js';
import { signIn } from './browser/auth.js';
import { NetworkCapture } from './browser/capture.js';
import { saveAuthState, withSession } from './browser/session.js';
import { PROJECT_LIST, PROJECT_RESOURCES, projectIds, visit } from './fieldwire/extract.js';
import { messageMyTask } from './fieldwire/message.js';
import { latestSyncPath, syncFixtures, syncLive } from './pipeline.js';
import { serve } from './server.js';

const command = process.argv[2] ?? 'help';
const flags = new Set(process.argv.slice(3));

/** Logs in once and caches the session so later runs skip the form. */
async function login(): Promise<void> {
  await withSession(async (session) => {
    const page = await session.context.newPage();
    await signIn(page, { force: flags.has('--force') });
    await saveAuthState(session.context);
  });
}

/** Walks the app and reports which private endpoints back each screen. */
async function discover(): Promise<void> {
  await withSession(async (session) => {
    const capture = new NetworkCapture(session.context).attach();
    const page = await session.context.newPage();

    await signIn(page);
    await visit(page, PROJECT_LIST.route);

    const [first] = config.fieldwire.projectId ? [config.fieldwire.projectId] : projectIds(capture);
    if (first) {
      for (const res of PROJECT_RESOURCES) {
        await visit(page, res.route.replace(':id', first));
      }
    } else {
      log.warn('no project found — create one in Fieldwire first');
    }

    const report = {
      discovered_at: new Date().toISOString(),
      api_base_url: capture.credentials()?.baseUrl ?? null,
      auth_headers: Object.keys(capture.credentials()?.headers ?? {}),
      endpoints: capture.catalog(),
    };
    fs.mkdirSync(config.outDir, { recursive: true });
    fs.writeFileSync(`${config.outDir}/discovery.json`, JSON.stringify(report, null, 2));
    capture.logSummary();
    log.done(`wrote ${config.outDir}/discovery.json — ${report.endpoints.length} distinct endpoints`);
  });
}

const help = `
agave — a unified-API connector for Fieldwire, built on the web app

  npm run login      sign in once, cache the session
  npm run discover   map the private endpoints behind each screen -> out/discovery.json
  npm run sync       pull projects/tasks/drawings/people/files -> out/*.json
  npm run fixtures   replay recorded payloads through the normalizers (no network)
  npm run serve      read-only Agave-style REST API over the last sync
  npm run message -- "Hi Dave"   post a message on a task of yours (a write)

  flags: --remote  run on Browserbase instead of local Chromium
         --force   re-run the login form even if a session is cached
`;

async function main(): Promise<void> {
  switch (command) {
    case 'login':
      return login();
    case 'discover':
      return discover();
    case 'sync': {
      const result = flags.has('--fixtures') ? syncFixtures() : await syncLive();
      log.done(
        `${result.mode}: ${result.projects.length} projects, ${result.tasks.length} tasks, ` +
          `${result.drawings.length} drawings, ${result.project_users.length} people, ${result.files.length} files`,
      );
      for (const w of result.diagnostics.warnings) log.warn(w);
      return;
    }
    case 'message': {
      const text = process.argv.slice(3).filter((a) => !a.startsWith('--')).join(' ');
      if (!text) throw new Error('usage: npm run message -- "Hi Dave"');
      return messageMyTask(text);
    }
    case 'serve':
      if (!fs.existsSync(latestSyncPath())) {
        log.warn('no sync yet — run `npm run sync` or `npm run fixtures` first');
      }
      return serve();
    default:
      console.log(help);
  }
}

main().then(
  () => process.exit(0),
  (err) => {
    log.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  },
);
