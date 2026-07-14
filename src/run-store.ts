import { randomBytes } from 'node:crypto';
import { mkdir, open, writeFile } from 'node:fs/promises';
import path from 'node:path';

export const RUN_STATUSES = ['CREATED', 'RUNNING', 'COMPLETED', 'FAILED', 'BLOCKED', 'TIMED_OUT', 'APP_CRASHED'] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];

export interface RunRecord {
  readonly schemaVersion: 1;
  readonly runId: string;
  readonly status: RunStatus;
  readonly createdAt: string;
}

export function createRunId(now = new Date(), entropy = randomBytes(4).toString('hex')): string {
  const stamp = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  if (!/^[a-f0-9]{8}$/i.test(entropy)) throw new Error('Run ID entropy must be eight hexadecimal characters.');
  return `${stamp}-${entropy.toLowerCase()}`;
}

function safeChild(root: string, child: string): string {
  if (!/^[A-Za-z0-9._-]+$/.test(child) || child === '.' || child === '..') throw new Error('Unsafe path segment.');
  const absoluteRoot = path.resolve(root);
  const target = path.resolve(absoluteRoot, child);
  if (path.dirname(target) !== absoluteRoot) throw new Error('Artifact path escaped its root.');
  return target;
}

export async function createRun(root: string, runId = createRunId()): Promise<RunRecord> {
  await mkdir(path.resolve(root), { recursive: true });
  const runDirectory = safeChild(root, runId);
  await mkdir(runDirectory, { recursive: false });
  const record: RunRecord = { schemaVersion: 1, runId, status: 'CREATED', createdAt: new Date().toISOString() };
  const handle = await open(path.join(runDirectory, 'status.json'), 'wx');
  try { await handle.writeFile(`${JSON.stringify(record, null, 2)}\n`, 'utf8'); } finally { await handle.close(); }
  return record;
}

export async function writeArtifact(root: string, runId: string, filename: string, content: string): Promise<string> {
  const runDirectory = safeChild(root, runId);
  const target = safeChild(runDirectory, filename);
  await writeFile(target, content, { encoding: 'utf8', flag: 'wx' });
  return target;
}
