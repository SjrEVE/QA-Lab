import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';

export const AUTHENTICATED_CATALOG_SCENARIO_VERSION = 1 as const;
const safeId = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
const selector = z.string().trim().min(1).max(500);
const selectorContract = z.object({
  primary: selector.refine((value) => value.includes('data-qa'), 'primary selector must use data-qa'),
  fallback: selector.optional(),
  name: z.string().trim().min(1).max(120),
}).strict();

export const authenticatedCatalogScenarioSchema = z.object({
  version: z.literal(AUTHENTICATED_CATALOG_SCENARIO_VERSION),
  id: safeId,
  name: z.string().trim().min(1).max(120),
  type: z.literal('authenticated-catalog'),
  target: z.object({ path: z.string().startsWith('/').max(500) }).strict(),
  viewports: z.array(z.enum(['mobile-common', 'laptop'])).min(1).max(2).refine((items) => new Set(items).size === items.length),
  selectors: z.object({
    authenticatedShell: selectorContract,
    accountIdentity: selectorContract,
    grade: selectorContract,
    subject: selectorContract,
    chapter: selectorContract,
    lesson: selectorContract,
    classroomReady: selectorContract,
    startLesson: selectorContract,
  }).strict(),
  lessonContract: z.object({
    lessonIdAttribute: z.literal('data-lesson-id'),
    registryStatusAttribute: z.literal('data-registry-status'),
    approvedRegistryValue: z.literal('approved'),
  }).strict(),
  limits: z.object({
    maxMinutes: z.number().int().min(1).max(15),
    selectorTimeoutMs: z.number().int().min(1_000).max(30_000),
    maxIssues: z.number().int().min(1).max(50),
  }).strict(),
}).strict();

export type AuthenticatedCatalogScenario = z.infer<typeof authenticatedCatalogScenarioSchema>;
export type CatalogSelectorContract = AuthenticatedCatalogScenario['selectors'][keyof AuthenticatedCatalogScenario['selectors']];

export async function loadAuthenticatedCatalogScenario(filename: string): Promise<AuthenticatedCatalogScenario> {
  return authenticatedCatalogScenarioSchema.parse(parseYaml(await readFile(filename, 'utf8')) as unknown);
}

export async function listAuthenticatedCatalogScenarios(
  directory = 'scenarios/authenticated',
): Promise<readonly AuthenticatedCatalogScenario[]> {
  const absolute = path.resolve(directory);
  const files = (await readdir(absolute)).filter((file) => file.endsWith('.yaml')).sort();
  const scenarios = await Promise.all(files.map((file) => loadAuthenticatedCatalogScenario(path.join(absolute, file))));
  const ids = new Set<string>();
  for (const scenario of scenarios) {
    if (ids.has(scenario.id)) throw new Error(`Duplicate authenticated catalog scenario id: ${scenario.id}`);
    ids.add(scenario.id);
  }
  return scenarios;
}

export async function findAuthenticatedCatalogScenario(
  id: string,
  directory = 'scenarios/authenticated',
): Promise<AuthenticatedCatalogScenario> {
  if (!safeId.safeParse(id).success) throw new Error('Unsafe authenticated catalog scenario id.');
  const scenario = (await listAuthenticatedCatalogScenarios(directory)).find((candidate) => candidate.id === id);
  if (!scenario) throw new Error(`Unknown authenticated catalog scenario: ${id}`);
  return scenario;
}
