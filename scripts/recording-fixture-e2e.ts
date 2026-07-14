import { access, mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { GuardedBrowserController } from '../src/browser-controller.js';
import { assertVideoArtifact, PlaywrightFfmpegRecorder } from '../src/recorder.js';
import { startFixtureSite } from '../test/fixture-site.js';

if (!process.argv.includes('--fixture-mode')) throw new Error('Recording fixture requires explicit --fixture-mode.');

const root = path.resolve('runs', 'phase5-recording-fixture-evidence');
await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
await mkdir(root, { recursive: false });
const recorder = new PlaywrightFfmpegRecorder();
const prepared = await recorder.prepare({ artifactDirectory: root, enabled: true, release: true });

if (prepared.state !== 'available') {
  const evidence = { schemaVersion: 1, status: 'BLOCKED', recording: prepared, timestamp: new Date().toISOString() };
  await writeFile(path.join(root, 'recording-fixture.json'), `${JSON.stringify(evidence, null, 2)}\n`, { flag: 'wx' });
  process.stderr.write(`${JSON.stringify(evidence, null, 2)}\n`);
  process.exitCode = 2;
} else {
  const site = await startFixtureSite();
  const controller = new GuardedBrowserController({
    policy: { allowedHosts: ['unused.invalid'], fixtureMode: true, fixturePort: site.port },
    artifactDirectory: root,
    profileDirectory: path.join(root, '.profile'),
    recordVideoDirectory: root,
  });
  try {
    await controller.open();
    await recorder.start(controller.runtime().page);
    await controller.navigate(`${site.origin}/web-ok`);
    await recorder.checkpoint('recording-fixture-ready');
    await controller.runtime().page.waitForTimeout(750);
  } finally {
    await controller.close();
    await site.close();
  }
  const summary = await recorder.stop('RELEASE');
  await recorder.cleanup();
  try {
    await assertVideoArtifact(root, summary);
    await access(path.join(root, 'session.mp4'));
    const evidence = { schemaVersion: 1, status: 'PASSED', recording: summary, timestamp: new Date().toISOString() };
    await writeFile(path.join(root, 'recording-fixture.json'), `${JSON.stringify(evidence, null, 2)}\n`, { flag: 'wx' });
    process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);
  } catch (error) {
    const evidence = { schemaVersion: 1, status: 'BLOCKED', recording: summary, reason: error instanceof Error ? error.message : String(error), timestamp: new Date().toISOString() };
    await writeFile(path.join(root, 'recording-fixture.json'), `${JSON.stringify(evidence, null, 2)}\n`, { flag: 'wx' });
    process.stderr.write(`${JSON.stringify(evidence, null, 2)}\n`);
    process.exitCode = 2;
  }
}
