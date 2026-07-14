import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { redactSecrets } from './redaction.js';
import { resolveRunDirectory } from './replay-engine.js';

export const lifecycleSchema = z.enum(['NEW', 'PERSISTING', 'RESOLVED', 'REGRESSED', 'FLAKY']);
export type IssueLifecycle = z.infer<typeof lifecycleSchema>;
const issueSchema = z.object({ category: z.string(), title: z.string().optional(), actual: z.string().default(''), evidence: z.array(z.string()).default([]), scenarioId: z.string().optional(), route: z.string().optional(), url: z.string().optional(), element: z.string().optional(), status: z.string().optional() }).passthrough();
export interface ComparableIssue { readonly category: string; readonly title?: string; readonly actual: string; readonly evidence: readonly string[]; readonly scenarioId?: string; readonly route?: string; readonly url?: string; readonly element?: string; readonly status?: string; readonly [key: string]: unknown }
export interface IssueDelta { readonly fingerprint: string; readonly lifecycle: IssueLifecycle; readonly baseline: ComparableIssue | null; readonly candidate: ComparableIssue | null; readonly evidence: readonly string[] }
export interface MetricDelta { readonly metric: string; readonly baseline: number; readonly candidate: number; readonly delta: number; readonly threshold: number; readonly direction: 'higher-better' | 'lower-better'; readonly quality: 'observed' | 'estimated'; readonly regressed: boolean }
export interface RegressionReport { readonly schemaVersion: 1; readonly baselineRun: string; readonly candidateRun: string; readonly issues: readonly IssueDelta[]; readonly metrics: readonly MetricDelta[]; readonly summary: Readonly<Record<IssueLifecycle, number>> }
export interface MetricThreshold { readonly threshold: number; readonly direction: 'higher-better' | 'lower-better' }

export function normalizeError(value: string): string {
  return value.toLowerCase().replace(/https?:\/\/[^\s]+/g, '<url>').replace(/\b\d+(?:\.\d+)?\b/g, '<n>').replace(/[a-f0-9]{8,}/g, '<id>').replace(/\s+/g, ' ').trim();
}
export function issueFingerprint(issue: ComparableIssue, fallbackScenario = ''): string {
  const route = issue.route ?? (issue.url ? (() => { try { return new URL(issue.url).pathname; } catch { return issue.url; } })() : '');
  const element = issue.element ?? '';
  const scenario = issue.scenarioId ?? fallbackScenario;
  return createHash('sha256').update([issue.category, route, element, normalizeError(issue.actual || issue.title || ''), scenario].join('|')).digest('hex');
}

function dedupe(issues: readonly ComparableIssue[], scenario: string): Map<string, ComparableIssue> {
  const output = new Map<string, ComparableIssue>();
  for (const issue of issues) { const fingerprint = issueFingerprint(issue, scenario); if (!output.has(fingerprint)) output.set(fingerprint, issue); }
  return output;
}
function isFlaky(issue: ComparableIssue): boolean { return issue.status === 'FLAKY' || issue.flaky === true; }

export function compareIssues(baseline: readonly ComparableIssue[], candidate: readonly ComparableIssue[], baselineScenario = '', candidateScenario = baselineScenario): IssueDelta[] {
  const before = dedupe(baseline, baselineScenario); const after = dedupe(candidate, candidateScenario); const fingerprints = [...new Set([...before.keys(), ...after.keys()])].sort();
  return fingerprints.map((fingerprint) => {
    const b = before.get(fingerprint) ?? null; const c = after.get(fingerprint) ?? null;
    const lifecycle: IssueLifecycle = (b && isFlaky(b)) || (c && isFlaky(c)) ? 'FLAKY' : b && c ? (b.status === 'RESOLVED' ? 'REGRESSED' : 'PERSISTING') : b ? 'RESOLVED' : c?.status === 'RESOLVED' ? 'REGRESSED' : 'NEW';
    return { fingerprint, lifecycle, baseline: b, candidate: c, evidence: [...new Set([...(b?.evidence ?? []).map((x) => `baseline:${x}`), ...(c?.evidence ?? []).map((x) => `candidate:${x}`)])] };
  });
}

