import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';

export const ARENA_CONFIG_VERSION = 1 as const;
export const ARENA_REPORT_VERSION = 1 as const;
const id = z.string().regex(/^[a-z0-9]+(?:[.-][a-z0-9]+)*$/);
const identitySchema = z.object({ name: id, version: z.string().min(1), configuration: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])) }).strict();
export const arenaConfigSchema = z.object({
  schemaVersion: z.literal(ARENA_CONFIG_VERSION), id, seed: z.number().int().nonnegative(), repeats: z.number().int().min(2).max(20), scenarioId: id, personaCohortId: id, personaCohortVersion: z.number().int().positive(), rubricId: id, rubricVersion: z.number().int().positive(), buildId: z.string().min(1),
  configurations: z.array(z.object({ id, brain: identitySchema, evaluator: identitySchema }).strict()).min(2).max(10).refine((items) => new Set(items.map((x) => x.id)).size === items.length, 'configuration ids must be unique').refine((items) => items.every((x) => !(x.brain.name === x.evaluator.name && x.brain.version === x.evaluator.version)), 'brain and sole evaluator must be separated'),
}).strict();
export type ArenaConfig = z.infer<typeof arenaConfigSchema>;
export type Measurement = 'observed' | 'estimated' | 'unknown';
export const measuredValueSchema = z.object({ value: z.number().nullable(), measurement: z.enum(['observed', 'estimated', 'unknown']) }).strict().refine((x) => x.measurement === 'unknown' ? x.value === null : x.value !== null, 'unknown must be null and known measurements need a value');
export const arenaObservationSchema = z.object({ configurationId: id, repeat: z.number().int().nonnegative(), seed: z.number().int().nonnegative(), qualityScore: z.number().min(0).max(100), hardBlockers: z.number().int().nonnegative(), reliability: z.number().min(0).max(1), latencyMs: measuredValueSchema, cost: measuredValueSchema, evidenceVersion: z.string().min(1) }).strict();
export type ArenaObservation = z.infer<typeof arenaObservationSchema>;

const canonical = (value: unknown): string => JSON.stringify(value, Object.keys(value as object).sort());
export function configurationHash(value: unknown): string { return createHash('sha256').update(canonical(value)).digest('hex'); }
export async function loadArenaConfig(filePath: string): Promise<ArenaConfig> { return arenaConfigSchema.parse(parseYaml(await readFile(filePath, 'utf8')) as unknown); }
const mean = (xs: readonly number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length;
const variance = (xs: readonly number[]): number => { const avg = mean(xs); return mean(xs.map((x) => (x - avg) ** 2)); };
function measuredMean(items: readonly z.infer<typeof measuredValueSchema>[]) { const known = items.filter((x) => x.value !== null); if (!known.length) return { value: null, measurement: 'unknown' as const }; return { value: mean(known.map((x) => x.value!)), measurement: known.some((x) => x.measurement === 'estimated') ? 'estimated' as const : 'observed' as const }; }

export function evaluateArena(configRaw: ArenaConfig, observationsRaw: readonly ArenaObservation[]) {
  const config = arenaConfigSchema.parse(configRaw); const observations = observationsRaw.map((x) => arenaObservationSchema.parse(x));
  const expected = config.configurations.length * config.repeats; if (observations.length !== expected) throw new Error(`Arena requires exactly ${expected} observations.`);
  const evidenceVersions = new Set(observations.map((x) => x.evidenceVersion)); const comparable = evidenceVersions.size === 1 && observations.every((x) => x.seed === config.seed);
  const entries = config.configurations.map((candidate) => { const runs = observations.filter((x) => x.configurationId === candidate.id); if (runs.length !== config.repeats || new Set(runs.map((x) => x.repeat)).size !== config.repeats) throw new Error(`Incomplete repeats for ${candidate.id}.`); const scores = runs.map((x) => x.qualityScore); return { configurationId: candidate.id, configurationHash: configurationHash(candidate), qualityScore: mean(scores), consistencyVariance: variance(scores), reliability: mean(runs.map((x) => x.reliability)), hardBlockers: runs.reduce((sum, x) => sum + x.hardBlockers, 0), latencyMs: measuredMean(runs.map((x) => x.latencyMs)), cost: measuredMean(runs.map((x) => x.cost)), eligible: false, rank: null as number | null }; });
  const eligible = entries.filter((x) => comparable && x.hardBlockers === 0).sort((a, b) => b.qualityScore - a.qualityScore || b.reliability - a.reliability || a.consistencyVariance - b.consistencyVariance || a.configurationId.localeCompare(b.configurationId));
  let rank = 0; let prior: typeof eligible[number] | undefined; eligible.forEach((entry, index) => { entry.eligible = true; if (!prior || entry.qualityScore !== prior.qualityScore || entry.reliability !== prior.reliability || entry.consistencyVariance !== prior.consistencyVariance) rank = index + 1; entry.rank = rank; prior = entry; });
  return { schemaVersion: ARENA_REPORT_VERSION, arenaId: config.id, seed: config.seed, comparable, comparabilityReason: comparable ? 'Same scenario, cohort, seed, rubric, build, and evidence version.' : 'Evidence version or seed mismatch.', policy: 'Deterministic quality, reliability, variance, then stable-id ranking; hard blockers excluded; unknown cost is never treated as zero.', marketingBenchmark: false, entries } as const;
}
export async function writeArenaReport(outputDirectory: string, report: ReturnType<typeof evaluateArena>): Promise<void> { await mkdir(outputDirectory, { recursive: true }); const json = `${JSON.stringify(report, null, 2)}\n`; const rows = report.entries.map((x) => `| ${x.rank ?? 'excluded'} | ${x.configurationId} | ${x.qualityScore.toFixed(2)} | ${x.hardBlockers} | ${x.reliability.toFixed(3)} | ${x.consistencyVariance.toFixed(3)} | ${x.latencyMs.value ?? 'unknown'} (${x.latencyMs.measurement}) | ${x.cost.value ?? 'unknown'} (${x.cost.measurement}) |`).join('\n'); const markdown = `# Model Arena ${report.arenaId}\n\nComparable: **${report.comparable}** — ${report.comparabilityReason}\n\nThis is internal fixture evidence, not a marketing benchmark.\n\n| Rank | Configuration | Quality | Blockers | Reliability | Variance | Latency ms | Cost |\n|---:|---|---:|---:|---:|---:|---|---|\n${rows}\n`;
  await Promise.all([writeFile(path.join(outputDirectory, 'arena.json'), json, { flag: 'wx' }), writeFile(path.join(outputDirectory, 'report.md'), markdown, { flag: 'wx' })]); }
