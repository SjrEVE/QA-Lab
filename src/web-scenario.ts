import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';

export const WEB_SCENARIO_VERSION = 1 as const;
export const WEB_VIEWPORTS = {
  'mobile-common': { width: 390, height: 844 },
  laptop: { width: 1366, height: 768 },
} as const;

const safeId = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'must be a lowercase kebab-case identifier');
const selector = z.string().trim().min(1).max(500);

export const webScenarioSchema = z.object({
  version: z.literal(WEB_SCENARIO_VERSION),
  id: safeId,
  name: z.string().trim().min(1).max(120),
  type: z.literal('web'),
  target: z.object({ path: z.string().startsWith('/').max(500) }).strict(),
  viewports: z.array(z.enum(['mobile-common', 'laptop'])).min(1).max(2).refine((items) => new Set(items).size === items.length, 'viewports must be unique'),
  limits: z.object({
    max_minutes: z.number().int().min(1).max(30),
    max_steps: z.number().int().min(1).max(50),
    max_screenshots: z.number().int().min(1).max(50),
    max_issues: z.number().int().min(1).max(100),
  }).strict(),
  flow: z.array(z.discriminatedUnion('action', [
    z.object({ action: z.literal('open'), path: z.string().startsWith('/').max(500) }).strict(),
    z.object({ action: z.literal('click'), selector, name: z.string().trim().min(1).max(120) }).strict(),
    z.object({ action: z.literal('fill'), selector, value: z.string().max(500), sensitive: z.boolean().default(false) }).strict(),
    z.object({ action: z.literal('expect_url'), path: z.string().startsWith('/').max(500) }).strict(),
    z.object({ action: z.literal('expect_visible'), selector, name: z.string().trim().min(1).max(120) }).strict(),
  ])).min(1).max(50),
  checks: z.object({
    page_open: z.boolean(),
    primary_actions_clickable: z.array(z.object({ selector, name: z.string().trim().min(1).max(120) }).strict()).max(20),
    console_blockers: z.boolean(),
    network_blockers: z.boolean(),
    text_overflow: z.boolean(),
    blocking_overlap: z.boolean(),
  }).strict(),
}).strict();

export type WebScenario = z.infer<typeof webScenarioSchema>;

export async function loadWebScenario(filePath: string): Promise<WebScenario> {
  const parsed = parseYaml(await readFile(filePath, 'utf8')) as unknown;
  return webScenarioSchema.parse(parsed);
}

export async function listWebScenarios(directory = 'scenarios/web'): Promise<readonly WebScenario[]> {
  const absolute = path.resolve(directory);
  const files = (await readdir(absolute)).filter((file) => file.endsWith('.yaml')).sort();
  const scenarios = await Promise.all(files.map((file) => loadWebScenario(path.join(absolute, file))));
  const ids = new Set<string>();
  for (const scenario of scenarios) {
    if (ids.has(scenario.id)) throw new Error(`Duplicate web scenario id: ${scenario.id}`);
    ids.add(scenario.id);
  }
  return scenarios;
}

export async function findWebScenario(id: string, directory = 'scenarios/web'): Promise<WebScenario> {
  if (!safeId.safeParse(id).success) throw new Error('Unsafe scenario id.');
  const scenarios = await listWebScenarios(directory);
  const scenario = scenarios.find((candidate) => candidate.id === id);
  if (!scenario) throw new Error(`Unknown web scenario: ${id}`);
  return scenario;
}
