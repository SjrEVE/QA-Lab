import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { findWebScenario, loadWebScenario, WEB_VIEWPORTS, webScenarioSchema } from '../src/web-scenario.js';

const valid = { version: 1, id: 'home-smoke', name: 'Home', type: 'web', target: { path: '/' }, viewports: ['mobile-common', 'laptop'], limits: { max_minutes: 3, max_steps: 10, max_screenshots: 5, max_issues: 5 }, flow: [{ action: 'open', path: '/' }], checks: { page_open: true, primary_actions_clickable: [], console_blockers: true, network_blockers: true, text_overflow: true, blocking_overlap: true } };

test('web scenario contract accepts exactly the two MVP viewports', () => { assert.equal(webScenarioSchema.parse(valid).id, 'home-smoke'); assert.deepEqual(WEB_VIEWPORTS['mobile-common'], { width: 390, height: 844 }); assert.deepEqual(WEB_VIEWPORTS.laptop, { width: 1366, height: 768 }); });
test('web scenario rejects unknown keys, versions, duplicate viewports and excessive limits', () => {
  assert.throws(() => webScenarioSchema.parse({ ...valid, version: 2 }));
  assert.throws(() => webScenarioSchema.parse({ ...valid, extra: true }));
  assert.throws(() => webScenarioSchema.parse({ ...valid, viewports: ['laptop', 'laptop'] }));
  assert.throws(() => webScenarioSchema.parse({ ...valid, limits: { ...valid.limits, max_steps: 51 } }));
});
test('YAML loader rejects malformed scenario', async () => { const root = await mkdtemp(path.join(os.tmpdir(), 'qa-schema-')); const file = path.join(root, 'bad.yaml'); await writeFile(file, 'version: 1\nid: BAD ID\n'); await assert.rejects(loadWebScenario(file)); });
test('Gia Su AI public smoke stops at the visible Google login control', async () => {
  const scenario = await findWebScenario('gia-su-ai-public-smoke');
  assert.equal(scenario.flow.some((step) => step.action === 'fill'), false);
  assert.deepEqual(scenario.flow.filter((step) => step.action === 'open').map((step) => step.path), ['/', '/app', '/app/tutor']);
  assert.equal(scenario.flow.filter((step) => step.action === 'expect_url' && step.path === '/login').length, 3);
  assert.equal(scenario.checks.primary_actions_clickable[0]?.selector, "[data-qa=google-login], button.google-signin-button");
});
