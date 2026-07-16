import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  applyProfileVisualRequest,
  assertCompleteResponsePlayback,
  assertNoAudioPlaybackWatchdog,
  collectProductLatencyTelemetry,
  LIVE_DEMO_MAXIMUM_VIDEO_DURATION_MS,
  LIVE_DEMO_MINIMUM_VIDEO_DURATION_MS,
  LIVE_DEMO_PROFILES,
  LIVE_DEMO_TARGET_DURATION_MS,
  parseRequestedProfiles,
  parseResponsePlaybackResult,
  speechRequestsVisual,
  type ResponsePlaybackResult,
} from '../src/live-demo-contract.js';

const completePlayback: ResponsePlaybackResult = {
  outcome: 'complete',
  completionReason: 'generation-and-turn-complete',
  epoch: 4,
  expectedAudio: true,
  outputTextCharacters: 82,
  outputWordCount: 17,
  outputSentenceCount: 2,
  outputEndsWithSentenceBoundary: true,
  outputHardTruncated: false,
  outputTranscriptionFinished: true,
  scheduledChunks: 18,
  naturallyEndedChunks: 18,
  stoppedChunks: 0,
  decodeFailedChunks: 0,
  pendingChunks: 0,
  scheduledAudioMs: 4_250,
  naturallyEndedAudioMs: 4_250,
  playbackGapMs: 42,
  largestPlaybackGapMs: 24,
  playbackGapSuspicious: false,
  generationComplete: true,
  turnComplete: true,
  interrupted: false,
  explicitlyStopped: false,
  transcriptionTimedOut: false,
  audioCoverageSuspicious: false,
};

test('three five-minute profiles use distinct approved Grade 12 lessons and exact opening selectors', () => {
  assert.equal(LIVE_DEMO_TARGET_DURATION_MS, 300_000);
  assert.equal(LIVE_DEMO_MINIMUM_VIDEO_DURATION_MS, 280_000);
  assert.equal(LIVE_DEMO_MAXIMUM_VIDEO_DURATION_MS, 330_000);
  const profiles = parseRequestedProfiles('all');
  assert.deepEqual(profiles.map((profile) => profile.key), ['talk', 'stuck', 'unsure']);
  assert.equal(new Set(profiles.map((profile) => profile.lessonId)).size, 3);
  assert.ok(profiles.every((profile) => profile.lessonId.startsWith('G12_MATH_KNTT_')));
  assert.deepEqual(profiles.map((profile) => profile.openingIntentSelector), [
    '[data-qa="opening-intent-talk"]',
    '[data-qa="opening-intent-stuck"]',
    '[data-qa="opening-intent-unsure"]',
  ]);
  assert.equal(parseRequestedProfiles('stuck')[0], LIVE_DEMO_PROFILES.stuck);
  assert.throws(() => parseRequestedProfiles('random'), /must be talk, stuck, unsure, or all/);
});

test('response playback parser accepts only the product JSON event shape', () => {
  const parsed = parseResponsePlaybackResult(`[realtime-demo] response_playback_result ${JSON.stringify(completePlayback)}`);
  assert.deepEqual(parsed, completePlayback);
  assert.equal(parseResponsePlaybackResult('[realtime-demo] speech_end_to_first_ai_audio_ms 1200'), null);
  assert.throws(() => parseResponsePlaybackResult('[realtime-demo] response_playback_result nope'), /valid JSON/);
  assert.doesNotThrow(() => assertCompleteResponsePlayback(completePlayback, 'turn 1'));
});

