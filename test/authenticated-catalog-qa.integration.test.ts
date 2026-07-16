import assert from 'node:assert/strict';
import { access, mkdir, mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { runAuthenticatedCatalogQa } from '../src/authenticated-catalog-qa.js';
import { authenticatedCatalogScenarioSchema } from '../src/authenticated-catalog-scenario.js';
import { hashAccountIdentity, PlaywrightAuthBrowserLauncher } from '../src/auth-bootstrap.js';
import type { QaConfig } from '../src/config.js';
import { stagingProfileSchema } from '../src/staging-profile.js';
import { startFixtureSite } from './fixture-site.js';

const email = 'qa-student@example.test';

function scenario(selectorTimeoutMs = 2_000) {
  const contract = (primary: string, name: string) => ({ primary, name });
  return authenticatedCatalogScenarioSchema.parse({
    version: 1,
    id: 'fixture-authenticated-catalog',
    name: '<script>alert("report")</script> fixture catalog',
    type: 'authenticated-catalog',
    target: { path: '/auth/app' },
    viewports: ['mobile-common', 'laptop'],
    selectors: {
      authenticatedShell: contract('[data-qa="authenticated-shell"]', 'Shell'),
      accountTrigger: contract('[data-qa="account-trigger"]', 'Account trigger'),
      accountIdentity: contract('[data-qa="account-email"]', 'Identity'),
      switchAccount: contract('[data-qa="switch-account"]', 'Switch account'),
      logout: contract('[data-qa="logout"]', 'Logout'),
      grade: contract('[data-qa="grade-option"]', 'Grade'),
      subject: contract('[data-qa="subject-option"]', 'Subject'),
      chapter: contract('[data-qa="chapter-option"]', 'Chapter'),
      lesson: contract('[data-qa="lesson-option"]', 'Lesson'),
      classroomReady: contract('[data-qa="lesson-ready"]', 'Classroom'),
      startLesson: contract('[data-qa="start-lesson"]', 'Start'),
    },
    lessonContract: { lessonIdAttribute: 'data-lesson-id', registryStatusAttribute: 'data-registry-status', approvedRegistryValue: 'approved', learningModeAttribute: 'data-learning-mode', expectedLearningModes: ['textbook', 'foundation_recovery', 'review'] },
    limits: { maxMinutes: 1, selectorTimeoutMs, maxIssues: 20 },
  });
}

test('persistent authenticated profile completes catalog hierarchy in two viewports with redacted evidence', async () => {
  const site = await startFixtureSite();
  const cwd = await mkdtemp(path.join(tmpdir(), 'qa-auth-catalog-'));
  const profileDirectory = path.join(cwd, '.qa-private', 'browser', 'gia-su-ai');
  await mkdir(profileDirectory, { recursive: true });
  const launcher = new PlaywrightAuthBrowserLauncher();
  const policy = { allowedHosts: ['unused.invalid'], fixtureMode: true, fixturePort: site.port } as const;
  const bootstrap = await launcher.launch({ profileDirectory, policy, timeoutMs: 5_000, headed: false });
  await bootstrap.navigate(`${site.origin}/auth/bootstrap`);
  await bootstrap.close();

  const config: QaConfig = { version: 1, environment: 'staging', staging: { allowedHosts: ['stage.example.test'], baseUrl: 'https://stage.example.test' }, artifacts: { root: 'runs' }, logging: { level: 'info' } };
  const profile = stagingProfileSchema.parse({
    version: 1,
    id: 'gia-su-ai',
    name: 'Gia Su AI staging',
    target: { expectedHost: 'stage.example.test', loginPath: '/login', authenticatedPath: '/auth/app' },
    privatePaths: { browserProfileDirectory: '.qa-private/browser/gia-su-ai', authStatePath: '.qa-private/auth/gia-su-ai.json', resetConfigPath: '.qa-private/reset/gia-su-ai.json' },
    auth: { authenticatedSelector: '[data-qa="authenticated-shell"]', accountIdentitySelector: '[data-qa="account-email"]', accountIdentitySource: 'textContent', bootstrapTimeoutMs: 30_000 },
    suites: { publicWebScenarioIds: [], authenticatedWebScenarioIds: ['fixture-authenticated-catalog'], journeyIds: [] },
  });
  const artifactRoot = path.join(cwd, 'runs');
  try {
    const result = await runAuthenticatedCatalogQa({
      cwd,
      config,
      profile,
      scenario: scenario(),
      verifiedIdentityHash: hashAccountIdentity(email),
      artifactRoot,
      runId: 'catalog-pass',
      baseUrl: site.origin,
      policy,
    });
    assert.equal(result.status, 'PASSED');
    assert.deepEqual(result.selectedLessonIds, ['fixture-grade6-lesson1']);
    assert.equal(result.issues.length, 0);
    assert.equal(result.checks.some((check) => check.check === 'account:explicit-switch-route' && check.passed), true);
    assert.equal(result.checks.some((check) => check.check === 'mode:tutor-route-continuity' && check.passed), true);
    await access(path.join(result.artifactDirectory, 'mobile-common', 'checkpoint.png'));
    await access(path.join(result.artifactDirectory, 'laptop', 'checkpoint.png'));
    const report = await readFile(path.join(result.artifactDirectory, 'report.html'), 'utf8');
    assert.doesNotMatch(report, /<script>alert/);
    assert.match(report, /&lt;script&gt;/);
    assert.doesNotMatch(await readFile(path.join(result.artifactDirectory, 'summary.json'), 'utf8'), new RegExp(email, 'i'));

    const missingSelectorScenario = authenticatedCatalogScenarioSchema.parse({
      ...scenario(1_000),
      viewports: ['laptop'],
      selectors: { ...scenario(1_000).selectors, grade: { primary: '[data-qa="missing-grade"]', name: 'Missing grade' } },
    });
    const failed = await runAuthenticatedCatalogQa({
      cwd,
      config,
      profile,
      scenario: missingSelectorScenario,
      verifiedIdentityHash: hashAccountIdentity(email),
      artifactRoot,
      runId: 'catalog-failed',
      baseUrl: site.origin,
      policy,
    });
    assert.equal(failed.status, 'FAILED');
    assert.match(failed.issues[0]?.actual ?? '', /data-qa selector/);
  } finally {
    await site.close();
  }
});

test('missing persistent profile is BLOCKED without launching a browser', async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), 'qa-auth-catalog-'));
  const config: QaConfig = { version: 1, environment: 'staging', staging: { allowedHosts: ['stage.example.test'], baseUrl: 'https://stage.example.test' }, artifacts: { root: 'runs' }, logging: { level: 'info' } };
  const profile = stagingProfileSchema.parse({
    version: 1,
    id: 'gia-su-ai',
    name: 'Gia Su AI staging',
    target: { expectedHost: 'stage.example.test', loginPath: '/login', authenticatedPath: '/app' },
    privatePaths: { browserProfileDirectory: '.qa-private/browser/gia-su-ai', authStatePath: '.qa-private/auth/gia-su-ai.json', resetConfigPath: '.qa-private/reset/gia-su-ai.json' },
    auth: { authenticatedSelector: '[data-qa="authenticated-shell"]', accountIdentitySelector: '[data-qa="account-email"]', bootstrapTimeoutMs: 30_000 },
    suites: { publicWebScenarioIds: [], authenticatedWebScenarioIds: [], journeyIds: [] },
  });
  const result = await runAuthenticatedCatalogQa({
    cwd,
    config,
    profile,
    scenario: scenario(),
    verifiedIdentityHash: hashAccountIdentity(email),
    artifactRoot: path.join(cwd, 'runs'),
    runId: 'catalog-blocked',
    baseUrl: 'https://stage.example.test',
  });
  assert.equal(result.status, 'BLOCKED');
});
