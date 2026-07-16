import assert from 'node:assert/strict';
import { access, mkdir, mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { runAuthenticatedSessionStartQa, type SessionResetGate } from '../src/authenticated-session-qa.js';
import { authenticatedSessionScenarioSchema } from '../src/authenticated-session-scenario.js';
import { hashAccountIdentity, PlaywrightAuthBrowserLauncher } from '../src/auth-bootstrap.js';
import type { QaConfig } from '../src/config.js';
import { stagingProfileSchema } from '../src/staging-profile.js';
import { startFixtureSite } from './fixture-site.js';

const identityHash = hashAccountIdentity('qa-student@example.test');

function scenario() {
  return authenticatedSessionScenarioSchema.parse({
    version: 1,
    id: 'fixture-session-start',
    name: 'Fixture authenticated session start',
    type: 'authenticated-session-start',
    target: { path: '/auth/session' },
    reset: { scope: 'g12-session-start-smoke' },
    lesson: { id: 'G12_MATH_KNTT_CH01_L01', registryStatusAttribute: 'data-registry-status', approvedRegistryValue: 'approved' },
    selectors: {
      authenticatedShell: '[data-qa="authenticated-shell"]',
      accountTrigger: '[data-qa="account-trigger"]',
      accountIdentity: '[data-qa="account-email"]',
      lesson: '[data-qa="lesson-option"][data-lesson-id="G12_MATH_KNTT_CH01_L01"]',
      classroomReady: '[data-qa="lesson-ready"][data-lesson-id="G12_MATH_KNTT_CH01_L01"]',
      start: '[data-qa="start-lesson"][data-session-control="start"]',
      status: '[data-qa="session-status"][data-session-status]',
      error: '[data-qa="session-error"]',
      stop: '[data-qa="start-lesson"][data-session-control="stop"]',
    },
    expected: { activeStatuses: ['listening'], stoppedStatus: 'disconnected' },
    limits: { maxMinutes: 1, selectorTimeoutMs: 2_000, activeTimeoutMs: 2_000, maxIssues: 10 },
  });
}

function setup(cwd: string, sitePort: number) {
  const config: QaConfig = { version: 1, environment: 'staging', staging: { allowedHosts: ['stage.example.test'], baseUrl: 'https://stage.example.test' }, artifacts: { root: 'runs' }, logging: { level: 'info' } };
  const profile = stagingProfileSchema.parse({
    version: 1,
    id: 'gia-su-ai',
    name: 'Gia Su AI staging',
    target: { expectedHost: 'stage.example.test', loginPath: '/login', authenticatedPath: '/auth/app' },
    privatePaths: { browserProfileDirectory: '.qa-private/browser/gia-su-ai', authStatePath: '.qa-private/auth/gia-su-ai.json', resetConfigPath: '.qa-private/reset/gia-su-ai.json' },
    auth: { authenticatedSelector: '[data-qa="authenticated-shell"]', accountIdentitySelector: '[data-qa="account-email"]', accountIdentitySource: 'textContent', bootstrapTimeoutMs: 30_000 },
    suites: { publicWebScenarioIds: [], authenticatedWebScenarioIds: [], journeyIds: ['fixture-session-start'] },
  });
  return { config, profile, policy: { allowedHosts: ['unused.invalid'], fixtureMode: true, fixturePort: sitePort } as const, artifactRoot: path.join(cwd, 'runs') };
}

test('strict reset gates a targeted authenticated connection and clean stop', async () => {
  const site = await startFixtureSite();
  const cwd = await mkdtemp(path.join(tmpdir(), 'qa-auth-session-'));
  const profileDirectory = path.join(cwd, '.qa-private', 'browser', 'gia-su-ai');
  await mkdir(profileDirectory, { recursive: true });
  const launcher = new PlaywrightAuthBrowserLauncher();
  const policy = { allowedHosts: ['unused.invalid'], fixtureMode: true, fixturePort: site.port } as const;
  const bootstrap = await launcher.launch({ profileDirectory, policy, timeoutMs: 5_000, headed: false });
  await bootstrap.navigate(`${site.origin}/auth/bootstrap`);
  await bootstrap.close();
  const resetCalls: string[] = [];
  const reset: SessionResetGate = { reset: (request) => {
    resetCalls.push(request.scope);
    return Promise.resolve({ status: 'READY', reason: 'fixture reset ready', accountIdentityHash: request.accountIdentityHash, scope: request.scope });
  } };
  try {
    const options = setup(cwd, site.port);
    const result = await runAuthenticatedSessionStartQa({
      cwd,
      ...options,
      scenario: scenario(),
      verifiedIdentityHash: identityHash,
      reset,
      runId: 'session-pass',
      baseUrl: site.origin,
    });
    assert.equal(result.status, 'PASSED');
    assert.equal(result.activeStatus, 'listening');
    assert.deepEqual(resetCalls, ['g12-session-start-smoke']);
    assert.equal(result.checks.some((check) => check.check === 'session:clean-stop' && check.passed), true);
    await access(path.join(result.artifactDirectory, 'browser', 'connected.png'));
    await access(path.join(result.artifactDirectory, 'browser', 'stopped.png'));
    const summary = await readFile(path.join(result.artifactDirectory, 'summary.json'), 'utf8');
    assert.doesNotMatch(summary, /qa-student@example\.test/i);
    assert.match(summary, /real staging realtime connection/);
  } finally {
    await site.close();
  }
});

test('reset refusal blocks the run before any browser is launched', async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), 'qa-auth-session-'));
  const profileDirectory = path.join(cwd, '.qa-private', 'browser', 'gia-su-ai');
  await mkdir(profileDirectory, { recursive: true });
  const options = setup(cwd, 3210);
  const result = await runAuthenticatedSessionStartQa({
    cwd,
    ...options,
    scenario: scenario(),
    verifiedIdentityHash: identityHash,
    reset: { reset: () => Promise.resolve({ status: 'BLOCKED', reason: 'fixture reset refused' }) },
    runId: 'session-blocked',
    baseUrl: 'http://127.0.0.1:3210',
  });
  assert.equal(result.status, 'BLOCKED');
  assert.equal(result.issues[0]?.category, 'reset');
  await assert.rejects(access(path.join(result.artifactDirectory, 'browser')));
});
