import { access, mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { GuardedBrowserController } from '../src/browser-controller.js';
import { assertVideoArtifact, PlaywrightFfmpegRecorder, type RecordingSummary } from '../src/recorder.js';
import { startFixtureSite } from '../test/fixture-site.js';

if (!process.argv.includes('--fixture-mode')) throw new Error('Recording fixture requires explicit --fixture-mode.');

const root = path.resolve('runs', 'phase5-recording-fixture-evidence');
await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
await mkdir(root, { recursive: false });
const recorder = new PlaywrightFfmpegRecorder();
const prepared = await recorder.prepare({ artifactDirectory: root, enabled: true, release: true, captureTabAudio: true, requireAudio: true });

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
    recordVideoSize: { width: 1920, height: 1080 },
    captureTabAudio: true,
  });
  let summary: RecordingSummary | undefined;
  try {
    await controller.open();
    await controller.navigate(`${site.origin}/web-ok`);
    await recorder.start(controller.runtime().page);
    await recorder.checkpoint('recording-fixture-ready');
    await controller.runtime().page.evaluate(String.raw`(async () => {
      for (const [frequency, delayMs] of [[440, 0], [660, 150]]) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
        const context = new AudioContext();
        const oscillator = context.createOscillator();
        const gain = context.createGain();
        oscillator.frequency.value = frequency;
        gain.gain.value = 0.04;
        oscillator.connect(gain); gain.connect(context.destination);
        oscillator.start(); oscillator.stop(context.currentTime + 0.75);
        await new Promise((resolve) => { oscillator.onended = resolve; });
        await context.close();
      }
    })()`);
    summary = await recorder.stop('RELEASE');
  } finally {
    await controller.close();
    await site.close();
  }
  if (!summary) throw new Error('Recorder did not produce a summary.');
  await recorder.cleanup();
  try {
    const inspection = await assertVideoArtifact(root, summary, {
      minimumDurationMs: 600,
      maximumDurationMs: 10_000,
      minimumAudioCoverageRatio: 0.6,
      maximumAudioCoverageRatio: 1.1,
    });
    await access(path.join(root, 'session.mp4'));
    const evidence = { schemaVersion: 1, status: 'PASSED', recording: summary, inspection, timestamp: new Date().toISOString() };
    await writeFile(path.join(root, 'recording-fixture.json'), `${JSON.stringify(evidence, null, 2)}\n`, { flag: 'wx' });
    process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);
  } catch (error) {
    const evidence = { schemaVersion: 1, status: 'BLOCKED', recording: summary, reason: error instanceof Error ? error.message : String(error), timestamp: new Date().toISOString() };
    await writeFile(path.join(root, 'recording-fixture.json'), `${JSON.stringify(evidence, null, 2)}\n`, { flag: 'wx' });
    process.stderr.write(`${JSON.stringify(evidence, null, 2)}\n`);
    process.exitCode = 2;
  }
}
