import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { TimelineWriter } from '../src/event-timeline.js';
import { compareRuns } from '../src/regression.js';
import { replayRun } from '../src/replay-engine.js';

if (!process.argv.includes('--fixture-mode')) throw new Error('Regression fixture requires explicit --fixture-mode.');
const root = path.resolve('runs', 'phase8-regression-fixture-evidence');
await rm(root, { recursive: true, force: true }); await mkdir(root, { recursive: true });

async function run(id: string, issues: unknown[], durationMs: number): Promise<void> {
  const directory = path.join(root, id); await mkdir(directory);
  await writeFile(path.join(directory, 'run.json'), `${JSON.stringify({ schemaVersion: 1, runId: id, scenarioId: 'fixture-fractions', runner: 'student', status: 'PASSED' }, null, 2)}\n`);
  await writeFile(path.join(directory, 'issues.json'), `${JSON.stringify({ schemaVersion: 1, issues }, null, 2)}\n`);
  await writeFile(path.join(directory, 'metrics.json'), `${JSON.stringify({ schemaVersion: 1, durationMs: { value: durationMs, measurement: 'observed' }, uxScores: { clarity: 4, measurement: 'estimated' } }, null, 2)}\n`);
  const timeline = new TimelineWriter(path.join(directory, 'timeline.jsonl'));
  await timeline.append({ timestampMs: 0, source: 'checkpoint', event: 'session_start', scenarioId: 'fixture-fractions', data: { fixture: true } });
  await timeline.append({ timestampMs: 10, source: 'tutor', event: 'tutor_turn_final', scenarioId: 'fixture-fractions', turn: 1, data: { text: 'Con hãy so sánh tử số.' } });
  await timeline.append({ timestampMs: 20, source: 'student', event: 'student_decision', scenarioId: 'fixture-fractions', turn: 1, data: { action: 'type', text: 'Con thử lại.' } });
  await timeline.close();
}
const persistent = { category: 'teaching_clarity', actual: 'Tutor repeated explanation 3 times', scenarioId: 'fixture-fractions', route: '/lesson', element: '#tutor', evidence: ['timeline.jsonl#2'] };
await run('baseline', [persistent, { category: 'runtime', actual: 'Timeout 5000 ms', scenarioId: 'fixture-fractions', route: '/lesson', evidence: ['baseline.log'] }], 100);
await run('candidate', [persistent, { category: 'whiteboard', actual: 'Board delayed 1800 ms', scenarioId: 'fixture-fractions', route: '/lesson', evidence: ['candidate.log'] }], 130);
const comparison = await compareRuns(root, 'baseline', 'candidate', path.join(root, 'comparison'), { 'durationMs': { threshold: 20, direction: 'lower-better' } });
const replayA = await replayRun(root, 'baseline', 'same-session-fixture'); const replayB = await replayRun(root, 'baseline', 'same-session-fixture');
if (replayA.digest !== replayB.digest || replayA.providerCalls !== 0) throw new Error('Deterministic replay fixture failed.');
await writeFile(path.join(root, 'replay-evidence.json'), `${JSON.stringify({ schemaVersion: 1, deterministic: true, digest: replayA.digest, providerCalls: 0, eventCount: replayA.eventCount }, null, 2)}\n`);
process.stdout.write(`${JSON.stringify({ status: 'PASSED', root, comparison: comparison.summary, replayDigest: replayA.digest }, null, 2)}\n`);
