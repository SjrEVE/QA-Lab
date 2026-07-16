import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { runConfiguredAuthenticatedCatalogQa } from './authenticated-catalog-qa.js';
import { runConfiguredAuthenticatedSessionStartQa } from './authenticated-session-qa.js';
import { runConfiguredAuthBootstrap } from './auth-bootstrap.js';
import { loadConfig } from './config.js';
import { runConfiguredGuidedSelfStudyQa } from './guided-self-study-qa.js';
import { createRunId } from './run-store.js';
import { loadStagingProfile } from './staging-profile.js';
import { findWebScenario } from './web-scenario.js';
import { runWebQa } from './web-qa.js';

export type FullWebModulePhase = 'fast-gate' | 'journey';
export type FullWebModuleStatus = 'PASSED' | 'FAILED' | 'BLOCKED' | 'SKIPPED';
export type FullWebQaStatus = 'PASSED' | 'FAILED' | 'BLOCKED';

export interface FullWebModuleResult {
  readonly id: string;
  readonly phase: FullWebModulePhase;
  readonly status: FullWebModuleStatus;
  readonly durationMs: number;
  readonly runId: string | null;
  readonly artifactDirectory: string | null;
  readonly reason: string;
}

export interface FullWebModule {
  readonly id: string;
  readonly phase: FullWebModulePhase;
  run(): Promise<{ readonly status: Exclude<FullWebModuleStatus, 'SKIPPED'>; readonly runId?: string; readonly artifactDirectory?: string; readonly reason?: string }>;
}

export interface FullWebQaResult {
  readonly schemaVersion: 1;
  readonly suiteRunId: string;
  readonly status: FullWebQaStatus;
  readonly targetHost: string;
  readonly startedAt: string;
  readonly endedAt: string;
  readonly modules: readonly FullWebModuleResult[];
  readonly artifactDirectory: string;
}

export interface ConfiguredFullWebQaOptions {
  readonly cwd?: string;
  readonly env?: NodeJS.ProcessEnv;
  readonly loadEnvFile?: boolean;
  readonly suiteRunId?: string;
}

function safeRunId(value: string): string {
  if (!/^[A-Za-z0-9._-]+$/.test(value) || value === '.' || value === '..') throw new Error('Unsafe full-web run id.');
  return value;
}

function finalStatus(results: readonly FullWebModuleResult[]): FullWebQaStatus {
  if (results.some((result) => result.status === 'FAILED')) return 'FAILED';
  if (results.some((result) => result.status === 'BLOCKED' || result.status === 'SKIPPED')) return 'BLOCKED';
  return 'PASSED';
}

export async function executeFullWebModules(modules: readonly FullWebModule[]): Promise<{ readonly status: FullWebQaStatus; readonly modules: readonly FullWebModuleResult[] }> {
  const results: FullWebModuleResult[] = [];
  let gateStopped = false;
  for (const module of modules) {
    if (gateStopped) {
      results.push({ id: module.id, phase: module.phase, status: 'SKIPPED', durationMs: 0, runId: null, artifactDirectory: null, reason: 'Skipped because an earlier module did not pass.' });
      continue;
    }
    const started = Date.now();
    try {
      const result = await module.run();
      results.push({
        id: module.id,
        phase: module.phase,
        status: result.status,
        durationMs: Date.now() - started,
        runId: result.runId ?? null,
        artifactDirectory: result.artifactDirectory ?? null,
        reason: result.reason ?? result.status,
      });
      if (module.phase === 'fast-gate' && result.status !== 'PASSED') gateStopped = true;
    } catch {
      results.push({ id: module.id, phase: module.phase, status: 'FAILED', durationMs: Date.now() - started, runId: null, artifactDirectory: null, reason: 'Module failed safely; inspect its scoped artifact when available.' });
      if (module.phase === 'fast-gate') gateStopped = true;
    }
  }
  return { status: finalStatus(results), modules: results };
}

