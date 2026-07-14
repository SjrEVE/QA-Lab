#!/usr/bin/env node
import { loadConfig } from './config.js';
import { runDoctor } from './doctor.js';
import { createRunId } from './run-store.js';
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
      phase: 3,
      readiness: 'WEB_QA_MVP_READY',
      environment: config.environment,
      configVersion: config.version,
      allowedStagingHosts: config.staging.allowedHosts,
      artifactRoot: config.artifacts.root,
      capabilities: { browser: true, stagingAccepted: false, webQa: true, voice: false, recording: false, dashboard: false, deploy: false },
    });
    return 0;
  }
  if (command === 'doctor') {
    const report = await runDoctor();
    print(report);
    return report.ok ? 0 : 1;
  }
  if (command === 'list') {
    print((await listWebScenarios()).map(({ id, name, version, viewports }) => ({ id, name, version, viewports })));
    return 0;
  }
  if (command === 'run') {
    const index = args.indexOf('--scenario');
    const scenarioId = index >= 0 ? args[index + 1] : undefined;
    if (!scenarioId) throw new Error('qa:run requires --scenario <id>.');
    const config = await loadConfig();
    const baseUrl = process.env.QA_STAGING_BASE_URL;
    const result = await runWebQa({ scenario: await findWebScenario(scenarioId), ...(baseUrl ? { baseUrl } : {}), artifactRoot: config.artifacts.root, runId: createRunId(), policy: { allowedHosts: config.staging.allowedHosts } });
    print(result);
    return result.status === 'PASSED' ? 0 : 1;
  }
  process.stderr.write('Usage: qa-lab <status|doctor|list|run --scenario <id>>\n');
  return 2;
}

main(process.argv.slice(2)).then((code) => { process.exitCode = code; }).catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
