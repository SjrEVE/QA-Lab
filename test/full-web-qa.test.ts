import assert from 'node:assert/strict';
import test from 'node:test';
import { executeFullWebModules, type FullWebModule } from '../src/full-web-qa.js';

test('full web plan executes fast gate before every journey', async () => {
  const called: string[] = [];
  const module = (id: string, phase: FullWebModule['phase']): FullWebModule => ({ id, phase, run: () => { called.push(id); return Promise.resolve({ status: 'PASSED' }); } });
  const result = await executeFullWebModules([module('public', 'fast-gate'), module('auth', 'fast-gate'), module('lesson', 'journey')]);
  assert.equal(result.status, 'PASSED');
  assert.deepEqual(called, ['public', 'auth', 'lesson']);
  assert.deepEqual(result.modules.map((item) => item.status), ['PASSED', 'PASSED', 'PASSED']);
});

test('full web plan stops before provider journeys after a failed fast gate', async () => {
  let journeyCalled = false;
  const modules: FullWebModule[] = [
    { id: 'public', phase: 'fast-gate', run: () => Promise.resolve({ status: 'FAILED', reason: 'console error' }) },
    { id: 'live', phase: 'journey', run: () => { journeyCalled = true; return Promise.resolve({ status: 'PASSED' }); } },
  ];
  const result = await executeFullWebModules(modules);
  assert.equal(result.status, 'FAILED');
  assert.equal(journeyCalled, false);
  assert.equal(result.modules[1]?.status, 'SKIPPED');
});

test('full web plan reports blocked prerequisites and skips remaining work', async () => {
  const result = await executeFullWebModules([
    { id: 'auth', phase: 'fast-gate', run: () => Promise.resolve({ status: 'BLOCKED', reason: 'profile unavailable' }) },
    { id: 'catalog', phase: 'fast-gate', run: () => Promise.resolve({ status: 'PASSED' }) },
  ]);
  assert.equal(result.status, 'BLOCKED');
  assert.deepEqual(result.modules.map((item) => item.status), ['BLOCKED', 'SKIPPED']);
});

test('full web plan continues independent journeys after one journey fails', async () => {
  const called: string[] = [];
  const result = await executeFullWebModules([
    { id: 'catalog', phase: 'fast-gate', run: () => Promise.resolve({ status: 'PASSED' }) },
    { id: 'live', phase: 'journey', run: () => Promise.resolve({ status: 'FAILED' }) },
    { id: 'self-study', phase: 'journey', run: () => { called.push('self-study'); return Promise.resolve({ status: 'PASSED' }); } },
  ]);
  assert.equal(result.status, 'FAILED');
  assert.deepEqual(called, ['self-study']);
  assert.deepEqual(result.modules.map((item) => item.status), ['PASSED', 'FAILED', 'PASSED']);
});
