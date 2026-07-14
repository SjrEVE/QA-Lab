#!/usr/bin/env node
import { loadConfig } from './config.js';
import { runDoctor } from './doctor.js';

function print(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

async function main(args: readonly string[]): Promise<number> {
  const command = args[0] ?? 'status';
  if (command === 'status') {
    const config = await loadConfig();
    print({
      service: 'qa-lab',
      phase: 2,
      readiness: 'BROWSER_FOUNDATION_READY',
      environment: config.environment,
      configVersion: config.version,
      allowedStagingHosts: config.staging.allowedHosts,
      artifactRoot: config.artifacts.root,
      capabilities: { browser: true, stagingAccepted: false, webQa: false, voice: false, recording: false, dashboard: false, deploy: false },
    });
    return 0;
  }
  if (command === 'doctor') {
    const report = await runDoctor();
    print(report);
    return report.ok ? 0 : 1;
  }
  process.stderr.write('Usage: qa-lab <status|doctor>\n');
  return 2;
}

main(process.argv.slice(2)).then((code) => { process.exitCode = code; }).catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
