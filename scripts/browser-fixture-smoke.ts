import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { GuardedBrowserController } from '../src/browser-controller.js';
import { startFixtureSite } from '../test/fixture-site.js';

if (!process.argv.includes('--fixture-mode')) {
  throw new Error('Refusing to run: pass --fixture-mode to authorize loopback fixture execution.');
}

const root = path.resolve('runs', 'phase2-browser-fixture-evidence');
const artifactDirectory = path.join(root, 'artifacts');
const profileDirectory = path.join(root, 'qa-profile');
await mkdir(root, { recursive: true });
const site = await startFixtureSite();
const controller = new GuardedBrowserController({
  policy: { allowedHosts: ['unused.invalid'], fixtureMode: true, fixturePort: site.port },
  artifactDirectory,
  profileDirectory,
  timeoutMs: 5_000,
});

try {
  await controller.open();
  await controller.navigate(`${site.origin}/ok`);
  const screenshot = await controller.screenshot('fixture-ok');
  await controller.navigate(`${site.origin}/console-error`);
  await controller.navigate(`${site.origin}/network-error`);
  await controller.perform({ type: 'wait', durationMs: 250 });
  try { await controller.navigate(`${site.origin}/redirect-external`); } catch { /* expected guard denial */ }
  console.log(JSON.stringify({ fixtureOnly: true, screenshot, events: path.join(artifactDirectory, 'browser-events.jsonl') }));
} finally {
  await controller.close();
  await site.close();
}
