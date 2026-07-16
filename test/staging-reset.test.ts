import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import type { QaConfig } from '../src/config.js';
import { studentActionSchema } from '../src/student-brain.js';
import {
  runConfiguredStagingReset,
  stagingResetConfigSchema,
  StrictStagingResetAdapter,
  type ResetHttpClient,
} from '../src/staging-reset.js';

const identityHash = `sha256:${'a'.repeat(64)}`;
const otherIdentityHash = `sha256:${'b'.repeat(64)}`;
const scope = 'grade-6-math-lesson-smoke';
const config: QaConfig = {
  version: 1,
  environment: 'staging',
  staging: { allowedHosts: ['stage.example.test'], baseUrl: 'https://stage.example.test' },
  artifacts: { root: 'runs' },
  logging: { level: 'info' },
};

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), { status: 200, headers: { 'content-type': 'application/json; charset=utf-8' } });
}

function validResponse(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    ok: true,
    accountIdentityHash: identityHash,
    scope,
    resetVersion: 'reset-v1',
    resetAt: '2026-07-15T00:00:00.000Z',
    ...overrides,
  };
}

test('manual reset is READY only for the literal true confirmation', async () => {
  const resetConfig = stagingResetConfigSchema.parse({
    version: 1,
    mode: 'manual',
    expectedAccountIdentityHash: identityHash,
    allowedScopes: [scope],
  });
  for (const confirmation of [undefined, 'false', 'TRUE', '1']) {
    const env = confirmation === undefined ? {} : { QA_MANUAL_RESET_CONFIRMED: confirmation };
    const result = await new StrictStagingResetAdapter({ config, resetConfig, env }).reset({ accountIdentityHash: identityHash, scope });
    assert.equal(result.status, 'BLOCKED');
  }
  const adapter = new StrictStagingResetAdapter({ config, resetConfig, env: { QA_MANUAL_RESET_CONFIRMED: 'true' } });
  assert.equal((await adapter.reset({ accountIdentityHash: identityHash, scope })).status, 'READY');
  assert.equal((await adapter.reset({ accountIdentityHash: identityHash, scope })).status, 'READY');
});

test('HTTP reset uses a stable idempotency key and accepts only an exact strict response', async () => {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const httpClient: ResetHttpClient = (url, init) => {
    calls.push({ url, init });
    return Promise.resolve(jsonResponse(validResponse()));
  };
  const resetConfig = stagingResetConfigSchema.parse({
    version: 1,
    mode: 'http',
    expectedAccountIdentityHash: identityHash,
    allowedScopes: [scope],
    url: 'https://stage.example.test/api/qa/reset',
    tokenEnv: 'QA_RESET_TOKEN',
    timeoutMs: 2_000,
  });
  const adapter = new StrictStagingResetAdapter({
    config,
    resetConfig,
    env: { QA_RESET_TOKEN: 'unit-test-placeholder-not-secret' },
    httpClient,
  });
  assert.equal((await adapter.reset({ accountIdentityHash: identityHash, scope })).status, 'READY');
  assert.equal((await adapter.reset({ accountIdentityHash: identityHash, scope })).status, 'READY');
  assert.equal(calls.length, 2);
  const firstHeaders = new Headers(calls[0]?.init.headers);
  const secondHeaders = new Headers(calls[1]?.init.headers);
  assert.equal(firstHeaders.get('idempotency-key'), secondHeaders.get('idempotency-key'));
  assert.match(firstHeaders.get('idempotency-key') ?? '', /^[a-f0-9]{64}$/);
  assert.equal(firstHeaders.get('authorization'), null);
  assert.equal(firstHeaders.get('x-qa-reset-token'), 'unit-test-placeholder-not-secret');
  assert.equal(calls[0]?.url, 'https://stage.example.test/api/qa/reset');
});

test('matrix reset binds the exact lesson id into request and idempotency', async () => {
  const calls: Array<{ init: RequestInit }> = [];
  const matrixScope = 'live-lesson-matrix';
  const lessonId = 'G12_MATH_KNTT_CD01_L01';
  const resetConfig = stagingResetConfigSchema.parse({
    version: 1, mode: 'http', expectedAccountIdentityHash: identityHash,
    allowedScopes: [matrixScope], url: 'https://stage.example.test/api/qa/reset',
  });
  const adapter = new StrictStagingResetAdapter({
    config, resetConfig, env: { QA_RESET_TOKEN: 'unit-test-placeholder-not-secret' },
    httpClient: (_url, init) => { calls.push({ init }); return Promise.resolve(jsonResponse(validResponse({ scope: matrixScope }))); },
  });
  assert.equal((await adapter.reset({ accountIdentityHash: identityHash, scope: matrixScope, lessonId })).status, 'READY');
  const rawBody = calls[0]?.init.body;
  assert.equal(typeof rawBody, 'string');
  const body = JSON.parse(rawBody as string) as Record<string, unknown>;
  assert.equal(body.lessonId, lessonId);
  assert.equal(body.idempotencyKey, new Headers(calls[0]?.init.headers).get('idempotency-key'));
});

