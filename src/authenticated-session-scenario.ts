import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';

export const AUTHENTICATED_SESSION_SCENARIO_VERSION = 1 as const;
const safeId = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
const selector = z.string().trim().min(1).max(500)
  .refine((value) => value.includes('data-qa'), 'session selectors must use data-qa');
const lessonId = z.string().regex(/^[A-Za-z0-9._-]{2,128}$/);

export const authenticatedSessionScenarioSchema = z.object({
  version: z.literal(AUTHENTICATED_SESSION_SCENARIO_VERSION),
  id: safeId,
  name: z.string().trim().min(1).max(120),
  type: z.literal('authenticated-session-start'),
  target: z.object({ path: z.string().startsWith('/').max(500) }).strict(),
  reset: z.object({ scope: safeId }).strict(),
  lesson: z.object({
    id: lessonId,
    registryStatusAttribute: z.literal('data-registry-status'),
    approvedRegistryValue: z.literal('approved'),
  }).strict(),
  selectors: z.object({
    authenticatedShell: selector,
    accountTrigger: selector,
    accountIdentity: selector,
    lesson: selector,
    classroomReady: selector,
    start: selector,
    status: selector,
    error: selector,
    stop: selector,
  }).strict(),
  expected: z.object({
    activeStatuses: z.array(z.enum(['listening', 'user speaking', 'AI speaking'])).min(1).max(3),
    stoppedStatus: z.literal('disconnected'),
  }).strict(),
  limits: z.object({
    maxMinutes: z.number().int().min(1).max(10),
    selectorTimeoutMs: z.number().int().min(1_000).max(30_000),
    activeTimeoutMs: z.number().int().min(1_000).max(60_000),
    maxIssues: z.number().int().min(1).max(30),
  }).strict(),
}).strict();

export type AuthenticatedSessionScenario = z.infer<typeof authenticatedSessionScenarioSchema>;

export async function loadAuthenticatedSessionScenario(filename: string): Promise<AuthenticatedSessionScenario> {
  return authenticatedSessionScenarioSchema.parse(parseYaml(await readFile(filename, 'utf8')) as unknown);
}

export async function listAuthenticatedSessionScenarios(
  directory = 'scenarios/authenticated',
): Promise<readonly AuthenticatedSessionScenario[]> {
  const files = (await readdir(path.resolve(directory))).filter((file) => file.endsWith('.yaml')).sort();
  const candidates: AuthenticatedSessionScenario[] = [];
  for (const file of files) {
    const raw = parseYaml(await readFile(path.join(path.resolve(directory), file), 'utf8')) as { type?: unknown };
    if (raw?.type === 'authenticated-session-start') candidates.push(authenticatedSessionScenarioSchema.parse(raw));
  }
  const ids = new Set<string>();
  for (const scenario of candidates) {
    if (ids.has(scenario.id)) throw new Error(`Duplicate authenticated session scenario id: ${scenario.id}`);
    ids.add(scenario.id);
  }
  return candidates;
}

export async function findAuthenticatedSessionScenario(
  id: string,
  directory = 'scenarios/authenticated',
): Promise<AuthenticatedSessionScenario> {
  if (!safeId.safeParse(id).success) throw new Error('Unsafe authenticated session scenario id.');
  const scenario = (await listAuthenticatedSessionScenarios(directory)).find((candidate) => candidate.id === id);
  if (!scenario) throw new Error(`Unknown authenticated session scenario: ${id}`);
  return scenario;
}
