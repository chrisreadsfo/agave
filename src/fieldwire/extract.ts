import type { Page } from 'playwright';
import type { NetworkCapture } from '../browser/capture.js';
import { log } from '../log.js';

/**
 * One row per resource: the SPA route that makes Fieldwire fetch it, and the
 * URL pattern that identifies the resulting JSON call.
 */
export interface ResourceRoute {
  resource: 'projects' | 'tasks' | 'drawings' | 'project_users' | 'files';
  /** Hash route, with :id substituted for the project. */
  route: string;
  match: RegExp;
}

export const PROJECT_LIST: ResourceRoute = {
  resource: 'projects',
  route: '#/projects',
  match: /\/projects(\?|$)/,
};

export const PROJECT_RESOURCES: ResourceRoute[] = [
  { resource: 'tasks', route: '#/projects/:id/tasks', match: /\/tasks(\?|$)/ },
  { resource: 'drawings', route: '#/projects/:id/plans', match: /\/(sheets|floorplans|plans)(\?|$)/ },
  { resource: 'project_users', route: '#/projects/:id/people', match: /\/(project_users|users|members|teams)(\?|$)/ },
  { resource: 'files', route: '#/projects/:id/files', match: /\/(files|attachments|folders)(\?|$)/ },
];

/** Navigates a route and waits for the SPA's fetches to settle. */
export async function visit(page: Page, route: string): Promise<void> {
  const url = `https://app.fieldwire.com/${route}`;
  log.step(`visit ${route}`);
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(1_200);
}

/** Fieldwire returns bare arrays in some places and envelopes in others. */
export function rows(body: unknown): Record<string, unknown>[] {
  if (Array.isArray(body)) return body.filter((r): r is Record<string, unknown> => typeof r === 'object' && r !== null);
  if (body && typeof body === 'object') {
    for (const value of Object.values(body as Record<string, unknown>)) {
      if (Array.isArray(value)) return rows(value);
    }
  }
  return [];
}

/** Collects every captured call for a resource and flattens it to rows + path. */
export function collect(
  capture: NetworkCapture,
  match: RegExp,
): { path: string; rows: Record<string, unknown>[] } {
  const calls = capture.findAll(match);
  if (calls.length === 0) return { path: '', rows: [] };
  const all = calls.flatMap((c) => rows(c.body));
  const seen = new Set<string>();
  const unique = all.filter((r) => {
    const id = String(r['id'] ?? '');
    if (!id) return true;
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
  return { path: new URL(calls.at(-1)!.url).pathname, rows: unique };
}

/** Project ids as seen by the SPA, newest-first. */
export function projectIds(capture: NetworkCapture): string[] {
  const { rows: projects } = collect(capture, PROJECT_LIST.match);
  return projects.map((p) => String(p['id'] ?? '')).filter(Boolean);
}
