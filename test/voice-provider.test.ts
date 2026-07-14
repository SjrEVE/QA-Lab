import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createDeterministicWav, DeterministicWavVoiceProvider, inspectWav, MockSilentVoiceProvider, TextOnlyVoiceProvider, voiceEnabled } from '../src/voice-provider.js';
import { VoiceBridge } from '../src/voice-bridge.js';

const request = { schemaVersion: 1 as const, turn: 1, text: 'Con chọn một phần hai.', locale: 'vi-VN', output: { format: 'wav' as const, sampleRateHz: 16_000, channels: 1 as const } };
const fixtureRouting = { platform: 'win32' as const, available: false, backend: null, pactlAvailable: false, sinksReady: false, studentMonitorReady: false, tutorMonitorReady: false, echoIsolated: false, reason: 'fixture host has no native routing', evidence: ['fixture'] };

test('VoiceRequest provider contract produces valid deterministic PCM WAV with exact duration', async () => {
  const artifact = await new DeterministicWavVoiceProvider(500).synthesize(request);
  assert.equal(artifact.state, 'available'); assert.ok(artifact.bytes);
  assert.deepEqual(inspectWav(artifact.bytes), { valid: true, sampleRateHz: 16_000, channels: 1, durationMs: 500, dataBytes: 16_000 });
  assert.deepEqual(artifact.bytes, createDeterministicWav(500));
});

test('silent/text providers never claim audio and feature flag defaults off', async () => {
  for (const provider of [new MockSilentVoiceProvider(), new TextOnlyVoiceProvider()]) {
    const artifact = await provider.synthesize(request); assert.equal(artifact.state, 'unavailable'); assert.equal(artifact.bytes, null); assert.equal(artifact.durationMs, null);
  }
  assert.equal(voiceEnabled({}), false); assert.equal(voiceEnabled({ QA_ENABLE_VOICE: 'true' }), true); assert.equal(voiceEnabled({ QA_ENABLE_VOICE: '1' }), false);
});

test('one-turn and multi-turn deterministic paths are capability-gated and write redacted metadata', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'qa-voice-'));
  const bridge = new VoiceBridge({ enabled: true, provider: new DeterministicWavVoiceProvider(100), routing: fixtureRouting, allowDeterministicFixture: true, artifactDirectory: root });
  const one = await bridge.runTurn({ turn: 1, text: 'token=child-secret câu trả lời' }); assert.equal(one.mode, 'voice'); assert.doesNotMatch(one.text, /child-secret/);
  const many = await bridge.runTurns([{ turn: 2, text: 'hai' }, { turn: 3, text: 'ba' }]); assert.deepEqual(many.map((item) => item.mode), ['voice', 'voice']);
  const metadata = await readFile(path.join(root, 'audio', 'student-turn-01.wav.json'), 'utf8'); assert.doesNotMatch(metadata, /child-secret/); assert.match(metadata, /synthetic/);
});

test('native unavailable and provider failure preserve text fallback without fake audio claim', async () => {
  const blocked = new VoiceBridge({ enabled: true, provider: new DeterministicWavVoiceProvider(), routing: fixtureRouting });
  assert.equal((await blocked.runTurn({ turn: 1, text: 'vẫn gửi text' })).mode, 'text-fallback');
  const failing = new VoiceBridge({ enabled: true, provider: { name: 'failing', synthesize: () => Promise.reject(new Error('secret token=abc')) }, routing: { ...fixtureRouting, available: true } });
  const result = await failing.runTurn({ turn: 1, text: 'text survives' }); assert.equal(result.mode, 'text-fallback'); assert.equal(result.artifact.state, 'unavailable'); assert.equal(result.artifact.mediaType, null);
});
