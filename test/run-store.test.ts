import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createRun, createRunId, writeArtifact } from '../src/run-store.js';

test('creates deterministic safe run IDs', () => {
  assert.equal(createRunId(new Date('2026-07-14T10:00:00.000Z'), 'A1B2C3D4'), '20260714T100000Z-a1b2c3d4');
  assert.throws(() => createRunId(new Date(), '../bad'));
});

test('creates run status and exclusive artifacts', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'qa-runs-'));
  const runId = '20260714T100000Z-a1b2c3d4';
  const record = await createRun(root, runId);
  assert.equal(record.status, 'CREATED');
  const status = JSON.parse(await readFile(path.join(root, runId, 'status.json'), 'utf8')) as { runId: string };
  assert.equal(status.runId, runId);
  await writeArtifact(root, runId, 'summary.json', '{}\n');
  await assert.rejects(writeArtifact(root, runId, 'summary.json', 'overwrite'));
  await assert.rejects(createRun(root, runId));
});

test('rejects traversal in run and artifact names', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'qa-runs-'));
  await assert.rejects(createRun(root, '../escape'));
  await createRun(root, 'safe-run');
  await assert.rejects(writeArtifact(root, 'safe-run', '../escape.txt', 'x'));
  await assert.rejects(writeArtifact(root, '../escape', 'x.txt', 'x'));
});