function flattenMetrics(value: unknown, prefix = '', quality: 'observed' | 'estimated' = 'observed', output = new Map<string, { value: number; quality: 'observed' | 'estimated' }>()): Map<string, { value: number; quality: 'observed' | 'estimated' }> {
  if (typeof value === 'number' && prefix) output.set(prefix, { value, quality });
  else if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>; const nextQuality = record.measurement === 'estimated' ? 'estimated' : quality;
    if (typeof record.value === 'number' && prefix) output.set(prefix, { value: record.value, quality: nextQuality });
    else for (const [key, child] of Object.entries(record)) if (!['schemaVersion', 'measurement', 'limitations'].includes(key)) flattenMetrics(child, prefix ? `${prefix}.${key}` : key, nextQuality, output);
  }
  return output;
}
export function compareMetrics(baseline: unknown, candidate: unknown, thresholds: Readonly<Record<string, MetricThreshold>> = {}): MetricDelta[] {
  const before = flattenMetrics(baseline); const after = flattenMetrics(candidate); const shared = [...before.keys()].filter((key) => after.has(key)).sort();
  return shared.map((metric) => { const b = before.get(metric)!; const c = after.get(metric)!; const policy = thresholds[metric] ?? { threshold: 0, direction: 'lower-better' as const }; const delta = c.value - b.value; const regressed = policy.direction === 'lower-better' ? delta > policy.threshold : delta < -policy.threshold; return { metric, baseline: b.value, candidate: c.value, delta, threshold: policy.threshold, direction: policy.direction, quality: b.quality === 'estimated' || c.quality === 'estimated' ? 'estimated' : 'observed', regressed }; });
}

async function loadRun(root: string, selector: string): Promise<{ directory: string; runId: string; scenarioId: string; issues: ComparableIssue[]; metrics: unknown }> {
  const directory = resolveRunDirectory(root, selector);
  const run = z.object({ runId: z.string(), scenarioId: z.string() }).passthrough().parse(JSON.parse(await readFile(path.join(directory, 'run.json'), 'utf8')));
  const issueFile = z.object({ schemaVersion: z.literal(1), issues: z.array(issueSchema) }).parse(JSON.parse(await readFile(path.join(directory, 'issues.json'), 'utf8')));
  return { directory, runId: run.runId, scenarioId: run.scenarioId, issues: issueFile.issues as ComparableIssue[], metrics: JSON.parse(await readFile(path.join(directory, 'metrics.json'), 'utf8')) as unknown };
}
export async function compareRuns(artifactRoot: string, baselineSelector: string, candidateSelector: string, outputDirectory?: string, thresholds: Readonly<Record<string, MetricThreshold>> = {}): Promise<RegressionReport> {
  const [baseline, candidate] = await Promise.all([loadRun(artifactRoot, baselineSelector), loadRun(artifactRoot, candidateSelector)]);
  const issues = compareIssues(baseline.issues, candidate.issues, baseline.scenarioId, candidate.scenarioId); const metrics = compareMetrics(baseline.metrics, candidate.metrics, thresholds);
  const summary = Object.fromEntries(lifecycleSchema.options.map((status) => [status, issues.filter((issue) => issue.lifecycle === status).length])) as Record<IssueLifecycle, number>;
  const report: RegressionReport = { schemaVersion: 1, baselineRun: baseline.runId, candidateRun: candidate.runId, issues, metrics, summary };
  const destination = outputDirectory ? path.resolve(outputDirectory) : candidate.directory; await mkdir(destination, { recursive: true });
  const markdown = `# QA Lab Regression Delta\n\n- Baseline: \`${baseline.runId}\`\n- Candidate: \`${candidate.runId}\`\n- NEW: ${summary.NEW}; PERSISTING: ${summary.PERSISTING}; RESOLVED: ${summary.RESOLVED}; REGRESSED: ${summary.REGRESSED}; FLAKY: ${summary.FLAKY}\n\n## Issues\n${issues.map((x) => `- **${x.lifecycle}** \`${x.fingerprint.slice(0, 12)}\` — ${x.evidence.join(', ') || 'explicit absence in one run'}`).join('\n') || '- None'}\n\n## Metric deltas\n${metrics.map((x) => `- ${x.metric}: ${x.baseline} → ${x.candidate} (Δ ${x.delta}; threshold ${x.threshold}; ${x.quality}; ${x.regressed ? 'REGRESSED' : 'OK'})`).join('\n') || '- None'}\n`;
  await Promise.all([writeFile(path.join(destination, 'regression.json'), `${JSON.stringify(redactSecrets(report), null, 2)}\n`, { flag: 'wx' }), writeFile(path.join(destination, 'regression-summary.json'), `${JSON.stringify({ schemaVersion: 1, baselineRun: baseline.runId, candidateRun: candidate.runId, summary, regressedMetrics: metrics.filter((x) => x.regressed).length }, null, 2)}\n`, { flag: 'wx' }), writeFile(path.join(destination, 'regression-delta.md'), markdown, { flag: 'wx' })]);
  return report;
}
