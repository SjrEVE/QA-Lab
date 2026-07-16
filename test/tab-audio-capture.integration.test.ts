import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { GuardedBrowserController } from '../src/browser-controller.js';
import { playEncodedAudioAudibly, scheduleEncodedAudioAudibly, startTabAudioCapture, stopTabAudioCapture } from '../src/tab-audio-capture.js';
import { createDeterministicWav } from '../src/voice-provider.js';
import { startFixtureSite } from './fixture-site.js';

test('captures audible Web Audio from the guarded browser tab without an OS loopback driver', async () => {
  const site = await startFixtureSite();
  const root = await mkdtemp(path.join(os.tmpdir(), 'qa-tab-audio-'));
  const controller = new GuardedBrowserController({
    policy: { allowedHosts: ['unused.invalid'], fixtureMode: true, fixturePort: site.port },
    artifactDirectory: path.join(root, 'artifacts'),
    profileDirectory: path.join(root, 'profile'),
    captureTabAudio: true,
    voice: { enabled: true, audible: true },
  });

  try {
    await controller.open();
    await controller.navigate(`${site.origin}/ok`);
    const page = controller.runtime().page;
    await startTabAudioCapture(page);
    const playback = await playEncodedAudioAudibly(page, createDeterministicWav(450), 'audio/mpeg');
    assert.ok(playback.durationMs >= 300);
    const captures = await stopTabAudioCapture(page);
    assert.ok(captures.length >= 1);
    const capture = captures[0];
    assert.ok(capture);
    assert.ok(capture.bytes.byteLength >= 1_024);
    assert.ok(capture.durationMs >= 300);
  } finally {
    await controller.close();
    await site.close();
  }
});

test('schedules encoded audio immediately and captures every AudioContext track', async () => {
  const site = await startFixtureSite();
  const root = await mkdtemp(path.join(os.tmpdir(), 'qa-tab-audio-'));
  const controller = new GuardedBrowserController({
    policy: { allowedHosts: ['unused.invalid'], fixtureMode: true, fixturePort: site.port },
    artifactDirectory: path.join(root, 'artifacts'),
    profileDirectory: path.join(root, 'profile'),
    captureTabAudio: true,
    voice: { enabled: true, audible: true },
  });

  try {
    await controller.open();
    await controller.navigate(`${site.origin}/ok`);
    const page = controller.runtime().page;
    await startTabAudioCapture(page);
    const startedAt = Date.now();
    const playback = await scheduleEncodedAudioAudibly(page, createDeterministicWav(450), 'audio/mpeg');
    assert.ok(Date.now() - startedAt < 1_000);
    assert.ok(playback.decodedDurationMs > 300);

    await page.evaluate(String.raw`(async () => {
      for (const [frequency, delayMs] of [[440, 0], [660, 120]]) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
        const context = new AudioContext();
        const oscillator = context.createOscillator();
        const gain = context.createGain();
        oscillator.frequency.value = frequency;
        gain.gain.value = 0.02;
        oscillator.connect(gain);
        gain.connect(context.destination);
        oscillator.start();
        oscillator.stop(context.currentTime + 0.3);
        await new Promise((resolve) => { oscillator.onended = resolve; });
        await context.close();
      }
    })()`);
    await page.waitForTimeout(playback.decodedDurationMs + 100);

    const captures = await stopTabAudioCapture(page);
    assert.ok(captures.length >= 3, `Expected QA playback plus two page AudioContexts, received ${captures.length}.`);
    assert.ok(captures.every((capture) => capture.bytes.byteLength > 100));
    assert.ok(captures.some((capture) => capture.offsetMs >= 80));
  } finally {
    await controller.close();
    await site.close();
  }
});
