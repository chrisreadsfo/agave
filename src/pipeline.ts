import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import { log } from './log.js';
import { NetworkCapture } from './browser/capture.js';
import { signIn } from './browser/auth.js';
import { withSession } from './browser/session.js';
import { PROJECT_LIST, PROJECT_RESOURCES, collect, projectIds, visit } from './fieldwire/extract.js';
import {
  normalizeDrawing,
  normalizeFile,
  normalizeProject,
  normalizeProjectUser,
  normalizeTask,
  unifiedId,
} from './unified/normalize.js';
import type { SyncResult } from './unified/types.js';

/** Drives the real site and returns Agave-shaped records. No LLM in the loop. */
export async function syncLive(): Promise<SyncResult> {
  const startedAt = Date.now();
  const warnings: string[] = [];

  return withSession(async (session) => {
    const capture = new NetworkCapture(session.context).attach();
    const page = await session.context.newPage();

    await signIn(page);
    await visit(page, PROJECT_LIST.route);

    const ids = config.fieldwire.projectId ? [config.fieldwire.projectId] : projectIds(capture);
    if (ids.length === 0) warnings.push('no projects found in captured traffic');
    log.info(`projects: ${ids.length}`);

    const result: SyncResult = {
      source: 'fieldwire',
      mode: 'live',
      synced_at: new Date().toISOString(),
      projects: [],
      tasks: [],
      drawings: [],
      project_users: [],
      files: [],
      diagnostics: { captured_calls: 0, api_base_url: null, endpoints: [], warnings, duration_ms: 0 },
    };

    const projects = collect(capture, PROJECT_LIST.match);
    result.projects = projects.rows.map((r) => normalizeProject(r, projects.path));

    for (const sourceProjectId of ids) {
      if (session.remainingMs() < 45_000) {
        warnings.push(`stopped early at project ${sourceProjectId}: session budget nearly spent`);
        break;
      }
      const projectId = unifiedId('project', sourceProjectId);
      for (const res of PROJECT_RESOURCES) {
        await visit(page, res.route.replace(':id', sourceProjectId));
        const { path: p, rows } = collect(capture, res.match);
        if (rows.length === 0) {
          warnings.push(`${res.resource}: no rows captured for project ${sourceProjectId}`);
          continue;
        }
        if (res.resource === 'tasks') result.tasks.push(...rows.map((r) => normalizeTask(r, projectId, p)));
        if (res.resource === 'drawings') result.drawings.push(...rows.map((r) => normalizeDrawing(r, projectId, p)));
        if (res.resource === 'project_users') result.project_users.push(...rows.map((r) => normalizeProjectUser(r, projectId, p)));
        if (res.resource === 'files') result.files.push(...rows.map((r) => normalizeFile(r, projectId, p)));
        log.info(`${res.resource}: ${rows.length} rows`);
      }
    }

    result.diagnostics = {
      captured_calls: capture.calls.length,
      api_base_url: capture.credentials()?.baseUrl ?? null,
      endpoints: capture.catalog(),
      warnings,
      duration_ms: Date.now() - startedAt,
    };
    capture.logSummary();
    writeOutput(result, capture.calls);
    return result;
  });
}

/** Replays recorded payloads through the same normalizers — no network, no cost. */
export function syncFixtures(): SyncResult {
  const startedAt = Date.now();
  const read = (name: string): Record<string, unknown>[] => {
    const file = path.join('fixtures', `${name}.json`);
    if (!fs.existsSync(file)) return [];
    return JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, unknown>[];
  };

  const projects = read('projects');
  const projectId = unifiedId('project', String(projects[0]?.['id'] ?? 'fixture'));
  const result: SyncResult = {
    source: 'fieldwire',
    mode: 'fixtures',
    synced_at: new Date().toISOString(),
    projects: projects.map((r) => normalizeProject(r, '/api/v3/projects')),
    tasks: read('tasks').map((r) => normalizeTask(r, projectId, '/api/v3/projects/:id/tasks')),
    drawings: read('sheets').map((r) => normalizeDrawing(r, projectId, '/api/v3/projects/:id/sheets')),
    project_users: read('project_users').map((r) => normalizeProjectUser(r, projectId, '/api/v3/projects/:id/project_users')),
    files: read('files').map((r) => normalizeFile(r, projectId, '/api/v3/projects/:id/files')),
    diagnostics: { captured_calls: 0, api_base_url: null, endpoints: [], warnings: [], duration_ms: 0 },
  };
  result.diagnostics.duration_ms = Date.now() - startedAt;
  writeOutput(result, []);
  return result;
}

export function writeOutput(result: SyncResult, calls: unknown[]): void {
  fs.mkdirSync(config.outDir, { recursive: true });
  const write = (name: string, data: unknown) => {
    const file = path.join(config.outDir, name);
    fs.writeFileSync(file, JSON.stringify(data, null, 2));
    log.done(`wrote ${path.relative(process.cwd(), file)}`);
  };
  write('sync.json', result);
  for (const key of ['projects', 'tasks', 'drawings', 'project_users', 'files'] as const) {
    write(`${key}.json`, { data: result[key], next_page: null });
  }
  if (calls.length) write('network-log.json', calls);
}

export const latestSyncPath = () => path.join(config.outDir, 'sync.json');