test('audio acceptance rejects missing endings, stop, interruption, decode failure and suspicious coverage', () => {
  const failures: Array<[Partial<ResponsePlaybackResult>, RegExp]> = [
    [{ outcome: 'incomplete' }, /outcome=incomplete/],
    [{ outputEndsWithSentenceBoundary: false }, /missing-sentence-boundary/],
    [{ outputHardTruncated: true }, /hard-truncation/],
    [{ naturallyEndedChunks: 17 }, /natural-chunks=17\/18/],
    [{ stoppedChunks: 1 }, /stopped-chunks=1/],
    [{ interrupted: true }, /interrupted/],
    [{ explicitlyStopped: true }, /explicitly-stopped/],
    [{ decodeFailedChunks: 1 }, /decode-failures=1/],
    [{ pendingChunks: 1 }, /pending-chunks=1/],
    [{ playbackGapSuspicious: true }, /suspicious-playback-gap/],
    [{ largestPlaybackGapMs: 121 }, /largest-playback-gap=121ms/],
    [{ playbackGapMs: 251 }, /total-playback-gap=251ms/],
    [{ audioCoverageSuspicious: true }, /suspicious-audio-coverage/],
    [{ naturallyEndedAudioMs: 2_000 }, /audio-coverage=/],
  ];
  for (const [change, expected] of failures) {
    assert.throws(() => assertCompleteResponsePlayback({ ...completePlayback, ...change }, 'tutor turn'), expected);
  }
  assert.doesNotThrow(() => assertNoAudioPlaybackWatchdog(['[realtime-demo] response_playback_result {}'], 'session'));
  assert.throws(() => assertNoAudioPlaybackWatchdog(['[realtime-demo] audio_playback_watchdog {"epoch":3}'], 'session'), /audio_playback_watchdog/);
});

test('latency telemetry separates startup scalars and per-turn provider breakdown', () => {
  const telemetry = collectProductLatencyTelemetry([
    '[realtime-demo] realtime_token_request_ms 420',
    '[realtime-demo] start_to_connected_ms {"durationMs":980}',
    '[realtime-demo] speech_end_to_first_ai_audio_ms 1350',
    '[realtime-demo] voice_latency_breakdown {"speechToToolMs":120,"toolToResponseMs":340,"responseToAudioMs":890,"ignored":"text"}',
  ]);
  assert.deepEqual(telemetry.scalarMs.realtime_token_request_ms, [420]);
  assert.deepEqual(telemetry.scalarMs.start_to_connected_ms, [980]);
  assert.deepEqual(telemetry.scalarMs.speech_end_to_first_ai_audio_ms, [1_350]);
  assert.deepEqual(telemetry.voiceBreakdowns, [{ speechToToolMs: 120, toolToResponseMs: 340, responseToAudioMs: 890 }]);
});

test('board is requested only on the profile turn that asks for a visual', () => {
  const ordinary = 'Con chưa hiểu bước này, gia sư giải thích chậm hơn giúp con nhé.';
  assert.equal(applyProfileVisualRequest(LIVE_DEMO_PROFILES.talk, 3, ordinary), ordinary);
  assert.equal(applyProfileVisualRequest(LIVE_DEMO_PROFILES.stuck, 2, ordinary), ordinary);
  const visual = applyProfileVisualRequest(LIVE_DEMO_PROFILES.stuck, 3, ordinary);
  assert.equal(speechRequestsVisual(ordinary), false);
  assert.equal(speechRequestsVisual(visual), true);
  assert.ok(visual.length <= 280);
  assert.equal(applyProfileVisualRequest(LIVE_DEMO_PROFILES.stuck, 3, 'Gia sư vẽ trên bảng giúp con nhé.'), 'Gia sư vẽ trên bảng giúp con nhé.');
});

test('runner locks real Brain, audible identical text, two-click stop and media acceptance', async () => {
  const source = await readFile('scripts/live-soak-record.ts', 'utf8');
  assert.match(source, /createConfiguredGeminiStudentBrain\(env, undefined, 'voice'\)/);
  assert.match(source, /scheduleEncodedAudioAudibly/);
  assert.match(source, /inputValue\(\) !== studentText/);
  assert.match(source, /endButton\.click\(\)[\s\S]+endButton\.click\(\)/);
  assert.match(source, /\/api\/endLessonSession/);
  assert.match(source, /response\.status\(\) !== 200/);
  assert.match(source, /assertVideoArtifact\(runDirectory, recording/);
  assert.match(source, /minimumAudioCoverageRatio: LIVE_DEMO_MINIMUM_AUDIO_COVERAGE_RATIO/);
  assert.match(source, /assertNoAudioPlaybackWatchdog\(completeSessionConsole/);
  assert.match(source, /rawTranscriptPersisted: false/);
  assert.match(source, /providerOutputPersisted: false/);
  assert.doesNotMatch(source, /QA_BRAIN_GEMINI_API_KEY\s*=/);
});
