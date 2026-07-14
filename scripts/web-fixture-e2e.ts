import { rm } from 'node:fs/promises';
import path from 'node:path';
import { startFixtureSite } from '../test/fixture-site.js';
import { findWebScenario } from '../src/web-scenario.js';
import { runWebQa } from '../src/web-qa.js';

const runId = 'phase3-web-fixture-evidence';
await rm(path.resolve('runs', runId), { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
const site = await startFixtureSite();
try {
  const scenario = await findWebScenario('home-smoke');
  const result = await runWebQa({ scenario, baseUrl: site.origin, artifactRoot: 'runs', runId, policy: { allowedHosts: ['unused.invalid'], fixtureMode: true, fixturePort: site.port } });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  process.exitCode = result.status === 'BLOCKED' ? 1 : 0;
} finally { await site.close(); }
