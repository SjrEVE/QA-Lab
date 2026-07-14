import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';
import { measuredValueSchema } from './model-arena.js';

export const OPTIMIZER_CONFIG_VERSION = 1 as const;
export const OPTIMIZER_REPORT_VERSION = 1 as const;
export const COST_FORMULA_VERSION = 1 as const;
const id = z.string().regex(/^[a-z0-9]+(?:[.-][a-z0-9]+)*$/);
export const optimizerConfigSchema = z.object({
  schemaVersion: z.literal(OPTIMIZER_CONFIG_VERSION), id,
  constraints: z.object({ qualityScoreMinimum: z.number().min(0).max(100), p95LatencyMsMaximum: z.number().positive(), costPerSessionMaximum: z.number().nonnegative(), criticalFailuresMaximum: z.literal(0) }).strict(),
  costFormula: z.object({ version: z.literal(COST_FORMULA_VERSION), currency: z.string().min(3).max(3), sessionMinutes: z.number().positive(), assumptions: z.array(z.string().min(1)).min(1) }).strict(),
  routingProposals: z.array(z.object({ route: z.enum(['simple_turn', 'repeated_confusion', 'vision_board', 'verifier_final', 'degraded_text']), candidateId: id, rationale: z.string().min(1), limitation: z.string().min(1) }).strict()).min(1),
}).strict();
export type OptimizerConfig = z.infer<typeof optimizerConfigSchema>;
export const optimizerCandidateSchema = z.object({
  id, qualityScore: measuredValueSchema, p95LatencyMs: measuredValueSchema, costPerSession: measuredValueSchema, criticalFailures: z.number().int().nonnegative(), evidence: z.array(z.string().min(1)).min(1),
  costInputs: z.object({ inputUnits: z.number().nonnegative().nullable(), outputUnits: z.number().nonnegative().nullable(), audioMinutes: z.number().nonnegative().nullable(), inputRate: z.number().nonnegative().nullable(), outputRate: z.number().nonnegative().nullable(), audioMinuteRate: z.number().nonnegative().nullable() }).strict(),
}).strict();
export type OptimizerCandidate = z.infer<typeof optimizerCandidateSchema>;

export function calculateSessionCost(inputs: OptimizerCandidate['costInputs']) {
  const values = Object.values(inputs);
  if (values.some((value) => value === null)) return { value: null, measurement: 'unknown' as const, formulaVersion: COST_FORMULA_VERSION, formula: '(inputUnits * inputRate) + (outputUnits * outputRate) + (audioMinutes * audioMinuteRate)' };
  const value = inputs.inputUnits! * inputs.inputRate! + inputs.outputUnits! * inputs.outputRate! + inputs.audioMinutes! * inputs.audioMinuteRate!;
  return { value, measurement: 'estimated' as const, formulaVersion: COST_FORMULA_VERSION, formula: '(inputUnits * inputRate) + (outputUnits * outputRate) + (audioMinutes * audioMinuteRate)' };
}
function known(value: z.infer<typeof measuredValueSchema>): value is { value: number; measurement: 'observed' | 'estimated' } { return value.value !== null && value.measurement !== 'unknown'; }
function dominates(a: { quality: number; latency: number; cost: number }, b: { quality: number; latency: number; cost: number }): boolean { return a.quality >= b.quality && a.latency <= b.latency && a.cost <= b.cost && (a.quality > b.quality || a.latency < b.latency || a.cost < b.cost); }

