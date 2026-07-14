import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { webScenarioSchema } from '../src/web-scenario.js';
import { runWebQa } from '../src/web-qa.js';
import { startFixtureSite } from './fixture-site.js';

for (const [route, category] of [['/web-console-error','console'], ['/web-network-error','network'], ['/web-overflow','text_overflow'], ['/web-overlap','blocking_overlap']] as const) test(`captures ${category} fixture issue`, async () => { const site = await startFixtureSite(); const root = await mkdtemp(path.join(os.tmpdir(), 'qa-fail-')); try { const scenario = webScenarioSchema.parse({ version: 1, id: `failure-${category.replace('_','-')}`, name: 'Failure', type: 'web', target: { path: route }, viewports: ['mobile-common'], limits: { max_minutes: 1, max_steps: 3, max_screenshots: 3, max_issues: 5 }, flow: [{ action: 'open', path: route }], checks: { page_open: true, primary_actions_clickable: [], console_blockers: true, network_blockers: true, text_overflow: true, blocking_overlap: true } }); const result = await runWebQa({ scenario, baseUrl: site.origin, artifactRoot: root, runId: category, policy: { allowedHosts: ['unused.invalid'], fixtureMode: true, fixturePort: site.port } }); assert.equal(result.issues.some((x) => x.category === category), true); } finally { await site.close(); } });
