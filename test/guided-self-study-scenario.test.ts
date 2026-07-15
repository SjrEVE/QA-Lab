import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { guidedSelfStudyScenarioSchema, loadGuidedSelfStudyScenario } from '../src/guided-self-study-scenario.js';

test('loads the bounded integrals self-study scenario with three acceptance viewports', async () => {
  const scenario = await loadGuidedSelfStudyScenario(path.resolve('scenarios/authenticated/gia-su-ai-guided-self-study-integrals.yaml'));
  assert.equal(scenario.reset.scope, 'gss-integrals-self-study');
  assert.deepEqual(scenario.viewports, ['mobile-common', 'tablet', 'desktop']);
  assert.equal(scenario.answers.length, 6);
  assert.equal(scenario.answers[0]?.incorrectValue, '3');
});

test('rejects unsafe selectors, duplicate answers and missing remediation input', () => {
  const base = {
    version: 1, id: 'fixture-gss', name: 'Fixture', type: 'authenticated-guided-self-study', target: { path: '/app/learn' }, reset: { scope: 'fixture-reset' },
    package: { lessonId: 'LESSON_1', learningMode: 'textbook', packageId: 'fixture-package', fingerprint: 'a'.repeat(64) }, viewports: ['mobile-common', 'tablet', 'desktop'],
    selectors: Object.fromEntries(['authenticatedShell', 'accountTrigger', 'accountIdentity', 'player', 'start', 'answer', 'submit', 'verification', 'hintRequest', 'hint', 'remediationEnter', 'remediationReturn', 'next', 'learnContinue', 'verifyComplete', 'summary'].map((key) => [key, '[data-qa="fixture"]'])),
    answers: [{ exerciseId: 'E01', value: '2', incorrectValue: '3' }], limits: { maxMinutes: 5, selectorTimeoutMs: 2_000, transitionTimeoutMs: 2_000, maxIssues: 10 },
  };
  assert.equal(guidedSelfStudyScenarioSchema.parse(base).id, 'fixture-gss');
  assert.throws(() => guidedSelfStudyScenarioSchema.parse({ ...base, selectors: { ...base.selectors, player: 'main' } }));
  assert.throws(() => guidedSelfStudyScenarioSchema.parse({ ...base, answers: [{ exerciseId: 'E01', value: '2' }] }));
  assert.throws(() => guidedSelfStudyScenarioSchema.parse({ ...base, answers: [base.answers[0], base.answers[0]] }));
});