export function optimizeCandidates(configRaw: OptimizerConfig, candidatesRaw: readonly OptimizerCandidate[]) {
  const config = optimizerConfigSchema.parse(configRaw); const candidates = candidatesRaw.map((candidate) => optimizerCandidateSchema.parse(candidate));
  const entries = candidates.map((candidate) => {
    const calculatedCost = calculateSessionCost(candidate.costInputs);
    const cost = known(candidate.costPerSession) ? candidate.costPerSession : calculatedCost;
    const unknownRequired = !known(candidate.qualityScore) || !known(candidate.p95LatencyMs) || !known(cost);
    const failures: string[] = [];
    if (!unknownRequired) { if (candidate.qualityScore.value! < config.constraints.qualityScoreMinimum) failures.push('quality'); if (candidate.p95LatencyMs.value! > config.constraints.p95LatencyMsMaximum) failures.push('latency'); if (cost.value > config.constraints.costPerSessionMaximum) failures.push('cost'); }
    if (candidate.criticalFailures > 0) failures.push('critical_failure');
    const status = unknownRequired ? 'NEEDS_REVIEW' as const : failures.length ? 'REJECTED' as const : 'ELIGIBLE' as const;
    return { candidateId: candidate.id, qualityScore: candidate.qualityScore, p95LatencyMs: candidate.p95LatencyMs, costPerSession: cost, criticalFailures: candidate.criticalFailures, status, constraintFailures: failures, pareto: false, rank: null as number | null, evidence: candidate.evidence };
  });
  const eligible = entries.filter((entry) => entry.status === 'ELIGIBLE');
  for (const entry of eligible) entry.pareto = !eligible.some((other) => other !== entry && dominates({ quality: other.qualityScore.value!, latency: other.p95LatencyMs.value!, cost: other.costPerSession.value! }, { quality: entry.qualityScore.value!, latency: entry.p95LatencyMs.value!, cost: entry.costPerSession.value! }));
  const frontier = eligible.filter((entry) => entry.pareto).sort((a, b) => a.costPerSession.value! - b.costPerSession.value! || b.qualityScore.value! - a.qualityScore.value! || a.p95LatencyMs.value! - b.p95LatencyMs.value! || a.candidateId.localeCompare(b.candidateId));
  let prior: typeof frontier[number] | undefined; let rank = 0; frontier.forEach((entry, index) => { if (!prior || entry.costPerSession.value !== prior.costPerSession.value || entry.qualityScore.value !== prior.qualityScore.value || entry.p95LatencyMs.value !== prior.p95LatencyMs.value) rank = index + 1; entry.rank = rank; prior = entry; });
  const ids = new Set(candidates.map((candidate) => candidate.id));
  const proposals = config.routingProposals.map((proposal) => ({ ...proposal, recommendationOnly: true, evidenceAvailable: ids.has(proposal.candidateId), limitation: proposal.limitation, mutationPerformed: false }));
  return { schemaVersion: OPTIMIZER_REPORT_VERSION, optimizerId: config.id, constraints: config.constraints, costFormula: config.costFormula, policy: 'Unknown required metrics are NEEDS_REVIEW and never zero; critical failures reject; Pareto maximizes quality and minimizes latency/cost; ties use stable ID.', entries, paretoFrontier: frontier.map((entry) => entry.candidateId), routingPolicyProposals: proposals, providerConfigMutated: false, deployed: false };
}
export async function loadOptimizerConfig(filePath: string): Promise<OptimizerConfig> { return optimizerConfigSchema.parse(parseYaml(await readFile(filePath, 'utf8')) as unknown); }
export async function writeOptimizerReport(outputDirectory: string, report: ReturnType<typeof optimizeCandidates>): Promise<void> {
  await mkdir(outputDirectory, { recursive: true }); const rows = report.entries.map((entry) => `| ${entry.rank ?? '-'} | ${entry.candidateId} | ${entry.status} | ${entry.qualityScore.value ?? 'unknown'} (${entry.qualityScore.measurement}) | ${entry.p95LatencyMs.value ?? 'unknown'} (${entry.p95LatencyMs.measurement}) | ${entry.costPerSession.value ?? 'unknown'} (${entry.costPerSession.measurement}) | ${entry.criticalFailures} | ${entry.pareto} |`).join('\n');
  const markdown = `# Cost–Quality–Latency Optimizer\n\nRecommendations are proposals only; no provider configuration mutation or deployment occurred.\n\nCost formula v${report.costFormula.version}: ${report.costFormula.assumptions.join('; ')}.\n\n| Rank | Candidate | Status | Quality | p95 ms | Cost/session | Critical | Pareto |\n|---:|---|---|---|---|---|---:|---:|\n${rows}\n`;
  await Promise.all([writeFile(path.join(outputDirectory, 'optimizer-report.json'), `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx' }), writeFile(path.join(outputDirectory, 'optimizer-report.md'), markdown, { flag: 'wx' })]);
}
