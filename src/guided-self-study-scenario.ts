import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';

export const GUIDED_SELF_STUDY_SCENARIO_VERSION = 1 as const;
export const GUIDED_SELF_STUDY_VIEWPORTS = Object.freeze({
  'mobile-common': { width: 390, height: 844 },
  tablet: { width: 768, height: 1024 },
  desktop: { width: 1440, height: 900 },
});

const safeId = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
const lessonId = z.string().regex(/^[A-Za-z0-9._-]{2,128}$/);
const selector = z.string().trim().min(1).max(500).refine((value) => value.includes('data-qa'), 'guided self-study selectors must use data-qa');
const answer = z.object({ exerciseId: lessonId, value: z.string().trim().min(1).max(100), incorrectValue: z.string().trim().min(1).max(100).optional() }).strict();

export const guidedSelfStudyScenarioSchema = z.object({
  version: z.literal(GUIDED_SELF_STUDY_SCENARIO_VERSION),
  id: safeId,
  name: z.string().trim().min(1).max(120),
  type: z.literal('authenticated-guided-self-study'),
  target: z.object({ path: z.literal('/app/learn') }).strict(),
  reset: z.object({ scope: safeId }).strict(),
  package: z.object({
    lessonId,
    learningMode: z.enum(['textbook', 'foundation_recovery', 'review']),
    packageId: safeId,
    fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  }).strict(),
  viewports: z.array(z.enum(['mobile-common', 'tablet', 'desktop'])).length(3)
    .refine((items) => new Set(items).size === items.length, 'guided self-study viewports must be unique'),
  selectors: z.object({
    authenticatedShell: selector,
    accountTrigger: selector,
    accountIdentity: selector,
    player: selector,
    start: selector,
    answer: selector,
    submit: selector,
    verification: selector,
    hintRequest: selector,
    hint: selector,
    remediationEnter: selector,
    remediationReturn: selector,
    next: selector,
    learnContinue: selector,
    verifyComplete: selector,
    summary: selector,
  }).strict(),
  answers: z.array(answer).min(1).max(12)
    .refine((items) => new Set(items.map((item) => item.exerciseId)).size === items.length, 'exercise answers must be unique')
    .refine((items) => Boolean(items[0]?.incorrectValue), 'the diagnostic answer must include a bounded incorrect value for remediation QA'),
  limits: z.object({
    maxMinutes: z.number().int().min(1).max(20),
    selectorTimeoutMs: z.number().int().min(1_000).max(30_000),
    transitionTimeoutMs: z.number().int().min(1_000).max(30_000),
    maxIssues: z.number().int().min(1).max(30),
  }).strict(),
}).strict();

export type GuidedSelfStudyScenario = z.infer<typeof guidedSelfStudyScenarioSchema>;

export async function loadGuidedSelfStudyScenario(filename: string): Promise<GuidedSelfStudyScenario> {
  return guidedSelfStudyScenarioSchema.parse(parseYaml(await readFile(filename, 'utf8')) as unknown);
}

export async function listGuidedSelfStudyScenarios(directory = 'scenarios/authenticated'): Promise<readonly GuidedSelfStudyScenario[]> {
  const files = (await readdir(path.resolve(directory))).filter((file) => file.endsWith('.yaml')).sort();
  const scenarios: GuidedSelfStudyScenario[] = [];
  for (const file of files) {
    const raw = parseYaml(await readFile(path.join(path.resolve(directory), file), 'utf8')) as { type?: unknown };
    if (raw?.type === 'authenticated-guided-self-study') scenarios.push(guidedSelfStudyScenarioSchema.parse(raw));
  }
  if (new Set(scenarios.map((scenario) => scenario.id)).size !== scenarios.length) throw new Error('Duplicate guided self-study scenario id.');
  return scenarios;
}

export async function findGuidedSelfStudyScenario(id: string, directory = 'scenarios/authenticated'): Promise<GuidedSelfStudyScenario> {
  if (!safeId.safeParse(id).success) throw new Error('Unsafe guided self-study scenario id.');
  const scenario = (await listGuidedSelfStudyScenarios(directory)).find((candidate) => candidate.id === id);
  if (!scenario) throw new Error(`Unknown guided self-study scenario: ${id}`);
  return scenario;
}
