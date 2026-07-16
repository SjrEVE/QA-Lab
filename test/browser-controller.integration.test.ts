import assert from 'node:assert/strict';
import { access, mkdtemp, readFile, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { GuardedBrowserController } from '../src/browser-controller.js';
import { TargetDeniedError } from '../src/security.js';
import { startFixtureSite, type FixtureSite } from './fixture-site.js';

async function missing(target: string): Promise<boolean> {
  try { await access(target); return false; } catch { return true; }
}

async function createHarness(site: FixtureSite, root: string, id: string) {
  const artifactDirectory = path.join(root, `artifacts-${id}`);
  const profileDirectory = path.join(root, `profile-${id}`);
  const controller = new GuardedBrowserController({
    policy: { allowedHosts: ['unused.invalid'], fixtureMode: true, fixturePort: site.port },
    artifactDirectory,
    profileDirectory,
    timeoutMs: 5_000,
  });
  await controller.open();
  return { controller, artifactDirectory, profileDirectory };
}

test('fixture navigation creates a real screenshot and cleanup removes dedicated profile', async () => {
  const site = await startFixtureSite();
  const root = await mkdtemp(path.join(os.tmpdir(), 'qa-browser-'));
  const { controller, artifactDirectory, profileDirectory } = await createHarness(site, root, 'shot');
  try {
    await controller.perform({ type: 'navigate', url: `${site.origin}/ok` });
    const screenshot = await controller.perform({ type: 'screenshot', name: 'ok-page' });
    assert.equal(typeof screenshot, 'string');
    assert.ok((await stat(screenshot as string)).size > 100);
  } finally {
    await controller.close();
    await controller.close();
    await site.close();
  }
  assert.equal(await missing(profileDirectory), true);
  assert.equal((await readFile(path.join(artifactDirectory, 'browser-events.jsonl'), 'utf8')).includes('navigated'), true);
});

test('captures console errors and failed network requests in JSONL', async () => {
  const site = await startFixtureSite();
  const root = await mkdtemp(path.join(os.tmpdir(), 'qa-browser-'));
  const { controller, artifactDirectory } = await createHarness(site, root, 'events');
  try {
    await controller.navigate(`${site.origin}/console-error`);
    await controller.navigate(`${site.origin}/network-error`);
    await controller.perform({ type: 'wait', durationMs: 250 });
  } finally {
    await controller.close();
    await site.close();
  }
  const events = await readFile(path.join(artifactDirectory, 'browser-events.jsonl'), 'utf8');
  assert.match(events, /fixture console failure/);
  assert.match(events, /request-failed/);
  assert.match(events, /connection-reset/);
});

test('blocks an external redirect and records denial evidence', async () => {
  const site = await startFixtureSite();
  const root = await mkdtemp(path.join(os.tmpdir(), 'qa-browser-'));
  const { controller, artifactDirectory } = await createHarness(site, root, 'redirect');
  try {
    await assert.rejects(controller.navigate(`${site.origin}/redirect-external`));
  } finally {
    await controller.close();
    await site.close();
  }
  const events = await readFile(path.join(artifactDirectory, 'browser-events.jsonl'), 'utf8');
  assert.match(events, /request-denied/);
  assert.match(events, /example\.com/);
  assert.match(events, /redirect/);
});

test('profiles are isolated and runtime rejects direct external navigation before Playwright', async () => {
  const site = await startFixtureSite();
  const root = await mkdtemp(path.join(os.tmpdir(), 'qa-browser-'));
  const first = await createHarness(site, root, 'one');
  const second = await createHarness(site, root, 'two');
  try {
    assert.notEqual(first.profileDirectory, second.profileDirectory);
    await assert.rejects(first.controller.navigate('https://example.com/'), TargetDeniedError);
  } finally {
    await first.controller.close();
    await second.controller.close();
    await site.close();
  }
  assert.equal(await missing(first.profileDirectory), true);
  assert.equal(await missing(second.profileDirectory), true);
});

test('injects an App Check debug token before navigation without persisting it to browser events', async () => {
  const site = await startFixtureSite();
  const root = await mkdtemp(path.join(os.tmpdir(), 'qa-browser-'));
  const token = 'd9428888-122b-4a8b-a75a-9acb8b6b7312';
  const artifactDirectory = path.join(root, 'artifacts-app-check');
  const controller = new GuardedBrowserController({
    policy: { allowedHosts: ['unused.invalid'], fixtureMode: true, fixturePort: site.port },
    artifactDirectory,
    profileDirectory: path.join(root, 'profile-app-check'),
    timeoutMs: 5_000,
    appCheckDebugToken: token,
  });
  try {
    await controller.open();
    await controller.navigate(`${site.origin}/ok`);
    assert.equal(await controller.runtime().page.evaluate(() => (
      globalThis as typeof globalThis & { FIREBASE_APPCHECK_DEBUG_TOKEN?: string }
    ).FIREBASE_APPCHECK_DEBUG_TOKEN), token);
  } finally {
    await controller.close();
    await site.close();
  }
  const events = await readFile(path.join(artifactDirectory, 'browser-events.jsonl'), 'utf8');
  assert.equal(events.includes(token), false);
});
