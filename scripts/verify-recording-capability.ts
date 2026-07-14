import { spawn } from 'node:child_process';
import { access, readFile } from 'node:fs/promises';
import path from 'node:path';

type RecordingEvidence = { status?: unknown };

const root = path.resolve('runs', 'phase5-recording-fixture-evidence');
const child = spawn(process.execPath, ['--import', 'tsx', 'scripts/recording-fixture-e2e.ts', '--fixture-mode'], { stdio: 'inherit' });
const exitCode = await new Promise<number | null>((resolve, reject) => { child.once('error', reject); child.once('exit', resolve); });

let evidence: RecordingEvidence;
try { evidence = JSON.parse(await readFile(path.join(root, 'recording-fixture.json'), 'utf8')) as RecordingEvidence; }
catch (error) { throw new Error(`Recording fixture did not produce valid evidence: ${error instanceof Error ? error.message : String(error)}`); }

const videoExists = await access(path.join(root, 'session.mp4')).then(() => true, () => false);
if (exitCode === 0 && evidence.status === 'PASSED' && videoExists) {
  process.stdout.write('Recording capability PASSED with a real session.mp4.\n');
} else if (exitCode === 2 && evidence.status === 'BLOCKED' && !videoExists) {
  process.stdout.write('Recording capability is truthfully BLOCKED; no fake session.mp4 exists.\n');
} else {
  throw new Error(`Unexpected recording contract: exit=${String(exitCode)}, status=${String(evidence.status)}, session.mp4=${String(videoExists)}`);
}
