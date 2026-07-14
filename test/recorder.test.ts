import assert from 'node:assert/strict';
import { access, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import type { Page } from 'playwright';
import { PlaywrightFfmpegRecorder, recordingEnabled, type Recorder, type RecorderCheckpoint, type RecorderPrepareOptions, type RecordingOutcome, type RecordingSummary } from '../src/recorder.js';

function fakePage(content = 'png'): Page { return { screenshot: async ({ path: target }: { path: string }) => { await writeFile(target, content); } } as unknown as Page; }

test('recorder lifecycle always writes screenshot timeline when FFmpeg is unavailable', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'qa-recorder-'));
  const recorder = new PlaywrightFfmpegRecorder(() => Promise.resolve({ available: false, command: 'missing', reason: 'not found' }));
  const prepared = await recorder.prepare({ artifactDirectory: root, enabled: true });
  assert.equal(prepared.state, 'blocked');
  await recorder.start(fakePage());
  const point = await recorder.checkpoint('safe checkpoint');
  assert.equal(point.sequence, 1);
  const stopped = await recorder.stop('FAIL');
  assert.equal(stopped.video, null);
  assert.match(stopped.limitations.join(' '), /FFmpeg unavailable/);
  assert.match(await readFile(path.join(root, 'recording-checkpoints.jsonl'), 'utf8'), /safe-checkpoint/);
  await access(path.join(root, point.screenshot));
  await recorder.cleanup();
  await recorder.cleanup();
});

test('safe default requires explicit exact true opt-in', () => {
  assert.equal(recordingEnabled({}), false);
  assert.equal(recordingEnabled({ QA_ENABLE_RECORDING: 'false' }), false);
  assert.equal(recordingEnabled({ QA_ENABLE_RECORDING: 'true' }), true);
  assert.equal(recordingEnabled({ QA_ENABLE_RECORDING: '1' }), false);
});

test('disabled recorder supports redacted checkpoints and idempotent partial cleanup', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'qa-recorder-'));
  const recorder = new PlaywrightFfmpegRecorder(() => Promise.resolve({ available: true, command: 'ffmpeg' }));
  const state = await recorder.prepare({ artifactDirectory: root, enabled: false });
  assert.equal(state.state, 'unavailable');
  await recorder.start(fakePage('visual fixture only'));
  await recorder.checkpoint('token=secret-value public ui');
  await recorder.cleanup('PARTIAL');
  await recorder.cleanup('PARTIAL');
  const timeline = await readFile(path.join(root, 'recording-checkpoints.jsonl'), 'utf8');
  assert.doesNotMatch(timeline, /secret-value/);
  assert.match(timeline, /REDACTED/);
});

test('lifecycle rejects checkpoint before start and repeated prepare', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'qa-recorder-'));
  const recorder = new PlaywrightFfmpegRecorder(() => Promise.resolve({ available: false, command: 'missing' }));
  await recorder.prepare({ artifactDirectory: root, enabled: true });
  await assert.rejects(recorder.checkpoint('too-early'), /started/);
  await assert.rejects(recorder.prepare({ artifactDirectory: root, enabled: true }), /already/);
  await recorder.cleanup();
});

export class SuccessfulMockRecorder implements Recorder {
  public readonly name = 'mock';
  private readonly value: RecordingSummary = { schemaVersion: 1, enabled: true, state: 'available', adapter: 'mock', video: 'session.mp4', checkpoints: 'recording-checkpoints.jsonl', limitations: ['fixture-only mock'], retained: true };
  public prepare(options: RecorderPrepareOptions) { void options; return Promise.resolve(this.value); }
  public start(page: Page) { void page; return Promise.resolve(); }
  public checkpoint(name: string): Promise<RecorderCheckpoint> { return Promise.resolve({ schemaVersion: 1, sequence: 1, timestampMs: 1, name, screenshot: 'screenshots/mock.png' }); }
  public stop(outcome: RecordingOutcome) { void outcome; return Promise.resolve(this.value); }
  public cleanup() { return Promise.resolve(); }
  public summary() { return this.value; }
}