test('2xx HTML, malformed JSON, extra fields, wrong account, and wrong scope are BLOCKED', async () => {
  const resetConfig = stagingResetConfigSchema.parse({
    version: 1,
    mode: 'http',
    expectedAccountIdentityHash: identityHash,
    allowedScopes: [scope],
    url: 'https://stage.example.test/api/qa/reset',
  });
  const responses = [
    new Response('<html>ok</html>', { status: 200, headers: { 'content-type': 'text/html' } }),
    new Response('{not-json', { status: 200, headers: { 'content-type': 'application/json' } }),
    jsonResponse(validResponse({ unexpected: true })),
    jsonResponse(validResponse({ accountIdentityHash: otherIdentityHash })),
    jsonResponse(validResponse({ scope: 'different-scope' })),
  ];
  for (const response of responses) {
    const adapter = new StrictStagingResetAdapter({
      config,
      resetConfig,
      env: { QA_RESET_TOKEN: 'unit-test-placeholder-not-secret' },
      httpClient: () => Promise.resolve(response),
    });
    assert.equal((await adapter.reset({ accountIdentityHash: identityHash, scope })).status, 'BLOCKED');
  }
});

test('wrong account, unapproved scope, missing token, and non-allowlisted endpoint never call HTTP', async () => {
  let calls = 0;
  const httpClient: ResetHttpClient = () => { calls += 1; return Promise.resolve(jsonResponse(validResponse())); };
  const base = {
    version: 1 as const,
    mode: 'http' as const,
    expectedAccountIdentityHash: identityHash,
    allowedScopes: [scope],
    url: 'https://stage.example.test/api/qa/reset',
  };
  const adapter = new StrictStagingResetAdapter({ config, resetConfig: stagingResetConfigSchema.parse(base), env: {}, httpClient });
  assert.equal((await adapter.reset({ accountIdentityHash: otherIdentityHash, scope })).status, 'BLOCKED');
  assert.equal((await adapter.reset({ accountIdentityHash: identityHash, scope: 'other-scope' })).status, 'BLOCKED');
  assert.equal((await adapter.reset({ accountIdentityHash: identityHash, scope })).status, 'BLOCKED');
  const evil = new StrictStagingResetAdapter({
    config,
    resetConfig: stagingResetConfigSchema.parse({ ...base, url: 'https://stage.example.test.evil.test/reset' }),
    env: { QA_RESET_TOKEN: 'unit-test-placeholder-not-secret' },
    httpClient,
  });
  assert.equal((await evil.reset({ accountIdentityHash: identityHash, scope })).status, 'BLOCKED');
  assert.equal(calls, 0);
});

test('configured reset loads private verified identity and private reset config', async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), 'qa-reset-configured-'));
  await mkdir(path.join(cwd, 'config'));
  await mkdir(path.join(cwd, '.qa-private', 'auth'), { recursive: true });
  await mkdir(path.join(cwd, '.qa-private', 'reset'), { recursive: true });
  await writeFile(path.join(cwd, 'config', 'qa-lab.yaml'), 'version: 1\nenvironment: staging\nstaging:\n  allowedHosts: [stage.example.test]\nartifacts:\n  root: runs\nlogging:\n  level: info\n');
  await writeFile(path.join(cwd, 'config', 'staging-profile.yaml'), JSON.stringify({
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
      bootstrapTimeoutMs: 30_000,
    },
    suites: { publicWebScenarioIds: [], authenticatedWebScenarioIds: [], journeyIds: [] },
  }));
  await writeFile(path.join(cwd, '.qa-private', 'auth', 'gia-su-ai.json'), JSON.stringify({
    schemaVersion: 1,
    profileId: 'gia-su-ai',
    identityHash,
    verifiedAt: '2026-07-15T00:00:00.000Z',
    verifiedInFreshBrowser: true,
  }));
  await writeFile(path.join(cwd, '.qa-private', 'reset', 'gia-su-ai.json'), JSON.stringify({
    version: 1,
    mode: 'manual',
    expectedAccountIdentityHash: identityHash,
    allowedScopes: [scope],
  }));
  const result = await runConfiguredStagingReset(scope, {
    cwd,
    loadEnvFile: false,
    env: { QA_STAGING_BASE_URL: 'https://stage.example.test', QA_MANUAL_RESET_CONFIRMED: 'true' },
  });
  assert.equal(result.status, 'READY');
  assert.equal(result.accountIdentityHash, identityHash);
});

test('StudentBrain action contract cannot invoke reset', () => {
  assert.equal(studentActionSchema.safeParse({ action: 'reset', scope }).success, false);
});
