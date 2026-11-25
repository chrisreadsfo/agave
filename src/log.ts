const start = Date.now();

function stamp(): string {
  const s = ((Date.now() - start) / 1000).toFixed(1).padStart(5, ' ');
  return `[${s}s]`;
}

export const log = {
  info: (msg: string, ...rest: unknown[]) => console.log(`${stamp()} ${msg}`, ...rest),
  step: (msg: string, ...rest: unknown[]) => console.log(`${stamp()} → ${msg}`, ...rest),
  warn: (msg: string, ...rest: unknown[]) => console.warn(`${stamp()} ! ${msg}`, ...rest),
  error: (msg: string, ...rest: unknown[]) => console.error(`${stamp()} ✗ ${msg}`, ...rest),
  done: (msg: string, ...rest: unknown[]) => console.log(`${stamp()} ✓ ${msg}`, ...rest),
};

export async function retry<T>(
  label: string,
  fn: () => Promise<T>,
  { attempts = 3, baseMs = 750 } = {},
): Promise<T> {
  let lastErr: unknown;
  for (let i = 1; i <= attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (i === attempts) break;
      const wait = baseMs * 2 ** (i - 1);
      log.warn(`${label} failed (attempt ${i}/${attempts}), retrying in ${wait}ms`);
      await new Promise((r) => setTimeout(r, wait));
    }
  }
  throw new Error(`${label} failed after ${attempts} attempts: ${String(lastErr)}`);
}
