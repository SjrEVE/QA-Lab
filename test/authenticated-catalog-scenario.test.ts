import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { authenticatedCatalogScenarioSchema, loadAuthenticatedCatalogScenario } from '../src/authenticated-catalog-scenario.js';

test('loads the Gia Su AI authenticated catalog contract without inventing a lesson ID', async () => {
  const scenario = await loadAuthenticatedCatalogScenario(path.resolve('scenarios/authenticated/gia-su-ai-catalog.yaml'));
  assert.equal(scenario.id, 'gia-su-ai-authenticated-catalog');
  assert.match(scenario.selectors.lesson.primary, /data-lesson-id/);
  assert.equal('lessonId' in scenario.lessonContract, false);
});

test('requires data-qa as the primary selector and rejects malformed versions', () => {
  const base = {
    version: 1,
    id: 'catalog-test',
    name: 'Catalog test',
    type: 'authenticated-catalog',
    target: { path: '/app' },
    viewports: ['laptop'],
    selectors: Object.fromEntries(['authenticatedShell', 'accountIdentity', 'grade', 'subject', 'chapter', 'lesson', 'classroomReady', 'startLesson'].map((key) => [key, { primary: '[data-qa="fixture"]', name: key }])),
    lessonContract: { lessonIdAttribute: 'data-lesson-id', registryStatusAttribute: 'data-registry-status', approvedRegistryValue: 'approved' },
    limits: { maxMinutes: 1, selectorTimeoutMs: 1_000, maxIssues: 10 },
  };
  assert.equal(authenticatedCatalogScenarioSchema.parse(base).version, 1);
  assert.throws(() => authenticatedCatalogScenarioSchema.parse({ ...base, version: 2 }));
  assert.throws(() => authenticatedCatalogScenarioSchema.parse({
    ...base,
    selectors: { ...base.selectors, grade: { primary: 'button.grade', name: 'Grade' } },
  }));
});
