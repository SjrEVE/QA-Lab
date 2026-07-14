import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import {
  authenticatedSessionScenarioSchema,
  loadAuthenticatedSessionScenario,
} from '../src/authenticated-session-scenario.js';

test('loads the dedicated G12 session-start scenario without widening its scope', async () => {
  const scenario = await loadAuthenticatedSessionScenario(path.resolve('scenarios/authenticated/gia-su-ai-session-start.yaml'));
  assert.equal(scenario.id, 'gia-su-ai-session-start');
  assert.equal(scenario.reset.scope, 'g12-session-start-smoke');
  assert.equal(scenario.lesson.id, 'G12_MATH_KNTT_CH01_L01');
  assert.deepEqual(scenario.expected.activeStatuses, ['listening', 'user speaking', 'AI speaking']);
  assert.match(scenario.selectors.start, /data-session-control="start"/);
});

test('rejects selectors that bypass the stable data-qa contract', () => {
  const valid = {
    version: 1,
    id: 'fixture-session-start',
    name: 'Fixture session',
    type: 'authenticated-session-start',
    target: { path: '/app' },
    reset: { scope: 'g12-session-start-smoke' },
    lesson: { id: 'G12_MATH_KNTT_CH01_L01', registryStatusAttribute: 'data-registry-status', approvedRegistryValue: 'approved' },
    selectors: {
      authenticatedShell: '[data-qa="authenticated-shell"]',
      accountIdentity: '[data-qa="account-email"]',
      lesson: '[data-qa="lesson-option"]',
      classroomReady: '[data-qa="lesson-ready"]',
      start: '[data-qa="start-lesson"]',
      status: '[data-qa="session-status"]',
      error: '[data-qa="session-error"]',
      stop: '[data-qa="start-lesson"]',
    },
    expected: { activeStatuses: ['listening'], stoppedStatus: 'disconnected' },
    limits: { maxMinutes: 1, selectorTimeoutMs: 2_000, activeTimeoutMs: 2_000, maxIssues: 5 },
  };
  assert.throws(() => authenticatedSessionScenarioSchema.parse({
    ...valid,
    selectors: { ...valid.selectors, status: '.learning-status' },
  }));
});
