import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { parse as parseYaml } from 'yaml';
import type { QaConfig } from '../src/config.js';
import { assertPrivatePath, loadStagingAppCheckDebugToken, loadStagingProfile, stagingProfileSchema } from '../src/staging-profile.js';

const valid = {
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
    bootstrapTimeoutMs: 600_000,
  },
  suites: { publicWebScenarioIds: ['public-smoke'], authenticatedWebScenarioIds: [], journeyIds: [] },
};

const config: QaConfig = {
  version: 1,
  environment: 'staging',
  staging: { allowedHosts: ['stage.example.test'], baseUrl: 'https://stage.example.test' },
  artifacts: { root: 'runs' },
  logging: { level: 'info' },
};

async function writeProfile(cwd: string, value: unknown): Promise<void> {
  await mkdir(path.join(cwd, 'config'));
  await writeFile(path.join(cwd, 'config', 'staging-profile.yaml'), JSON.stringify(value));
}

test('parses a strict authenticated staging profile', () => {
  assert.equal(stagingProfileSchema.parse(valid).id, 'gia-su-ai');
  assert.throws(() => stagingProfileSchema.parse({ ...valid, unexpected: true }));
  assert.throws(() => stagingProfileSchema.parse({ ...valid, version: 2 }));
  assert.throws(() => stagingProfileSchema.parse({ ...valid, auth: { ...valid.auth, bootstrapTimeoutMs: 'forever' } }));
});

test('Gia Su AI staging profile allows the exact App Check host without broad Google wildcards', async () => {
  const profile = stagingProfileSchema.parse(parseYaml(await readFile('config/staging-profile.yaml', 'utf8')));
  assert.ok(profile.auth.allowedHosts.includes('www.google.com'));
  assert.ok(!profile.auth.allowedHosts.some((host) => host.includes('*')));
  assert.ok(!profile.auth.allowedHosts.includes('google.com'));
  assert.equal(new Set(profile.auth.allowedHosts).size, profile.auth.allowedHosts.length);
  assert.equal(profile.privatePaths.appCheckDebugTokenPath, '.qa-private/app-check/giasu-c2165.debug-token');
});

test('loads only a private UUIDv4 App Check debug token and rejects malformed content', async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), 'qa-staging-profile-'));
  const profile = stagingProfileSchema.parse({
    ...valid,
    privatePaths: { ...valid.privatePaths, appCheckDebugTokenPath: '.qa-private/app-check/staging.token' },
  });
  await mkdir(path.join(cwd, '.qa-private', 'app-check'), { recursive: true });
  const tokenPath = path.join(cwd, '.qa-private', 'app-check', 'staging.token');
  await writeFile(tokenPath, 'd9428888-122b-4a8b-a75a-9acb8b6b7312\n');
  assert.equal(await loadStagingAppCheckDebugToken(cwd, profile), 'd9428888-122b-4a8b-a75a-9acb8b6b7312');
  await writeFile(tokenPath, 'not-a-token');
  await assert.rejects(loadStagingAppCheckDebugToken(cwd, profile), /UUIDv4/);
});

test('rejects absolute paths, traversal, and private paths outside .qa-private', () => {
  for (const authStatePath of ['C:\\temp\\auth.json', '/tmp/auth.json', '../auth.json', '.qa-private/../auth.json', 'private/auth.json']) {
    assert.throws(() => stagingProfileSchema.parse({
      ...valid,
      privatePaths: { ...valid.privatePaths, authStatePath },
    }), authStatePath);
  }
});

test('rejects an existing symbolic-link escape beneath the private root', async (t) => {
  const cwd = await mkdtemp(path.join(tmpdir(), 'qa-staging-profile-'));
  await mkdir(path.join(cwd, '.qa-private'));
  const outside = await mkdtemp(path.join(tmpdir(), 'qa-staging-outside-'));
  try {
    await symlink(outside, path.join(cwd, '.qa-private', 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
  } catch (error) {
    t.skip(`Symbolic links are unavailable: ${error instanceof Error ? error.message : String(error)}`);
    return;
  }
  await assert.rejects(assertPrivatePath(cwd, '.qa-private/linked/auth.json'), /symbolic link|reparse point/i);
});

test('loads only the exact typed staging host and rejects a production-host profile', async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), 'qa-staging-profile-'));
  await writeProfile(cwd, valid);
  assert.equal((await loadStagingProfile({ cwd, config })).target.expectedHost, 'stage.example.test');

  const productionProfile = { ...valid, target: { ...valid.target, expectedHost: 'www.example.test' } };
  await writeFile(path.join(cwd, 'config', 'staging-profile.yaml'), JSON.stringify(productionProfile));
  await assert.rejects(loadStagingProfile({ cwd, config }), /does not match the exact typed staging target/);
});

test('fails closed when typed staging base URL is absent or outside the allowlist', async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), 'qa-staging-profile-'));
  await writeProfile(cwd, valid);
  await assert.rejects(loadStagingProfile({ cwd, config: { ...config, staging: { allowedHosts: ['stage.example.test'] } } }), /missing staging.baseUrl/);
  await assert.rejects(loadStagingProfile({
    cwd,
    config: { ...config, staging: { allowedHosts: ['other.example.test'], baseUrl: 'https://stage.example.test' } },
  }), /exact staging allowlist/);
});
