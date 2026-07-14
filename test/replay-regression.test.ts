import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { loadTimeline, normalizeTimeline, TimelineWriter } from '../src/event-timeline.js';
import { packageIncident } from '../src/incident-regression.js';
import { compareIssues, compareMetrics, compareRuns, issueFingerprint } from '../src/regression.js';
import { replayEvents, resolveRunDirectory } from '../src/replay-engine.js';

const event = (timestampMs: number, source: 'tutor' | 'student' = 'tutor') => ({ timestampMs, source, event: `${source}_turn`, scenarioId: 'scenario', data: { text: 'safe' } });

test('timeline validates schema/version/order/corruption and redacts', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'qa-timeline-')); const file = path.join(root, 'timeline.jsonl'); const writer = new TimelineWriter(file);
  await writer.append({ ...event(1), data: { authorization: 'Bearer abc', nested: { password: 'secret' } } }); await writer.append(event(1, 'student')); await writer.close();
  const loaded = await loadTimeline(file); assert.equal(loaded.length, 2); assert.equal(loaded[0]?.data.authorization, '[REDACTED]');
  assert.throws(() => normalizeTimeline([event(2), event(1)]), /monotonic/);
  await writeFile(path.join(root, 'bad.jsonl'), '{bad}\n'); await assert.rejects(loadTimeline(path.join(root, 'bad.jsonl')), /corrupt JSON/);
  await writeFile(path.join(root, 'version.jsonl'), `${JSON.stringify({ schemaVersion: 2, sequence: 0, ...event(0) })}\n`); await assert.rejects(loadTimeline(path.join(root, 'version.jsonl')));
  await assert.rejects(loadTimeline(path.join(root, 'missing.jsonl')));
});

test('run selector prevents traversal and absolute paths', () => {
  assert.equal(resolveRunDirectory('runs', 'safe-run'), path.resolve('runs', 'safe-run'));
  assert.equal(resolveRunDirectory('runs', 'archive/safe-run'), path.resolve('runs', 'archive', 'safe-run'));
  for (const value of ['..', '../escape', 'archive/../escape', '/absolute', 'C:\\escape']) assert.throws(() => resolveRunDirectory('runs', value), /Unsafe/);
});

test('replay is deterministic, supports modes, and never calls providers', () => {
  const events = normalizeTimeline([event(0), { timestampMs: 2, source: 'browser', event: 'console', scenarioId: 'scenario', data: {} }, event(3, 'student')]);
  const a = replayEvents(events, 'same-session-fixture'); const b = replayEvents(events, 'same-session-fixture'); const transcript = replayEvents(events, 'transcript-action');
  assert.equal(a.digest, b.digest); assert.equal(a.providerCalls, 0); assert.equal(transcript.eventCount, 2);
  assert.throws(() => replayEvents([], 'same-session-fixture'), /requires recorded/);
});

test('fingerprint normalizes volatile errors and issue lifecycle/dedup is explicit', () => {
  const base = { category: 'runtime', route: '/lesson', element: '#app', actual: 'Timeout 5000 at https://one.test/a', scenarioId: 's', evidence: ['old'] };
  const same = { ...base, actual: 'timeout 9000 at https://two.test/b', evidence: ['new'] };
  assert.equal(issueFingerprint(base), issueFingerprint(same));
  const deltas = compareIssues([base, base, { ...base, category: 'old' }], [same, { ...base, category: 'new' }]);
  assert.deepEqual(deltas.map((x) => x.lifecycle).sort(), ['NEW', 'PERSISTING', 'RESOLVED']);
  const flaky = compareIssues([{ ...base, status: 'FLAKY' }], [same]); assert.equal(flaky[0]?.lifecycle, 'FLAKY');
  const regressed = compareIssues([{ ...base, status: 'RESOLVED' }], [same]); assert.equal(regressed[0]?.lifecycle, 'REGRESSED');
  assert.ok(deltas.every((x) => x.evidence.length > 0));
});

test('metric delta applies threshold and observed/estimated quality', () => {
  const metrics = compareMetrics({ latency: { value: 100, measurement: 'observed' }, ux: { score: 4, measurement: 'estimated' } }, { latency: { value: 130, measurement: 'observed' }, ux: { score: 3, measurement: 'estimated' } }, { latency: { threshold: 20, direction: 'lower-better' }, 'ux.score': { threshold: 0.5, direction: 'higher-better' } });
  assert.equal(metrics.find((x) => x.metric === 'latency')?.regressed, true); assert.equal(metrics.find((x) => x.metric === 'ux.score')?.quality, 'estimated');
});

test('comparison writes regression JSON, summary, and Markdown artifacts', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'qa-compare-'));
  for (const id of ['base', 'candidate']) { const dir = path.join(root, id); await mkdir(dir); await writeFile(path.join(dir, 'run.json'), JSON.stringify({ schemaVersion: 1, runId: id, scenarioId: 's' })); await writeFile(path.join(dir, 'issues.json'), JSON.stringify({ schemaVersion: 1, issues: id === 'base' ? [] : [{ category: 'runtime', actual: 'boom', evidence: ['log'] }] })); await writeFile(path.join(dir, 'metrics.json'), JSON.stringify({ schemaVersion: 1, duration: id === 'base' ? 1 : 2 })); }
  const output = path.join(root, 'out'); const result = await compareRuns(root, 'base', 'candidate', output); assert.equal(result.summary.NEW, 1);
  for (const name of ['regression.json', 'regression-summary.json', 'regression-delta.md']) assert.ok((await readFile(path.join(output, name), 'utf8')).length > 0);
});

test('incident packaging redacts secrets and rejects raw child data', () => {
  const safe = packageIncident({ schemaVersion: 1, incidentId: 'i', scenarioId: 's', category: 'runtime', normalizedError: 'token=abc failed', decisions: [{ action: 'click', parameters: {} }], expected: 'works', evidenceRefs: ['timeline#1'], anonymized: true });
  assert.match(safe.normalizedError, /REDACTED/); assert.match(safe.packageId, /^REG-/);
  assert.throws(() => packageIncident({ schemaVersion: 1, incidentId: 'i', scenarioId: 's', category: 'x', normalizedError: 'x', decisions: [{ action: 'x', parameters: {} }], expected: 'x', evidenceRefs: ['x'], anonymized: true, childName: 'real' }), /Raw child data/);
});
