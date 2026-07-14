import { open, readFile } from 'node:fs/promises';
import { z } from 'zod';
import { redactSecrets } from './redaction.js';

export const TIMELINE_SCHEMA_VERSION = 1 as const;
export const timelineSourceSchema = z.enum(['browser', 'tutor', 'student', 'whiteboard', 'evaluation', 'checkpoint']);
export const timelineEventSchema = z.object({
  schemaVersion: z.literal(TIMELINE_SCHEMA_VERSION),
  sequence: z.number().int().nonnegative(),
  timestampMs: z.number().int().nonnegative(),
  source: timelineSourceSchema,
  event: z.string().min(1).max(100),
  scenarioId: z.string().min(1),
  route: z.string().optional(),
  turn: z.number().int().positive().optional(),
  data: z.record(z.string(), z.unknown()),
}).strict();
export type TimelineEvent = z.infer<typeof timelineEventSchema>;
export type TimelineEventInput = Omit<TimelineEvent, 'schemaVersion' | 'sequence' | 'data'> & { readonly data?: Readonly<Record<string, unknown>> };

export function validateTimeline(events: readonly unknown[]): TimelineEvent[] {
  let previousTimestamp = -1;
  return events.map((raw, index) => {
    const event = timelineEventSchema.parse(raw);
    if (event.sequence !== index) throw new Error(`Timeline sequence mismatch at index ${index}.`);
    if (event.timestampMs < previousTimestamp) throw new Error(`Timeline timestamp is not monotonic at sequence ${event.sequence}.`);
    previousTimestamp = event.timestampMs;
    return event;
  });
}

export async function loadTimeline(filename: string): Promise<TimelineEvent[]> {
  const text = await readFile(filename, 'utf8');
  if (!text.trim()) throw new Error('Timeline is missing or empty.');
  const rows = text.trimEnd().split(/\r?\n/).map((line, index) => {
    try { return JSON.parse(line) as unknown; } catch { throw new Error(`Timeline contains corrupt JSON at line ${index + 1}.`); }
  });
  return validateTimeline(rows);
}

export class TimelineWriter {
  private sequence = 0;
  private previousTimestamp = -1;
  private readonly handlePromise;

  public constructor(filename: string) { this.handlePromise = open(filename, 'wx'); }

  public async append(input: TimelineEventInput): Promise<TimelineEvent> {
    if (input.timestampMs < this.previousTimestamp) throw new Error('Timeline timestamp must be monotonic.');
    const redacted = redactSecrets(input.data ?? {});
    const event = timelineEventSchema.parse({ ...input, schemaVersion: TIMELINE_SCHEMA_VERSION, sequence: this.sequence, data: redacted });
    const handle = await this.handlePromise;
    await handle.appendFile(`${JSON.stringify(event)}\n`, 'utf8');
    this.sequence += 1;
    this.previousTimestamp = event.timestampMs;
    return event;
  }

  public async close(): Promise<void> { const handle = await this.handlePromise; await handle.close(); }
}

export function normalizeTimeline(inputs: readonly TimelineEventInput[]): TimelineEvent[] {
  return validateTimeline(inputs.map((input, sequence) => timelineEventSchema.parse({ ...input, schemaVersion: TIMELINE_SCHEMA_VERSION, sequence, data: redactSecrets(input.data ?? {}) })));
}
