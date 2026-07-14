import { access, mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { PlaywrightFfmpegRecorder } from '../src/recorder.js';

const root = path.resolve('runs', 'ci-recording-capability-evidence');
await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
await mkdir(root, { recursive: false });

const recorder = new PlaywrightFfmpegRecorder();
const summary = await recorder.prepare({ artifactDirectory: root, enabled: true, release: true });
const videoExists = await access(path.join(root, 'session.mp4')).then(() => true, () => false);
const evidence = {
  schemaVersion: 1,
  status: summary.state === 'blocked' && !videoExists ? 'BLOCKED' : 'INVALID',
  recording: summary,
  sessionMp4Exists: videoExists,
  timestamp: new Date().toISOString(),
};

await writeFile(path.join(root, 'recording-capability.json'), `${JSON.stringify(evidence, null, 2)}\n`, { flag: 'wx' });

if (evidence.status !== 'BLOCKED') {
  throw new Error(`Unexpected deterministic recording contract: state=${summary.state}, session.mp4=${String(videoExists)}`);
}

process.stdout.write('Recording capability is truthfully BLOCKED; no fake session.mp4 exists.\n');
