import assert from 'node:assert/strict';
import test from 'node:test';
import { scanText } from '../scripts/secret-scan.js';

test('detects realistic secrets without printing their values', () => {
  const secret = `ghp_${'A'.repeat(36)}`;
  const findings = scanText(`token=${secret}\n`, 'fixture.txt');
  assert.equal(findings.length, 1);
  assert.deepEqual(findings[0], { file: 'fixture.txt', line: 1, kind: 'GitHub token' });
  assert.equal(JSON.stringify(findings).includes(secret), false);
});

test('allows explicit placeholders and ordinary source text', () => {
  assert.deepEqual(scanText('API_KEY=your_api_key_here\nhost=staging-placeholder.invalid\n', '.env.example'), []);
  assert.deepEqual(scanText('const tokenCount = 20;\n', 'source.ts'), []);
});
