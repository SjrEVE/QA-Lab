#!/usr/bin/env node
import { loadConfig } from './config.js';
import { runDoctor } from './doctor.js';
import { compareRuns } from './regression.js';
import { replayModeSchema, replayRun } from './replay-engine.js';
import { createRunId } from './run-store.js';
import { ScriptedStudentBrain } from './student-brain.js';
import { findStudentPersona, listStudentScenarios } from './student-contracts.js';
import { runStudentQa, StubResetAdapter } from './student-qa.js';
import { voiceEnabled } from './voice-provider.js';
import { findWebScenario, listWebScenarios } from './web-scenario.js';
import { runWebQa } from './web-qa.js';

function print(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

async function main(args: readonly string[]): Promise<number> {
  const command = args[0] ?? 'status';
  if (command === 'status') {
    const config = await loadConfig();
    print({
      service: 'qa-lab',
      phase: 8,
      readiness: 'REPLAY_REGRESSION_FIXTURE_READY',
      environment: config.environment,
      configVersion: config.version,
      allowedStagingHosts: config.staging.allowedHosts,
      artifactRoot: config.artifacts.root,
      capabilities: { browser: true, stagingAccepted: false, webQa: true, studentTextQa: true, scriptedBrain: true, providerBrain: false, voiceBridge: true, nativeVoiceAccepted: false, voiceDefaultEnabled: voiceEnabled(), recording: true, recordingDefaultEnabled: false, screenshotTimeline: true, unifiedTimeline: true, educationEval: true, scriptedUxEvaluator: true, realUxEvaluator: false, replay: true, regressionComparison: true, providerReplayCalls: false, modelArena: false, cohorts: false, dashboard: false, deploy: false },
    });
    return 0;
  }
  if (command === 'doctor') {
    const report = await runDoctor();
    print(report);
    return report.ok ? 0 : 1;
  }
  if (command === 'list') {
    const [web, student] = await Promise.all([listWebScenarios(), listStudentScenarios()]);
    print([...web.map(({ id, name, version, viewports }) => ({ id, name, version, type: 'web', viewports })), ...student.map(({ id, name, version, persona }) => ({ id, name, version, type: 'student-text', persona }))]);
    return 0;
  }
  if (command === 'run') {
    const index = args.indexOf('--scenario');
    const scenarioId = index >= 0 ? args[index + 1] : undefined;
    if (!scenarioId) throw new Error('qa:run requires --scenario <id>.');
    const config = await loadConfig();
    const baseUrl = process.env.QA_STAGING_BASE_URL;
    const student = (await listStudentScenarios()).find((candidate) => candidate.id === scenarioId);
    const result = student
      ? await runStudentQa({ scenario: student, persona: await findStudentPersona(student.persona), brain: new ScriptedStudentBrain(), reset: new StubResetAdapter(), ...(baseUrl ? { baseUrl } : {}), artifactRoot: config.artifacts.root, runId: createRunId(), policy: { allowedHosts: config.staging.allowedHosts } })
      : await runWebQa({ scenario: await findWebScenario(scenarioId), ...(baseUrl ? { baseUrl } : {}), artifactRoot: config.artifacts.root, runId: createRunId(), policy: { allowedHosts: config.staging.allowedHosts } });
    print(result);
    return result.status === 'PASSED' ? 0 : 1;
  }
  if (command === 'compare') {
    const baselineIndex = args.indexOf('--baseline'); const candidateIndex = args.indexOf('--candidate');
    const baseline = baselineIndex >= 0 ? args[baselineIndex + 1] : undefined; const candidate = candidateIndex >= 0 ? args[candidateIndex + 1] : undefined;
    if (!baseline || !candidate) throw new Error('qa:compare requires --baseline <run> --candidate <run>.');
    const config = await loadConfig(); print(await compareRuns(config.artifacts.root, baseline, candidate)); return 0;
  }
  if (command === 'replay') {
    const runIndex = args.indexOf('--run'); const modeIndex = args.indexOf('--mode'); const run = runIndex >= 0 ? args[runIndex + 1] : undefined;
    if (!run) throw new Error('qa:replay requires --run <run>.');
    const mode = replayModeSchema.parse(modeIndex >= 0 ? args[modeIndex + 1] : 'same-session-fixture');
    const config = await loadConfig(); print(await replayRun(config.artifacts.root, run, mode)); return 0;
  }
  process.stderr.write('Usage: qa-lab <status|doctor|list|run --scenario <id>|compare --baseline <run> --candidate <run>|replay --run <run> [--mode <mode>]>\n');
  return 2;
}

main(process.argv.slice(2)).then((code) => { process.exitCode = code; }).catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
