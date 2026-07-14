import { createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { z } from 'zod';
import { redactSecrets, REDACTED } from './redaction.js';

const forbiddenChildData = /(?:child|student).*(?:name|email|phone|address)|raw(?:Audio|Image|Transcript)|dateOfBirth/i;
export const incidentPackageSchema = z.object({
  schemaVersion: z.literal(1),
  incidentId: z.string().min(1),
  scenarioId: z.string().min(1),
  category: z.string().min(1),
  route: z.string().default(''),
  element: z.string().default(''),
  normalizedError: z.string().min(1),
  decisions: z.array(z.object({ action: z.string().min(1), parameters: z.record(z.string(), z.unknown()).default({}) }).strict()).min(1),
  expected: z.string().min(1),
  evidenceRefs: z.array(z.string()).min(1),
  anonymized: z.literal(true),
}).strict();
export type IncidentRegressionPackage = z.infer<typeof incidentPackageSchema>;

function rejectRawChildData(value: unknown, pointer = '$'): void {
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (forbiddenChildData.test(key)) throw new Error(`Raw child data is forbidden at ${pointer}.${key}.`);
    rejectRawChildData(child, `${pointer}.${key}`);
  }
}

export function packageIncident(input: unknown): IncidentRegressionPackage & { readonly packageId: string } {
  rejectRawChildData(input);
  const parsed = incidentPackageSchema.parse(redactSecrets(input));
  const serialized = JSON.stringify(parsed);
  if (serialized.includes(REDACTED)) {
    // Redaction is acceptable and required; package remains safe but cannot preserve the original secret.
  }
  return { ...parsed, packageId: `REG-${createHash('sha256').update(serialized).digest('hex').slice(0, 16).toUpperCase()}` };
}

export async function writeIncidentPackage(filename: string, input: unknown): Promise<void> {
  const packaged = packageIncident(input);
  await writeFile(filename, `${JSON.stringify(packaged, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
}
