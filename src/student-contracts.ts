import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';

export const PERSONA_SCHEMA_VERSION = 1 as const;
export const STUDENT_SCENARIO_VERSION = 1 as const;
const safeId = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'must be a lowercase kebab-case identifier');
const selector = z.string().trim().min(1).max(500);

export const studentPersonaSchema = z.object({
  version: z.literal(PERSONA_SCHEMA_VERSION),
  id: safeId,
  name: z.string().trim().min(1).max(120),
  grade: z.number().int().min(1).max(12),
  locale: z.literal('vi-VN'),
  starting_understanding: z.number().int().min(0).max(5),
  misconception: safeId,
  communication: z.object({ confidence: z.enum(['low', 'medium', 'high']), vocabulary: z.enum(['limited', 'age-appropriate']), response_style: z.enum(['short', 'hesitant', 'detailed']) }).strict(),
  behaviors: z.array(z.enum(['silence_once', 'off_topic_once', 'repeat_mistake_once', 'ask_for_example_once'])).min(1).max(8).refine((v) => new Set(v).size === v.length, 'behaviors must be unique'),
}).strict();
export type StudentPersona = z.infer<typeof studentPersonaSchema>;

export const studentScenarioSchema = z.object({
  version: z.literal(STUDENT_SCENARIO_VERSION), id: safeId, name: z.string().trim().min(1).max(120), type: z.literal('student-text'), persona: safeId,
  target: z.object({ path: z.string().startsWith('/').max(500), tutor_turn_selector: selector, text_input_selector: selector, send_selector: selector, whiteboard_selector: selector }).strict(),
  limits: z.object({ max_minutes: z.number().int().min(1).max(30), max_turns: z.number().int().min(8).max(30), max_brain_context_turns: z.number().int().min(3).max(5), max_issues: z.number().int().min(1).max(100), tutor_turn_timeout_ms: z.number().int().min(100).max(30_000) }).strict(),
  goals: z.array(z.enum(['misconception_detected', 'explanation_changes', 'independent_check', 'independent_success'])).min(1).max(8).refine((v) => new Set(v).size === v.length, 'goals must be unique'),
  checks: z.object({ minimum_turns: z.number().int().min(8).max(30), require_whiteboard_events: z.boolean(), require_explanation_change: z.boolean(), require_independent_check: z.boolean(), require_independent_success: z.boolean() }).strict(),
  scripted_responses: z.array(z.string().trim().min(1).max(500)).min(8).max(30),
}).strict();
export type StudentScenario = z.infer<typeof studentScenarioSchema>;

async function loadYaml<T>(filePath: string, schema: z.ZodType<T>): Promise<T> { return schema.parse(parseYaml(await readFile(filePath, 'utf8')) as unknown); }
export const loadStudentPersona = (filePath: string): Promise<StudentPersona> => loadYaml(filePath, studentPersonaSchema);
export const loadStudentScenario = (filePath: string): Promise<StudentScenario> => loadYaml(filePath, studentScenarioSchema);

async function listYaml<T>(directory: string, loader: (file: string) => Promise<T>, idOf: (item: T) => string): Promise<readonly T[]> {
  const files = (await readdir(path.resolve(directory))).filter((file) => file.endsWith('.yaml')).sort();
  const items = await Promise.all(files.map((file) => loader(path.join(path.resolve(directory), file)))); const ids = new Set<string>();
  for (const item of items) { const id = idOf(item); if (ids.has(id)) throw new Error(`Duplicate id: ${id}`); ids.add(id); }
  return items;
}
export const listStudentPersonas = (directory = 'personas'): Promise<readonly StudentPersona[]> => listYaml(directory, loadStudentPersona, (x) => x.id);
export const listStudentScenarios = (directory = 'scenarios/student'): Promise<readonly StudentScenario[]> => listYaml(directory, loadStudentScenario, (x) => x.id);
export async function findStudentPersona(id: string, directory = 'personas'): Promise<StudentPersona> { if (!safeId.safeParse(id).success) throw new Error('Unsafe persona id.'); const item = (await listStudentPersonas(directory)).find((x) => x.id === id); if (!item) throw new Error(`Unknown persona: ${id}`); return item; }
export async function findStudentScenario(id: string, directory = 'scenarios/student'): Promise<StudentScenario> { if (!safeId.safeParse(id).success) throw new Error('Unsafe scenario id.'); const item = (await listStudentScenarios(directory)).find((x) => x.id === id); if (!item) throw new Error(`Unknown student scenario: ${id}`); return item; }
