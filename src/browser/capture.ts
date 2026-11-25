import type { BrowserContext, Request } from 'playwright';
import { log } from '../log.js';

export interface CapturedCall {
  method: string;
  url: string;
  status: number;
  /** Request headers worth replaying (auth, api version, pagination). */
  authHeaders: Record<string, string>;
  body: unknown;
  at: string;
}

const AUTH_HEADER_NAMES = new Set([
  'authorization',
  'fieldwire-version',
  'fieldwire-filter',
  'fieldwire-per-page',
  'x-api-key',
  'x-request-id',
  'accept',
  'content-type',
]);

function pickAuthHeaders(req: Request): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(req.headers())) {
    const key = k.toLowerCase();
    if (AUTH_HEADER_NAMES.has(key) || key.startsWith('fieldwire-')) out[key] = v;
  }
  return out;
}

/**
 * Records the SPA's own JSON API traffic. This is the backbone of the connector:
 * we drive the UI only far enough to make Fieldwire's web client call its private
 * API for us, then read and replay those calls. Far more stable than DOM scraping.
 */
export class NetworkCapture {
  readonly calls: CapturedCall[] = [];

  constructor(private readonly context: BrowserContext) {}

  attach(): this {
    this.context.on('response', async (res) => {
      const req = res.request();
      const url = res.url();
      if (req.resourceType() !== 'xhr' && req.resourceType() !== 'fetch') return;
      if (!/\/api\//.test(url) && !/api\./.test(new URL(url).host)) return;

      const ctype = (res.headers()['content-type'] ?? '').toLowerCase();
      if (!ctype.includes('json')) return;

      let body: unknown = null;
      try {
        body = await res.json();
      } catch {
        return;
      }
      this.calls.push({
        method: req.method(),
        url,
        status: res.status(),
        authHeaders: pickAuthHeaders(req),
        body,
        at: new Date().toISOString(),
      });
    });
    return this;
  }

  /** The newest successful GET whose URL matches `pattern`. */
  find(pattern: RegExp): CapturedCall | undefined {
    return [...this.calls]
      .reverse()
      .find((c) => c.method === 'GET' && c.status < 300 && pattern.test(c.url));
  }

  findAll(pattern: RegExp): CapturedCall[] {
    return this.calls.filter((c) => c.method === 'GET' && c.status < 300 && pattern.test(c.url));
  }

  /** Credentials + base URL to replay calls ourselves. */
  credentials(): { baseUrl: string; headers: Record<string, string> } | null {
    const withAuth = [...this.calls]
      .reverse()
      .find((c) => c.authHeaders['authorization'] && c.status < 300);
    if (!withAuth) return null;
    const u = new URL(withAuth.url);
    const apiRoot = u.pathname.match(/^(\/api\/v\d+)/)?.[1] ?? '';
    return { baseUrl: `${u.origin}${apiRoot}`, headers: withAuth.authHeaders };
  }

  /** Human-readable map of what the app actually called, for the discover report. */
  catalog(): Array<{ method: string; endpoint: string; hits: number; sampleKeys: string[] }> {
    const byEndpoint = new Map<string, { method: string; endpoint: string; hits: number; sampleKeys: string[] }>();
    for (const call of this.calls) {
      // Collapse ids out of the path so /projects/abc/tasks groups with /projects/def/tasks.
      const endpoint = new URL(call.url).pathname
        .replace(/\/[0-9a-f]{8}-[0-9a-f-]{27,}/gi, '/:id')
        .replace(/\/\d{3,}/g, '/:id');
      const key = `${call.method} ${endpoint}`;
      const first = Array.isArray(call.body) ? call.body[0] : call.body;
      const sampleKeys = first && typeof first === 'object' ? Object.keys(first as object).slice(0, 25) : [];
      const prev = byEndpoint.get(key);
      if (prev) prev.hits += 1;
      else byEndpoint.set(key, { method: call.method, endpoint, hits: 1, sampleKeys });
    }
    return [...byEndpoint.values()].sort((a, b) => b.hits - a.hits);
  }

  summary(): string {
    const n = this.calls.length;
    const creds = this.credentials();
    return `${n} JSON API call${n === 1 ? '' : 's'} captured${creds ? `, base=${creds.baseUrl}` : ', no bearer token seen'}`;
  }

  logSummary(): void {
    log.info(this.summary());
  }
}
