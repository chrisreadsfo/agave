import 'dotenv/config';
import path from 'node:path';

function req(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var ${name} (copy .env.example to .env)`);
  return v;
}

/** Remote runs are explicit: `--remote` or REMOTE=true. */
export const REMOTE = process.argv.includes('--remote') || process.env.REMOTE === 'true';

export const config = {
  fieldwire: {
    get email() { return req('FIELDWIRE_EMAIL'); },
    get password() { return req('FIELDWIRE_PASSWORD'); },
    projectId: process.env.FIELDWIRE_PROJECT_ID || null,
    appUrl: 'https://app.fieldwire.com',
    signInUrl: 'https://app.fieldwire.com/#/sign_in',
  },
  browserbase: {
    apiKey: process.env.BROWSERBASE_API_KEY || null,
    contextId: process.env.BROWSERBASE_CONTEXT_ID || null,
    /** Opt-in only: local Chromium is the default so remote minutes stay unspent. */
    get enabled() { return REMOTE && Boolean(this.apiKey); },
  },
  headless: process.env.HEADLESS !== 'false',
  slowMo: Number(process.env.SLOW_MO ?? 0),
  outDir: path.resolve(process.env.OUT_DIR || './out'),
  authStatePath: path.resolve('./.auth/fieldwire.json'),
  port: Number(process.env.PORT ?? 8787),
};
