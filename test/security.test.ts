import assert from 'node:assert/strict';
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
