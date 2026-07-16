#!/usr/bin/env node
import path from 'node:path';
import { runConfiguredAuthenticatedCatalogQa } from './authenticated-catalog-qa.js';
import { runConfiguredAuthenticatedSessionStartQa } from './authenticated-session-qa.js';
import { runConfiguredGuidedSelfStudyQa } from './guided-self-study-qa.js';
import { runConfiguredAuthBootstrap } from './auth-bootstrap.js';
import { createConfiguredGeminiStudentBrain } from './gemini-student-brain.js';
import { startControlCenter } from './control-center.js';
import { loadConfig } from './config.js';
import { runDoctor } from './doctor.js';
import { runConfiguredFullWebQa } from './full-web-qa.js';
import { compareRuns } from './regression.js';
import { arenaObservationSchema, evaluateArena, loadArenaConfig, writeArenaReport } from './model-arena.js';
import { replayModeSchema, replayRun } from './replay-engine.js';
import { createRunId } from './run-store.js';
import { runConfiguredStagingReset } from './staging-reset.js';
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
      phase: 10,
      readiness: 'PHASE10_SAFETY_OPTIMIZER_FIXTURE_READY',
      productReadiness: 'GIA_SU_AI_GUIDED_SELF_STUDY_STAGING_ACCEPTED',
      environment: config.environment,
      configVersion: config.version,
      allowedStagingHosts: config.staging.allowedHosts,
      stagingTargetConfigured: Boolean(config.staging.baseUrl),
      artifactRoot: config.artifacts.root,
      stagingCapabilities: {
        publicWebSmoke: { implemented: true, locallyTested: true, stagingValidated: true, accepted: true },
        typedAuthenticatedProfile: { implemented: true, locallyTested: true, stagingValidated: true, accepted: true },
        verifiedAuthBootstrap: { implemented: true, locallyTested: true, stagingValidated: true, accepted: true },
        localControlCenter: { implemented: true, locallyTested: true, stagingValidated: false, accepted: false },
        authenticatedDashboardCatalog: { implemented: true, locallyTested: true, stagingValidated: true, accepted: true },
        strictReset: { implemented: true, locallyTested: true, stagingValidated: true, accepted: true },
        scriptedLessonJourney: { implemented: true, locallyTested: true, stagingValidated: false, accepted: false, blocker: 'latency-whiteboard-and-complete-student-journey-failed' },
        guidedSelfStudyJourney: { implemented: true, locallyTested: true, stagingValidated: true, accepted: true, acceptedPackages: ['g12-guided-self-study-integrals-v1', 'g12-guided-self-study-conditional-probability-v1'] },
      },
      capabilities: { browser: true, stagingAccepted: false, guidedSelfStudyStagingAccepted: true, webQa: true, studentTextQa: true, scriptedBrain: true, providerBrainAdapter: true, providerBrainAccepted: false, voiceBridge: true, nativeVoiceAccepted: false, voiceDefaultEnabled: voiceEnabled(), recording: true, recordingDefaultEnabled: false, screenshotTimeline: true, unifiedTimeline: true, educationEval: true, scriptedUxEvaluator: true, realUxEvaluator: false, replay: true, regressionComparison: true, providerReplayCalls: false, modelArena: true, cohorts: true, providerArenaCalls: false, safetyLab: true, scriptedSafetyOnly: true, optimizer: true, optimizerProposalOnly: true, providerConfigMutation: false, dashboard: false, deploy: false },
    });
    return 0;
  }
  if (command === 'doctor') {
    const report = await runDoctor();
    print(report);
    return report.ok ? 0 : 1;
  }
  if (command === 'full-web') {
    const result = await runConfiguredFullWebQa();
    print(result);
    return result.status === 'PASSED' ? 0 : 1;
  }
  if (command === 'auth') {
    const result = await runConfiguredAuthBootstrap();
    print(result);
    return result.status === 'VERIFIED' ? 0 : 1;
  }
  if (command === 'serve') {
    const config = await loadConfig();
    const server = await startControlCenter({ artifactRoot: config.artifacts.root });
    print({ service: 'TutorProof Control Center', url: server.url, note: 'Open this loopback URL. Ctrl+C stops the server.' });
    await new Promise<void>(() => undefined);
    return 0;
  }
  if (command === 'reset') {
    const scopeIndex = args.indexOf('--scope');
    const scope = scopeIndex >= 0 ? args[scopeIndex + 1] : undefined;
    if (!scope) throw new Error('qa:reset requires --scope <scenario-id>.');
    const result = await runConfiguredStagingReset(scope);
    print(result);
    return result.status === 'READY' ? 0 : 1;
  }
  if (command === 'catalog') {
    const scenarioIndex = args.indexOf('--scenario');
    const scenarioId = scenarioIndex >= 0 ? args[scenarioIndex + 1] : 'gia-su-ai-authenticated-catalog';
    if (!scenarioId) throw new Error('qa:catalog requires a valid scenario id.');
    const result = await runConfiguredAuthenticatedCatalogQa(scenarioId);
    print(result);
    return result.status === 'PASSED' ? 0 : 1;
  }
  if (command === 'session-start') {
    const scenarioIndex = args.indexOf('--scenario');
    const scenarioId = scenarioIndex >= 0 ? args[scenarioIndex + 1] : 'gia-su-ai-session-start';
    if (!scenarioId) throw new Error('qa:session:start requires a valid scenario id.');
    const result = await runConfiguredAuthenticatedSessionStartQa(scenarioId);
    print(result);
    return result.status === 'PASSED' ? 0 : 1;
  }
  if (command === 'self-study') {
    const scenarioIndex = args.indexOf('--scenario');
    const scenarioId = scenarioIndex >= 0 ? args[scenarioIndex + 1] : 'gia-su-ai-guided-self-study-integrals';
    if (!scenarioId) throw new Error('qa:self-study requires a valid scenario id.');
    const result = await runConfiguredGuidedSelfStudyQa(scenarioId);
    print(result);
    return result.status === 'PASSED' ? 0 : 1;
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
    const brainIndex = args.indexOf('--brain');
    const brainId = brainIndex >= 0 ? args[brainIndex + 1] : 'scripted';
    if (brainId !== 'scripted' && brainId !== 'gemini') throw new Error('qa:run --brain must be scripted or gemini.');
    const config = await loadConfig();
    const baseUrl = config.staging.baseUrl;
    const student = (await listStudentScenarios()).find((candidate) => candidate.id === scenarioId);
    const result = student
      ? await runStudentQa({ scenario: student, persona: await findStudentPersona(student.persona), brain: brainId === 'gemini' ? createConfiguredGeminiStudentBrain(process.env, undefined, 'text') : new ScriptedStudentBrain(), reset: new StubResetAdapter(), ...(baseUrl ? { baseUrl } : {}), artifactRoot: config.artifacts.root, runId: createRunId(), policy: { allowedHosts: config.staging.allowedHosts } })
      : await runWebQa({ scenario: await findWebScenario(scenarioId), ...(baseUrl ? { baseUrl } : {}), artifactRoot: config.artifacts.root, runId: createRunId(), policy: { allowedHosts: config.staging.allowedHosts } });
    print(result);
    return result.status === 'PASSED' ? 0 : 1;
  }
  if (command === 'arena') {
    const configIndex=args.indexOf('--config'); const observationsIndex=args.indexOf('--observations'); const outputIndex=args.indexOf('--output');
    const configPath=configIndex>=0?args[configIndex+1]:undefined; const observationsPath=observationsIndex>=0?args[observationsIndex+1]:undefined; const output=outputIndex>=0?args[outputIndex+1]:undefined;
    if(!configPath||!observationsPath||!output) throw new Error('qa:arena requires --config <yaml> --observations <json> --output <directory>.');
    const { readFile }=await import('node:fs/promises'); const observations=arenaObservationSchema.array().parse(JSON.parse(await readFile(observationsPath,'utf8')) as unknown); const report=evaluateArena(await loadArenaConfig(configPath),observations); await writeArenaReport(path.resolve(output),report); print(report); return 0;
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
  process.stderr.write('Usage: qa-lab <status|doctor|full-web|auth|serve|reset --scope <scenario-id>|catalog [--scenario <id>]|session-start [--scenario <id>]|self-study [--scenario <id>]|list|run --scenario <id> [--brain scripted|gemini]|arena --config <yaml> --observations <json> --output <directory>|compare --baseline <run> --candidate <run>|replay --run <run> [--mode <mode>]>\n');
  return 2;
}

main(process.argv.slice(2)).then((code) => { process.exitCode = code; }).catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
