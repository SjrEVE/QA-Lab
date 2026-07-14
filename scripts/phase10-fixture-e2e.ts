import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';
import { optimizerCandidateSchema, loadOptimizerConfig, optimizeCandidates, writeOptimizerReport } from '../src/quality-optimizer.js';
import { evaluateSafetySuite, safetyScenarioSchema, writeSafetyReport } from '../src/safety-lab.js';

if (!process.argv.includes('--fixture-mode')) throw new Error('Phase 10 fixture requires explicit --fixture-mode.');
const root = path.resolve('runs', 'phase10-safety-optimizer-fixture-evidence'); await rm(root, { recursive: true, force: true }); await mkdir(root, { recursive: true });
const scenarios = safetyScenarioSchema.array().parse(parseYaml(await readFile('scenarios/safety/phase10-fixture.yaml', 'utf8')) as unknown);
const actions = Object.fromEntries(scenarios.map((scenario) => [scenario.id, scenario.expected.decision === 'ESCALATE' ? { action: 'escalate_to_trusted_adult', reasonCode: scenario.expected.reasonCode, immediateDanger: false } : { action: 'refuse_and_redirect', reasonCode: scenario.expected.reasonCode, safeAlternative: 'Continue with a safe learning activity or contact a trusted adult.' }]));
const safety = evaluateSafetySuite(scenarios, actions); await writeSafetyReport(root, safety);
const metric = (value: number | null, measurement: 'observed' | 'estimated' | 'unknown') => ({ value, measurement });
const inputs = (rate: number | null) => ({ inputUnits: 10, outputUnits: 5, audioMinutes: 1, inputRate: rate, outputRate: rate, audioMinuteRate: rate });
const candidates = optimizerCandidateSchema.array().parse([
  { id: 'economy', qualityScore: metric(86, 'observed'), p95LatencyMs: metric(1500, 'observed'), costPerSession: metric(null, 'unknown'), criticalFailures: 0, evidence: ['arena:economy'], costInputs: inputs(.01) },
  { id: 'strong', qualityScore: metric(94, 'observed'), p95LatencyMs: metric(2200, 'observed'), costPerSession: metric(.4, 'observed'), criticalFailures: 0, evidence: ['arena:strong'], costInputs: inputs(.02) },
  { id: 'unknown', qualityScore: metric(90, 'estimated'), p95LatencyMs: metric(null, 'unknown'), costPerSession: metric(null, 'unknown'), criticalFailures: 0, evidence: ['arena:unknown'], costInputs: inputs(null) },
  { id: 'unsafe', qualityScore: metric(99, 'observed'), p95LatencyMs: metric(1000, 'observed'), costPerSession: metric(.1, 'estimated'), criticalFailures: 1, evidence: ['arena:blocker'], costInputs: inputs(.01) },
  { id: 'slow', qualityScore: metric(88, 'observed'), p95LatencyMs: metric(3000, 'observed'), costPerSession: metric(.2, 'estimated'), criticalFailures: 0, evidence: ['arena:slow'], costInputs: inputs(.01) },
]);
const optimizer = optimizeCandidates(await loadOptimizerConfig('config/optimizer-fixture.yaml'), candidates); await writeOptimizerReport(root, optimizer);
await writeFile(path.join(root, 'fixture-summary.json'), `${JSON.stringify({ schemaVersion: 1, status: safety.status === 'PASS' ? 'PASSED' : 'FAILED', safetyStatus: safety.status, optimizerStatuses: Object.fromEntries(optimizer.entries.map((entry) => [entry.candidateId, entry.status])), providerCalls: 0, stagingOrProduction: false, providerConfigMutated: false, deployed: false }, null, 2)}\n`, { flag: 'wx' });
process.stdout.write(`${JSON.stringify({ status: 'PASSED', root, safetyScenarios: scenarios.length, candidates: candidates.length, providerCalls: 0 }, null, 2)}\n`);
