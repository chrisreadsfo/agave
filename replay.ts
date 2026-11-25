/**
 * Downloads the MP4 recording of a Browserbase session.
 *
 *   npx tsx replay.ts <sessionId> [outDir]
 *
 * The session id is printed by `npm run cloud` on the "recording:" line.
 */
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { Browserbase } from '@browserbasehq/sdk';

const sessionId = process.argv[2];
const outDir = process.argv[3] ?? 'recording';
if (!sessionId) throw new Error('usage: npx tsx replay.ts <sessionId> [outDir]');

const bb = new Browserbase({ apiKey: process.env.BROWSERBASE_API_KEY! });

// Request one MP4 per recorded page (tab); each starts PENDING while it assembles.
await bb.sessions.recording.downloads.create(sessionId);

let downloads;
do {
  await new Promise((r) => setTimeout(r, 3_000));
  ({ downloads } = await bb.sessions.recording.downloads.list(sessionId));
  console.log(downloads.map((d) => `${d.pageId}:${d.status}`).join(' '));
} while (downloads.some((d) => d.status === 'PENDING'));

fs.mkdirSync(outDir, { recursive: true });
for (const page of downloads) {
  if (!page.downloadUrl) continue;
  const res = await fetch(page.downloadUrl);
  const file = path.join(outDir, downloads.length > 1 ? `${sessionId}-${page.pageId}.mp4` : `${sessionId}.mp4`);
  fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
  console.log(`${file} — ${(fs.statSync(file).size / 1e6).toFixed(1)} MB`);
}
