import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  bootstrapStagingAuth,
  runConfiguredAuthBootstrap,
  type AuthBrowserLaunchOptions,
  type AuthBrowserLauncher,
  type AuthBrowserSession,
} from '../src/auth-bootstrap.js';
import type { QaConfig } from '../src/config.js';
import { stagingProfileSchema } from '../src/staging-profile.js';

const syntheticEmail = 'qa-student@example.test';
const config: QaConfig = {
  version: 1,
  environment: 'staging',
  staging: { allowedHosts: ['stage.example.test'], baseUrl: 'https://stage.example.test' },
  artifacts: { root: 'runs' },
  logging: { level: 'info' },
};
const profile = stagingProfileSchema.parse({
  version: 1,
  id: 'gia-su-ai',
  name: 'Gia Su AI staging',
  target: { expectedHost: 'stage.example.test', loginPath: '/login', authenticatedPath: '/app' },
  privatePaths: {
    browserProfileDirectory: '.qa-private/browser/gia-su-ai',
    authStatePath: '.qa-private/auth/gia-su-ai.json',
    resetConfigPath: '.qa-private/reset/gia-su-ai.json',
  },
  auth: {
    authenticatedSelector: '[data-qa="authenticated-shell"]',
    accountIdentitySelector: '[data-qa="account-email"]',
    accountIdentitySource: 'textContent',
    allowedHosts: ['accounts.google.com'],
    bootstrapTimeoutMs: 30_000,
  },
  suites: { publicWebScenarioIds: [], authenticatedWebScenarioIds: [], journeyIds: [] },
});

interface FakeBehavior {
  readonly identity?: string;
  readonly failSelector?: string;
}

class FakeLauncher implements AuthBrowserLauncher {
  readonly #behaviors: readonly FakeBehavior[];
  public readonly launches: AuthBrowserLaunchOptions[] = [];

  public constructor(behaviors: readonly FakeBehavior[]) {
    this.#behaviors = behaviors;
  }

  public async launch(options: AuthBrowserLaunchOptions): Promise<AuthBrowserSession> {
    const behavior = this.#behaviors[this.launches.length] ?? {};
    this.launches.push(options);
    const { mkdir } = await import('node:fs/promises');
    await mkdir(options.profileDirectory, { recursive: true });
    return {
      navigate: () => Promise.resolve(),
      waitForVisible: (selector) => selector === behavior.failSelector
        ? Promise.reject(new Error('selector missing'))
        : Promise.resolve(),
      readIdentity: () => Promise.resolve(behavior.identity ?? ''),
      close: () => Promise.resolve(),
    };
  }
}

test('missing dedicated profile is initialized and verified in a second browser process', async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), 'qa-auth-bootstrap-'));
  const launcher = new FakeLauncher([{ identity: syntheticEmail }, { identity: syntheticEmail.toUpperCase() }]);
  const result = await bootstrapStagingAuth({ cwd, config, profile, expectedEmail: ` ${syntheticEmail.toUpperCase()} `, launcher });
  assert.equal(result.status, 'VERIFIED');
  assert.equal(result.verifiedInFreshBrowser, true);
  assert.deepEqual(launcher.launches.map(({ headed }) => headed), [true, false]);
  assert.doesNotMatch(JSON.stringify(result), new RegExp(syntheticEmail, 'i'));
  const verification = await readFile(path.join(cwd, '.qa-private', 'auth', 'gia-su-ai.json'), 'utf8');
  assert.doesNotMatch(verification, new RegExp(syntheticEmail, 'i'));
  assert.match(verification, /sha256:/);
});

test('missing expected email and malformed persistent profile fail closed', async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), 'qa-auth-bootstrap-'));
  const launcher = new FakeLauncher([{ identity: syntheticEmail }]);
  assert.equal((await bootstrapStagingAuth({ cwd, config, profile, launcher })).status, 'BLOCKED');
  assert.equal(launcher.launches.length, 0);

  const malformed = path.join(cwd, '.qa-private', 'browser', 'gia-su-ai');
  const { mkdir } = await import('node:fs/promises');
  await mkdir(path.dirname(malformed), { recursive: true });
  await writeFile(malformed, 'not a Chromium profile');
  const result = await bootstrapStagingAuth({ cwd, config, profile, expectedEmail: syntheticEmail, launcher });
  assert.equal(result.status, 'BLOCKED');
  assert.match(result.reason, /malformed|unsafe/);
});

test('missing or malformed typed profile is reported as BLOCKED', async () => {
  const missingCwd = await mkdtemp(path.join(tmpdir(), 'qa-auth-configured-'));
  const missing = await runConfiguredAuthBootstrap({ cwd: missingCwd, env: {}, loadEnvFile: false });
  assert.equal(missing.status, 'BLOCKED');

  const malformedCwd = await mkdtemp(path.join(tmpdir(), 'qa-auth-configured-'));
  const { mkdir } = await import('node:fs/promises');
  await mkdir(path.join(malformedCwd, 'config'));
  await writeFile(path.join(malformedCwd, 'config', 'qa-lab.yaml'), 'not: valid: yaml');
  const malformed = await runConfiguredAuthBootstrap({ cwd: malformedCwd, env: {}, loadEnvFile: false });
  assert.equal(malformed.status, 'BLOCKED');
});

test('wrong account and missing identity selector are BLOCKED without raw identity evidence', async () => {
  const wrong = new FakeLauncher([{ identity: 'personal@example.test' }]);
  const wrongResult = await bootstrapStagingAuth({
    cwd: await mkdtemp(path.join(tmpdir(), 'qa-auth-bootstrap-')),
    config,
    profile,
    expectedEmail: syntheticEmail,
    launcher: wrong,
  });
  assert.equal(wrongResult.status, 'BLOCKED');
  assert.doesNotMatch(JSON.stringify(wrongResult), /personal@example\.test/);

  const missingIdentity = new FakeLauncher([{ failSelector: profile.auth.accountIdentitySelector }]);
  const missingResult = await bootstrapStagingAuth({
    cwd: await mkdtemp(path.join(tmpdir(), 'qa-auth-bootstrap-')),
    config,
    profile,
    expectedEmail: syntheticEmail,
    launcher: missingIdentity,
  });
  assert.equal(missingResult.status, 'BLOCKED');
});

test('session absent in the fresh browser process is BLOCKED', async () => {
  const launcher = new FakeLauncher([
    { identity: syntheticEmail },
    { failSelector: profile.auth.authenticatedSelector },
  ]);
  const result = await bootstrapStagingAuth({
    cwd: await mkdtemp(path.join(tmpdir(), 'qa-auth-bootstrap-')),
    config,
    profile,
    expectedEmail: syntheticEmail,
    launcher,
  });
  assert.equal(result.status, 'BLOCKED');
  assert.match(result.reason, /fresh browser process/);
  assert.equal(launcher.launches.length, 2);
});
