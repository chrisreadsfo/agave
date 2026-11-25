import fs from 'node:fs';
import http from 'node:http';
import { config } from './config.js';
import { log } from './log.js';
import { latestSyncPath } from './pipeline.js';
import { decodeUnifiedId } from './unified/normalize.js';
import type { ResourceName, SyncResult } from './unified/types.js';

const RESOURCES: ResourceName[] = ['projects', 'tasks', 'drawings', 'project_users', 'files'];

function load(): SyncResult | null {
  const file = latestSyncPath();
  return fs.existsSync(file) ? (JSON.parse(fs.readFileSync(file, 'utf8')) as SyncResult) : null;
}

/**
 * Read-only mirror of Agave's surface: GET /{resource}, filterable by
 * project_id, returning `{ data, next_page }`. A consumer written against
 * Agave's Procore connector can point at this with no code change.
 */
export function serve(): Promise<void> {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', `http://localhost:${config.port}`);
    const name = url.pathname.replace(/^\/+|\/+$/g, '') as ResourceName | '';
    const json = (status: number, body: unknown) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(body, null, 2));
    };

    const sync = load();
    if (!sync) return json(503, { error: 'no sync on disk — run `npm run sync` first' });

    if (name === '') {
      return json(200, {
        source: sync.source,
        mode: sync.mode,
        synced_at: sync.synced_at,
        resources: RESOURCES.map((r) => ({ name: r, count: sync[r].length, href: `/${r}` })),
      });
    }
    if (!RESOURCES.includes(name)) return json(404, { error: `unknown resource '${name}'` });

    const projectId = url.searchParams.get('project_id');
    const data = (sync[name] as unknown as Array<Record<string, unknown>>).filter(
      (row) => !projectId || row['project_id'] === projectId || row['id'] === projectId,
    );
    return json(200, { data, next_page: null });
  });

  return new Promise((resolve) => {
    server.listen(config.port, () => {
      log.done(`Agave-style API on http://localhost:${config.port}`);
      log.info(`try: curl localhost:${config.port}/tasks | head -40`);
      log.info(`ids decode for debugging, e.g. ${decodeUnifiedId('ZmllbGR3aXJlL3Rhc2svMTIz')}`);
    });
    server.on('close', resolve);
  });
}