export async function runConfiguredFullWebQa(options: ConfiguredFullWebQaOptions = {}): Promise<FullWebQaResult> {
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const env = options.env ?? process.env;
  const config = await loadConfig({ cwd, env, ...(options.loadEnvFile === undefined ? {} : { loadEnvFile: options.loadEnvFile }) });
  const profile = await loadStagingProfile({ config, cwd, env });
  const suiteRunId = safeRunId(options.suiteRunId ?? `${createRunId()}-full-web`);
  const artifactRoot = path.resolve(cwd, config.artifacts.root);
  const artifactDirectory = path.join(artifactRoot, suiteRunId);
  await mkdir(artifactDirectory, { recursive: false });
  const startedAt = new Date();
  let sequence = 0;
  const nextRunId = (): string => `${suiteRunId}-m${String(++sequence).padStart(2, '0')}`;
  const modules: FullWebModule[] = [];

  for (const scenarioId of profile.suites.publicWebScenarioIds) {
    modules.push({
      id: scenarioId,
      phase: 'fast-gate',
      run: async () => {
        const runId = nextRunId();
        const scenario = await findWebScenario(scenarioId, path.join(cwd, 'scenarios', 'web'));
        const result = await runWebQa({
          scenario,
          ...(config.staging.baseUrl ? { baseUrl: config.staging.baseUrl } : {}),
          artifactRoot,
          runId,
          policy: { allowedHosts: [...new Set([...config.staging.allowedHosts, ...profile.auth.allowedHosts])] },
        });
        return { status: result.status, runId: result.runId, artifactDirectory: result.artifactDirectory, reason: `${result.checks.filter((check) => check.passed).length}/${result.checks.length} checks passed` };
      },
    });
  }

  modules.push({
    id: 'gia-su-ai-auth-persistence',
    phase: 'fast-gate',
    run: async () => {
      const result = await runConfiguredAuthBootstrap({ cwd, env, loadEnvFile: false });
      return { status: result.status === 'VERIFIED' ? 'PASSED' as const : 'BLOCKED' as const, reason: result.reason };
    },
  });

  for (const scenarioId of profile.suites.authenticatedWebScenarioIds) {
    modules.push({
      id: scenarioId,
      phase: 'fast-gate',
      run: async () => {
        const result = await runConfiguredAuthenticatedCatalogQa(scenarioId, { cwd, env, loadEnvFile: false, runId: nextRunId() });
        return { status: result.status, runId: result.runId, artifactDirectory: result.artifactDirectory, reason: `${result.checks.filter((check) => check.passed).length}/${result.checks.length} checks passed` };
      },
    });
  }

  for (const scenarioId of profile.suites.journeyIds) {
    modules.push({
      id: scenarioId,
      phase: 'journey',
      run: async () => {
        const runId = nextRunId();
        if (scenarioId === 'gia-su-ai-session-start') {
          const result = await runConfiguredAuthenticatedSessionStartQa(scenarioId, { cwd, env, loadEnvFile: false, runId });
          return { status: result.status, runId: result.runId, artifactDirectory: result.artifactDirectory, reason: `${result.checks.filter((check) => check.passed).length}/${result.checks.length} checks passed` };
        }
        if (scenarioId.startsWith('gia-su-ai-guided-self-study-')) {
          const result = await runConfiguredGuidedSelfStudyQa(scenarioId, { cwd, env, loadEnvFile: false, runId });
          return { status: result.status, runId: result.runId, artifactDirectory: result.artifactDirectory, reason: `${result.checks.filter((check) => check.passed).length}/${result.checks.length} checks passed` };
        }
        return { status: 'BLOCKED' as const, runId, reason: 'The staging profile references an unsupported journey type.' };
      },
    });
  }

  const executed = await executeFullWebModules(modules);
  const result: FullWebQaResult = {
    schemaVersion: 1,
    suiteRunId,
    status: executed.status,
    targetHost: profile.target.expectedHost,
    startedAt: startedAt.toISOString(),
    endedAt: new Date().toISOString(),
    modules: executed.modules,
    artifactDirectory,
  };
  await writeFile(path.join(artifactDirectory, 'summary.json'), `${JSON.stringify(result, null, 2)}\n`, { flag: 'wx' });
  const report = `# Full Web QA — ${profile.name}\n\n- Status: **${result.status}**\n- Target: \`${result.targetHost}\`\n- Production access: **forbidden**\n\n## Modules\n\n${result.modules.map((item) => `- **${item.status}** \`${item.id}\` (${item.durationMs} ms) — ${item.reason}`).join('\n')}\n`;
  await writeFile(path.join(artifactDirectory, 'report.md'), report, { flag: 'wx' });
  return result;
}
