import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { webScenarioSchema } from '../src/web-scenario.js';
import { runWebQa } from '../src/web-qa.js';
import { startFixtureSite } from './fixture-site.js';

for (const [route, category] of [['/web-console-error','console'], ['/web-network-error','network'], ['/web-overflow','text_overflow'], ['/web-overlap','blocking_overlap']] as const) test(`captures ${category} fixture issue`, async () => { const site = await startFixtureSite(); const root = await mkdtemp(path.join(os.tmpdir(), 'qa-fail-')); try { const scenario = webScenarioSchema.parse({ version: 1, id: `failure-${category.replace('_','-')}`, name: 'Failure', type: 'web', target: { path: route }, viewports: ['mobile-common'], limits: { max_minutes: 1, max_steps: 3, max_screenshots: 3, max_issues: 5 }, flow: [{ action: 'open', path: route }], checks: { page_open: true, primary_actions_clickable: [], console_blockers: true, network_blockers: true, text_overflow: true, blocking_overlap: true } }); const result = await runWebQa({ scenario, baseUrl: site.origin, artifactRoot: root, runId: category, policy: { allowedHosts: ['unused.invalid'], fixtureMode: true, fixturePort: site.port } }); assert.equal(result.issues.some((x) => x.category === category), true); } finally { await site.close(); } });

test('expect_visible waits for bounded asynchronous UI initialization', async () => {
  const site = await startFixtureSite(); const root = await mkdtemp(path.join(os.tmpdir(), 'qa-wait-'));
  try {
    const scenario = webScenarioSchema.parse({ version: 1, id: 'delayed-visible', name: 'Delayed visible', type: 'web', target: { path: '/web-delayed-visible' }, viewports: ['mobile-common'], limits: { max_minutes: 1, max_steps: 3, max_screenshots: 3, max_issues: 5 }, flow: [{ action: 'open', path: '/web-delayed-visible' }, { action: 'expect_visible', selector: '[data-qa=delayed]', name: 'Delayed control' }], checks: { page_open: true, primary_actions_clickable: [], console_blockers: true, network_blockers: true, text_overflow: true, blocking_overlap: true } });
    const result = await runWebQa({ scenario, baseUrl: site.origin, artifactRoot: root, runId: 'delayed', policy: { allowedHosts: ['unused.invalid'], fixtureMode: true, fixturePort: site.port } });
    assert.equal(result.status, 'PASSED'); assert.equal(result.checks.find((check) => check.check === 'visible:Delayed control')?.passed, true);
  } finally { await site.close(); }
});

test('expect_url waits for a bounded asynchronous route guard', async () => {
  const site = await startFixtureSite(); const root = await mkdtemp(path.join(os.tmpdir(), 'qa-url-wait-'));
  try {
    const scenario = webScenarioSchema.parse({ version: 1, id: 'delayed-route', name: 'Delayed route', type: 'web', target: { path: '/web-delayed-route' }, viewports: ['mobile-common'], limits: { max_minutes: 1, max_steps: 3, max_screenshots: 3, max_issues: 5 }, flow: [{ action: 'open', path: '/web-delayed-route' }, { action: 'expect_url', path: '/login' }], checks: { page_open: true, primary_actions_clickable: [], console_blockers: true, network_blockers: true, text_overflow: true, blocking_overlap: true } });
    const result = await runWebQa({ scenario, baseUrl: site.origin, artifactRoot: root, runId: 'url-wait', policy: { allowedHosts: ['unused.invalid'], fixtureMode: true, fixturePort: site.port } });
    assert.equal(result.status, 'PASSED'); assert.equal(result.checks.find((check) => check.check === 'url:/login')?.passed, true);
  } finally { await site.close(); }
});

test('identical browser events produce one evidence-backed issue', async () => {
  const site = await startFixtureSite(); const root = await mkdtemp(path.join(os.tmpdir(), 'qa-dedupe-'));
  try {
    const scenario = webScenarioSchema.parse({ version: 1, id: 'duplicate-console', name: 'Duplicate console', type: 'web', target: { path: '/web-duplicate-console' }, viewports: ['mobile-common'], limits: { max_minutes: 1, max_steps: 2, max_screenshots: 2, max_issues: 5 }, flow: [{ action: 'open', path: '/web-duplicate-console' }], checks: { page_open: true, primary_actions_clickable: [], console_blockers: true, network_blockers: true, text_overflow: true, blocking_overlap: true } });
    const result = await runWebQa({ scenario, baseUrl: site.origin, artifactRoot: root, runId: 'dedupe', policy: { allowedHosts: ['unused.invalid'], fixtureMode: true, fixturePort: site.port } });
    assert.equal(result.issues.filter((issue) => issue.category === 'console').length, 1);
  } finally { await site.close(); }
});
