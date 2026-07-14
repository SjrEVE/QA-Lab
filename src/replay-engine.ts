import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { loadTimeline, type TimelineEvent } from './event-timeline.js';

export const replayModeSchema = z.enum(['same-session-fixture', 'transcript-action']);
export type ReplayMode = z.infer<typeof replayModeSchema>;

export interface ReplayStep { readonly sequence: number; readonly timestampMs: number; readonly source: string; readonly event: string; readonly action: Readonly<Record<string, unknown>> }
export interface ReplayResult { readonly schemaVersion: 1; readonly mode: ReplayMode; readonly scenarioId: string; readonly eventCount: number; readonly digest: string; readonly steps: readonly ReplayStep[]; readonly providerCalls: 0 }

export function resolveRunDirectory(artifactRoot: string, selector: string): string {
  if (path.isAbsolute(selector) || selector.includes('\\') || !/^[A-Za-z0-9._/-]+$/.test(selector)) throw new Error('Unsafe run selector.');
  const segments = selector.split('/');
  if (segments.length === 0 || segments.some((segment) => !segment || segment === '.' || segment === '..' || !/^[A-Za-z0-9._-]+$/.test(segment))) throw new Error('Unsafe run selector.');
  const root = path.resolve(artifactRoot);
  const target = path.resolve(root, ...segments);
  const relative = path.relative(root, target);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Run selector escaped artifact root.');
  return target;
}

function replayable(event: TimelineEvent, mode: ReplayMode): boolean {
  if (mode === 'same-session-fixture') return true;
  return event.source === 'student' || event.source === 'tutor' || event.source === 'whiteboard' || (event.source === 'browser' && ['click', 'type', 'wait', 'navigate'].includes(event.event));
}

export function replayEvents(events: readonly TimelineEvent[], mode: ReplayMode): ReplayResult {
  if (events.length === 0) throw new Error('Replay requires recorded events.');
  const scenarioId = events[0]?.scenarioId;
  if (!scenarioId || events.some((event) => event.scenarioId !== scenarioId)) throw new Error('Replay timeline has inconsistent scenarios.');
  const selected = events.filter((event) => replayable(event, mode));
  if (selected.length === 0) throw new Error('Replay timeline has no events for the requested mode.');
  const steps = selected.map(({ sequence, timestampMs, source, event, data }) => ({ sequence, timestampMs, source, event, action: data }));
  const digest = createHash('sha256').update(JSON.stringify({ mode, scenarioId, steps })).digest('hex');
  return { schemaVersion: 1, mode, scenarioId, eventCount: selected.length, digest, steps, providerCalls: 0 };
}

export async function replayRun(artifactRoot: string, runSelector: string, mode: ReplayMode): Promise<ReplayResult> {
  const runDirectory = resolveRunDirectory(artifactRoot, runSelector);
  const metadata = z.object({ schemaVersion: z.literal(1), scenarioId: z.string().min(1) }).passthrough().parse(JSON.parse(await readFile(path.join(runDirectory, 'run.json'), 'utf8')));
  const events = await loadTimeline(path.join(runDirectory, 'timeline.jsonl'));
  if (events.some((event) => event.scenarioId !== metadata.scenarioId)) throw new Error('Replay metadata does not match timeline scenario.');
  return replayEvents(events, replayModeSchema.parse(mode));
}
