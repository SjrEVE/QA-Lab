import assert from 'node:assert/strict';
import test from 'node:test';
import { createLogger } from '../src/logger.js';
import { REDACTED, redactSecrets } from '../src/redaction.js';

test('recursively redacts sensitive keys and inline tokens', () => {
  const input = { password: 'hunter2', nested: [{ authorization: 'Bearer abc.def' }, 'token=plain'], safe: 'visible' };
  const output = redactSecrets(input) as Record<string, unknown>;
  assert.equal(output.password, REDACTED);
  assert.equal(output.safe, 'visible');
  assert.equal(JSON.stringify(output).includes('hunter2'), false);
  assert.equal(JSON.stringify(output).includes('abc.def'), false);
  assert.equal(JSON.stringify(output).includes('plain'), false);
});

test('handles circular objects without leaking', () => {
  const value: Record<string, unknown> = { apiKey: 'sensitive' };
  value.self = value;
  assert.doesNotThrow(() => JSON.stringify(redactSecrets(value)));
});

test('structured logger emits valid redacted JSON', () => {
  const lines: string[] = [];
  createLogger((line) => lines.push(line)).info('test.event', { secret: 'nope', ok: true });
  const parsed = JSON.parse(lines[0] ?? '{}') as { event: string; data: { secret: string; ok: boolean } };
  assert.equal(parsed.event, 'test.event');
  assert.equal(parsed.data.secret, REDACTED);
  assert.equal(parsed.data.ok, true);
});
