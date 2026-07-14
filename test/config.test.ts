import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { loadConfig, qaConfigSchema } from '../src/config.js';

const valid = { version: 1, environment: 'staging', staging: { allowedHosts: ['stage.example.test'] }, artifacts: { root: 'runs' }, logging: { level: 'info' } };

test('parses strict versioned config', () => {
  assert.equal(qaConfigSchema.parse(valid).version, 1);
  assert.throws(() => qaConfigSchema.parse({ ...valid, version: 2 }));
  assert.throws(() => qaConfigSchema.parse({ ...valid, unexpected: true }));
  assert.throws(() => qaConfigSchema.parse({ ...valid, staging: { allowedHosts: [] } }));
});

test('loads YAML and applies typed environment overrides', async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), 'qa-config-'));
  await mkdir(path.join(cwd, 'config'));
  await writeFile(path.join(cwd, 'config', 'qa-lab.yaml'), 'version: 1\nenvironment: staging\nstaging:\n  allowedHosts: [base.example.test]\nartifacts:\n  root: runs\nlogging:\n  level: info\n');
  const config = await loadConfig({ cwd, loadEnvFile: false, env: { QA_STAGING_BASE_URL: 'https://ONE.example.test', QA_STAGING_ALLOWED_HOSTS: 'ONE.example.test,two.example.test', QA_ARTIFACT_ROOT: 'evidence' } });
  assert.deepEqual(config.staging.allowedHosts, ['one.example.test', 'two.example.test']);
  assert.equal(config.staging.baseUrl, 'https://ONE.example.test');
  assert.equal(config.artifacts.root, 'evidence');
});

test('rejects schemes, ports, paths, and localhost in configured hosts', () => {
  for (const host of ['https://stage.example.test', 'stage.example.test:443', 'stage.example.test/path', 'localhost']) {
    assert.throws(() => qaConfigSchema.parse({ ...valid, staging: { allowedHosts: [host] } }));
  }
});

test('staging base URL is HTTPS, origin-only, and on the exact configured allowlist', async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), 'qa-config-'));
  await mkdir(path.join(cwd, 'config'));
  await writeFile(path.join(cwd, 'config', 'qa-lab.yaml'), 'version: 1\nenvironment: staging\nstaging:\n  allowedHosts: [stage.example.test]\nartifacts:\n  root: runs\nlogging:\n  level: info\n');
  for (const baseUrl of [
    'http://stage.example.test',
    'https://stage.example.test/path',
    'https://stage.example.test?query=1',
    'https://stage.example.test.evil.test',
  ]) {
    await assert.rejects(loadConfig({ cwd, loadEnvFile: false, env: { QA_STAGING_BASE_URL: baseUrl } }));
  }
});
