import { startFixtureSite } from '../test/fixture-site.js';
import { findWebScenario } from '../src/web-scenario.js';
import { runWebQa } from '../src/web-qa.js';

const site = await startFixtureSite();
try {
  const scenario = await findWebScenario('home-smoke');
  const result = await runWebQa({ scenario, baseUrl: site.origin, artifactRoot: 'runs', runId: 'phase3-web-fixture-evidence', policy: { allowedHosts: ['unused.invalid'], fixtureMode: true, fixturePort: site.port } });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  process.exitCode = result.status === 'BLOCKED' ? 1 : 0;
} finally { await site.close(); }
