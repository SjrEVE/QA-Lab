import assert from 'node:assert/strict';
import test from 'node:test';
import { assertAllowedBrowserUrl, decideBrowserRequest } from '../src/browser-policy.js';
import { TargetDeniedError } from '../src/security.js';

test('staging policy accepts exact HTTPS host and WSS only', () => {
  const policy = { allowedHosts: ['staging.example.test'] };
  assert.equal(assertAllowedBrowserUrl('https://staging.example.test/ok', policy).hostname, 'staging.example.test');
  assert.equal(assertAllowedBrowserUrl('wss://staging.example.test/socket', policy).protocol, 'https:');
  for (const url of [
    'http://staging.example.test/ok',
    'https://evil-staging.example.test/ok',
    'https://staging.example.test.evil.test/ok',
    'https://user:pass@staging.example.test/ok',
    'ws://staging.example.test/socket',
  ]) assert.throws(() => assertAllowedBrowserUrl(url, policy), TargetDeniedError);
});

test('fixture policy is explicit, loopback-only, and port-exact', () => {
  const policy = { allowedHosts: ['unused.invalid'], fixtureMode: true, fixturePort: 3210 } as const;
  assert.equal(assertAllowedBrowserUrl('http://127.0.0.1:3210/ok', policy).pathname, '/ok');
  assert.equal(assertAllowedBrowserUrl('http://localhost:3210/ok', policy).pathname, '/ok');
  for (const url of [
    'https://127.0.0.1:3210/ok',
    'http://127.0.0.1:3211/ok',
    'http://example.com:3210/ok',
  ]) assert.throws(() => assertAllowedBrowserUrl(url, policy), TargetDeniedError);
});

test('policy decision retains denied resource kind as evidence', () => {
  const decision = decideBrowserRequest('https://example.com/x', 'redirect', { allowedHosts: ['staging.example.test'] });
  assert.equal(decision.allowed, false);
  assert.equal(decision.kind, 'redirect');
  assert.match(decision.reason, /exact staging allowlist/);
});
