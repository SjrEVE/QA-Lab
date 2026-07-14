import assert from 'node:assert/strict';
import test from 'node:test';
import { chromiumVoiceOptions, createAudioRoutePlan, probeAudioRouting, validateAudioRoutePlan, type AudioCommandRunner } from '../src/audio-routing.js';

function runner(outputs: Record<string, string>): AudioCommandRunner { return (_command, args) => Promise.resolve({ code: 0, stdout: outputs[args.join(' ')] ?? '', stderr: '' }); }

test('routing plan isolates student/tutor paths and forbids echo links', () => {
  const plan = createAudioRoutePlan('pipewire-pulse'); validateAudioRoutePlan(plan);
  assert.equal(plan.chromiumMicrophoneSource, 'student_audio.monitor'); assert.equal(plan.tutorCaptureSource, 'tutor_audio.monitor');
  assert.ok(!plan.links.some((link) => link.from.includes('monitor')));
});

test('Linux Pulse/PipeWire capability requires both sinks, monitors, and no loopback', async () => {
  const good = await probeAudioRouting(runner({ info: 'Server Name: PulseAudio (on PipeWire 1.0)', 'list short sinks': '1\tstudent_audio\n2\ttutor_audio\n', 'list short sources': '3\tstudent_audio.monitor\n4\ttutor_audio.monitor\n', 'list short modules': '' }), 'linux');
  assert.equal(good.available, true); assert.equal(good.backend, 'pipewire-pulse'); assert.equal(good.echoIsolated, true);
  const loop = await probeAudioRouting(runner({ info: 'PulseAudio', 'list short sinks': '1\tstudent_audio\n2\ttutor_audio\n', 'list short sources': '3\tstudent_audio.monitor\n4\ttutor_audio.monitor\n', 'list short modules': '9 module-loopback source=tutor_audio.monitor sink=student_audio' }), 'linux');
  assert.equal(loop.available, false); assert.equal(loop.echoIsolated, false);
});

test('non-Linux probe is explicit BLOCKED evidence and runs no command', async () => {
  let calls = 0; const result = await probeAudioRouting(() => { calls += 1; return Promise.resolve({ code: 0, stdout: '', stderr: '' }); }, 'win32');
  assert.equal(result.available, false); assert.equal(result.pactlAvailable, false); assert.equal(calls, 0); assert.match(result.reason, /Linux/);
});

test('Chromium microphone permission/device fixture flags exist only when voice enabled', () => {
  assert.equal(chromiumVoiceOptions(false), undefined);
  const native = chromiumVoiceOptions(true); assert.deepEqual(native?.permissions, ['microphone']); assert.deepEqual(native?.args, ['--use-fake-ui-for-media-stream']); assert.equal(native?.syntheticFixture, false);
  const fixture = chromiumVoiceOptions(true, '/safe/fixture.wav'); assert.ok(fixture?.args.includes('--use-fake-device-for-media-stream')); assert.ok(fixture?.args.includes('--use-file-for-fake-audio-capture=/safe/fixture.wav')); assert.equal(fixture?.syntheticFixture, true);
});
