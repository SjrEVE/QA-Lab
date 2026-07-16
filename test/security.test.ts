import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { assertAllowedStagingUrl, TargetDeniedError } from '../src/security.js';

const hosts = ['staging.example.test'];

test('allows HTTPS URL on exact configured host', () => {
  assert.equal(assertAllowedStagingUrl('https://staging.example.test/lesson?id=1', hosts).hostname, hosts[0]);
});

test('denies non-exact, insecure, credentialed, malformed, and alternate-port URLs', () => {
  const denied = [
    'http://staging.example.test',
    'https://evil-staging.example.test',
    'https://staging.example.test.evil.test',
    'https://user:pass@staging.example.test',
    'https://staging.example.test:444',
    '//staging.example.test',
    'not-a-url',
  ];
  for (const target of denied) assert.throws(() => assertAllowedStagingUrl(target, hosts), TargetDeniedError, target);
});

test('committed staging evidence manifest is sanitized and provenance-bounded', async () => {
  const raw = await readFile(new URL('../docs/evidence/GUIDED_SELF_STUDY_STAGING_MANIFEST.json', import.meta.url), 'utf8');
  const manifest = JSON.parse(raw) as {
    schemaVersion: number;
    target: { productDeploymentVersion: unknown; deploymentVersionStatus: string };
    privacy: Record<string, boolean>;
    runs: Array<{ qaCommitSha: string; packageFingerprint: string; artifactIntegrity: { treeDigest: string } }>;
    historicalPolicyBoundary: { currentPolicyRevalidationRequired: boolean };
  };
  assert.equal(manifest.schemaVersion, 1);
  assert.equal(manifest.target.productDeploymentVersion, null);
  assert.equal(manifest.target.deploymentVersionStatus, 'not-recorded-by-runner');
  assert.equal(Object.values(manifest.privacy).every((value) => value === false), true);
  assert.equal(manifest.runs.length, 2);
  for (const run of manifest.runs) {
    assert.match(run.qaCommitSha, /^[a-f0-9]{40}$/);
    assert.match(run.packageFingerprint, /^[a-f0-9]{64}$/);
    assert.match(run.artifactIntegrity.treeDigest, /^[a-f0-9]{64}$/);
  }
  assert.equal(manifest.historicalPolicyBoundary.currentPolicyRevalidationRequired, true);
  assert.doesNotMatch(raw, /@[a-z0-9.-]+|bearer\s|AIza|AQ\./i);
});
