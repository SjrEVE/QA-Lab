import assert from 'node:assert/strict';
import { mkdir, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { PlaywrightAuthBrowserLauncher, type AuthBrowserSession } from '../src/auth-bootstrap.js';
import { startFixtureSite } from './fixture-site.js';

test('persistent Chromium profile restores an authenticated cookie in a fresh browser process', async () => {
  const site = await startFixtureSite();
  const profileDirectory = path.join(await mkdtemp(path.join(tmpdir(), 'qa-auth-profile-')), 'profile');
  await mkdir(profileDirectory);
  const launcher = new PlaywrightAuthBrowserLauncher();
  const options = {
    profileDirectory,
    policy: { allowedHosts: ['unused.invalid'], fixtureMode: true, fixturePort: site.port },
    timeoutMs: 5_000,
    headed: false,
  } as const;
  let bootstrap: AuthBrowserSession | undefined;
  let verification: AuthBrowserSession | undefined;
  try {
    bootstrap = await launcher.launch(options);
    await bootstrap.navigate(`${site.origin}/auth/bootstrap`);
    await bootstrap.waitForVisible('[data-qa="authenticated-shell"]');
    assert.equal(await bootstrap.readIdentity('[data-qa="account-email"]', 'textContent'), 'qa-student@example.test');
    await bootstrap.close();
    bootstrap = undefined;

    verification = await launcher.launch(options);
    await verification.navigate(`${site.origin}/auth/app`);
    await verification.waitForVisible('[data-qa="authenticated-shell"]');
    assert.equal(await verification.readIdentity('[data-qa="account-email"]', 'data-email'), 'qa-student@example.test');
    await verification.close();
    verification = undefined;
  } finally {
    await bootstrap?.close();
    await verification?.close();
    await site.close();
  }
});
