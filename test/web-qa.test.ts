import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { findWebScenario } from '../src/web-scenario.js';
import { isExpectedGoogleRecaptchaReportOnlyCspWarning, isExpectedHeadlessRecaptchaStorageWarning, runWebQa, webIssueSchema } from '../src/web-qa.js';
import { startFixtureSite } from './fixture-site.js';

test('complete fixture E2E executes two viewports and writes real reports', async () => {
  const site = await startFixtureSite(); const root = await mkdtemp(path.join(os.tmpdir(), 'qa-web-'));
  try { const result = await runWebQa({ scenario: await findWebScenario('home-smoke'), baseUrl: site.origin, artifactRoot: root, runId: 'e2e', policy: { allowedHosts: ['unused.invalid'], fixtureMode: true, fixturePort: site.port } }); assert.equal(result.status, 'PASSED'); assert.equal(result.checks.some((x) => x.viewport === 'mobile-common'), true); assert.equal(result.checks.some((x) => x.viewport === 'laptop'), true); for (const name of ['report.md','summary.json','issues.json','metrics.json','status.json','run.json']) assert.ok((await readFile(path.join(root, 'e2e', name))).length > 0); } finally { await site.close(); }
});
test('issue schema serializes confidence, limitations and evidence', () => { const issue = webIssueSchema.parse({ schemaVersion: 1, id: 'WEB-X', runner: 'web', scenarioId: 'x', viewport: 'laptop', category: 'console', severity: 'HIGH', title: 'x', url: 'http://127.0.0.1/', timestampMs: 1, expected: 'none', actual: 'error', evidence: ['events.jsonl'], confidence: .9, limitations: 'triage', status: 'NEW' }); assert.match(JSON.stringify(issue), /limitations/); });
test('only the exact headless Google reCAPTCHA storage warning is excluded', () => {
  assert.equal(isExpectedHeadlessRecaptchaStorageWarning({ event: 'console', timestamp: 'now', data: { type: 'error', text: 'requestStorageAccess: Permission denied.', url: 'https://www.google.com/recaptcha/enterprise/anchor?k=public-site-key' } }), true);
  assert.equal(isExpectedHeadlessRecaptchaStorageWarning({ event: 'console', timestamp: 'now', data: { type: 'error', text: 'requestStorageAccess: Permission denied.', url: 'https://example.test/app' } }), false);
  assert.equal(isExpectedHeadlessRecaptchaStorageWarning({ event: 'console', timestamp: 'now', data: { type: 'error', text: 'product crashed', url: 'https://www.google.com/recaptcha/enterprise/anchor' } }), false);
});
test('only the exact Google reCAPTCHA report-only CSP notice is excluded', () => {
  const notice = `Framing 'https://www.google.com/' violates the following report-only Content Security Policy directive: "frame-ancestors 'self'". The violation has been logged, but no further action has been taken.`;
  assert.equal(isExpectedGoogleRecaptchaReportOnlyCspWarning({ event: 'console', timestamp: 'now', data: { type: 'error', text: notice, url: '' } }), true);
  assert.equal(isExpectedGoogleRecaptchaReportOnlyCspWarning({ event: 'console', timestamp: 'now', data: { type: 'error', text: notice.replace('report-only', 'enforced'), url: '' } }), false);
  assert.equal(isExpectedGoogleRecaptchaReportOnlyCspWarning({ event: 'console', timestamp: 'now', data: { type: 'error', text: 'product CSP violation', url: '' } }), false);
});
test('missing staging target is BLOCKED and never represented as PASS', async () => { const root = await mkdtemp(path.join(os.tmpdir(), 'qa-web-')); const result = await runWebQa({ scenario: await findWebScenario('home-smoke'), artifactRoot: root, runId: 'blocked', policy: { allowedHosts: ['staging.invalid'] } }); assert.equal(result.status, 'BLOCKED'); });
