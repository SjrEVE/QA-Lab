export const LIVE_DEMO_TARGET_DURATION_MS = 300_000;
export const LIVE_DEMO_MINIMUM_VIDEO_DURATION_MS = 280_000;
export const LIVE_DEMO_MAXIMUM_VIDEO_DURATION_MS = 330_000;
export const LIVE_DEMO_MINIMUM_AUDIO_COVERAGE_RATIO = 0.8;
export const LIVE_DEMO_MAXIMUM_AUDIO_COVERAGE_RATIO = 1.1;

export type LiveDemoProfileKey = 'talk' | 'stuck' | 'unsure';

export interface LiveDemoProfile {
  readonly key: LiveDemoProfileKey;
  readonly label: string;
  readonly lessonId: string;
  readonly lessonLabel: string;
  readonly openingIntentLabel: string;
  readonly openingIntentSelector: `[data-qa="opening-intent-${LiveDemoProfileKey}"]`;
  readonly minimumStudentTurns: 8;
  readonly visualRequestTurn: number | null;
  readonly visualRequestSuffix: string | null;
}

export const LIVE_DEMO_PROFILES: Readonly<Record<LiveDemoProfileKey, LiveDemoProfile>> = Object.freeze({
  talk: {
    key: 'talk',
    label: 'conversation-first-integrals',
    lessonId: 'G12_MATH_KNTT_CH04_L12',
    lessonLabel: 'Bài 12. Tích phân',
    openingIntentLabel: 'Cứ nói chuyện trước',
    openingIntentSelector: '[data-qa="opening-intent-talk"]',
    minimumStudentTurns: 8,
    visualRequestTurn: null,
    visualRequestSuffix: null,
  },
  stuck: {
    key: 'stuck',
    label: 'stuck-on-derivatives',
    lessonId: 'G12_MATH_KNTT_CH01_L01',
    lessonLabel: 'Bài 1. Tính đơn điệu và cực trị của hàm số',
    openingIntentLabel: 'Con có bài đang bí',
    openingIntentSelector: '[data-qa="opening-intent-stuck"]',
    minimumStudentTurns: 8,
    visualRequestTurn: 3,
    visualRequestSuffix: 'Gia sư minh họa bước này trên bảng giúp con nhé.',
  },
  unsure: {
    key: 'unsure',
    label: 'unsure-function-graph',
    lessonId: 'G12_MATH_KNTT_CH01_L04',
    lessonLabel: 'Bài 4. Khảo sát sự biến thiên và vẽ đồ thị hàm số',
    openingIntentLabel: 'Con chưa biết bắt đầu',
    openingIntentSelector: '[data-qa="opening-intent-unsure"]',
    minimumStudentTurns: 8,
    visualRequestTurn: 2,
    visualRequestSuffix: 'Gia sư vẽ hoặc minh họa ý này trên bảng giúp con nhé.',
  },
});

export interface ResponsePlaybackResult {
  readonly outcome: string;
  readonly completionReason: string;
  readonly epoch: number;
  readonly expectedAudio: boolean;
  readonly outputTextCharacters: number;
  readonly outputWordCount: number;
  readonly outputSentenceCount: number;
  readonly outputEndsWithSentenceBoundary: boolean;
  readonly outputHardTruncated: boolean;
  readonly outputTranscriptionFinished: boolean;
  readonly transcriptionCompletionInferred: boolean;
  readonly scheduledChunks: number;
  readonly naturallyEndedChunks: number;
  readonly stoppedChunks: number;
  readonly decodeFailedChunks: number;
  readonly pendingChunks: number;
  readonly scheduledAudioMs: number;
  readonly naturallyEndedAudioMs: number;
  readonly pcmSampleCount: number;
  readonly pcmPeakAmplitude: number;
  readonly pcmRmsAmplitude: number;
  readonly pcmNonSilentSampleRatio: number;
  readonly maxInternalSilenceMs: number;
  readonly pcmQualitySuspicious: boolean;
  readonly playbackGapMs: number;
  readonly largestPlaybackGapMs: number;
  readonly playbackGapSuspicious: boolean;
  readonly generationComplete: boolean;
  readonly turnComplete: boolean;
  readonly interrupted: boolean;
  readonly explicitlyStopped: boolean;
  readonly transcriptionTimedOut: boolean;
  readonly audioCoverageSuspicious: boolean;
}

const PLAYBACK_MARKER = 'response_playback_result';
const VISUAL_REQUEST = /\b(?:bảng|vẽ|đồ thị|hình|minh họa|trực quan|biểu diễn)\b/iu;

const LATENCY_MARKERS = Object.freeze([
  'start_tap_to_audio_prepared_ms',
  'start_tap_to_lesson_session_ready_ms',
  'start_to_audio_context_ready_ms',
  'microphone_stream_ready_ms',
  'realtime_token_request_ms',
  'live_connect_call_ms',
  'provider_leg_connected_ms',
  'start_to_connected_ms',
  'opening_authorization_ms',
  'speech_end_to_first_ai_audio_ms',
] as const);

export type ProductLatencyMarker = typeof LATENCY_MARKERS[number];
export interface ProductLatencyTelemetry {
  readonly scalarMs: Readonly<Partial<Record<ProductLatencyMarker, readonly number[]>>>;
  readonly voiceBreakdowns: readonly Readonly<Record<string, number>>[];
}

function objectRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function parseJsonTail(line: string, marker: string): Record<string, unknown> | undefined {
  const markerIndex = line.indexOf(marker);
  if (markerIndex < 0) return undefined;
  const tail = line.slice(markerIndex + marker.length);
  const jsonStart = tail.indexOf('{');
  if (jsonStart < 0) return undefined;
  try { return objectRecord(JSON.parse(tail.slice(jsonStart)) as unknown); }
  catch { return undefined; }
}

function requiredNumber(source: Record<string, unknown>, key: keyof ResponsePlaybackResult): number {
  const value = source[key];
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) throw new Error(`Playback result has invalid ${key}.`);
  return value;
}

function requiredBoolean(source: Record<string, unknown>, key: keyof ResponsePlaybackResult): boolean {
  const value = source[key];
  if (typeof value !== 'boolean') throw new Error(`Playback result has invalid ${key}.`);
  return value;
}

export function parseResponsePlaybackResult(line: string): ResponsePlaybackResult | null {
  if (!line.includes(PLAYBACK_MARKER)) return null;
  const source = parseJsonTail(line, PLAYBACK_MARKER);
  if (!source) throw new Error('Playback result console event did not contain valid JSON.');
  if (typeof source.outcome !== 'string' || !source.outcome) throw new Error('Playback result has invalid outcome.');
  if (typeof source.completionReason !== 'string' || !source.completionReason) throw new Error('Playback result has invalid completionReason.');
  return {
    outcome: source.outcome,
    completionReason: source.completionReason,
    epoch: requiredNumber(source, 'epoch'),
    expectedAudio: requiredBoolean(source, 'expectedAudio'),
    outputTextCharacters: requiredNumber(source, 'outputTextCharacters'),
    outputWordCount: requiredNumber(source, 'outputWordCount'),
    outputSentenceCount: requiredNumber(source, 'outputSentenceCount'),
    outputEndsWithSentenceBoundary: requiredBoolean(source, 'outputEndsWithSentenceBoundary'),
    outputHardTruncated: requiredBoolean(source, 'outputHardTruncated'),
    outputTranscriptionFinished: requiredBoolean(source, 'outputTranscriptionFinished'),
    transcriptionCompletionInferred: requiredBoolean(source, 'transcriptionCompletionInferred'),
    scheduledChunks: requiredNumber(source, 'scheduledChunks'),
    naturallyEndedChunks: requiredNumber(source, 'naturallyEndedChunks'),
    stoppedChunks: requiredNumber(source, 'stoppedChunks'),
    decodeFailedChunks: requiredNumber(source, 'decodeFailedChunks'),
    pendingChunks: requiredNumber(source, 'pendingChunks'),
    scheduledAudioMs: requiredNumber(source, 'scheduledAudioMs'),
    naturallyEndedAudioMs: requiredNumber(source, 'naturallyEndedAudioMs'),
    pcmSampleCount: requiredNumber(source, 'pcmSampleCount'),
    pcmPeakAmplitude: requiredNumber(source, 'pcmPeakAmplitude'),
    pcmRmsAmplitude: requiredNumber(source, 'pcmRmsAmplitude'),
    pcmNonSilentSampleRatio: requiredNumber(source, 'pcmNonSilentSampleRatio'),
    maxInternalSilenceMs: requiredNumber(source, 'maxInternalSilenceMs'),
    pcmQualitySuspicious: requiredBoolean(source, 'pcmQualitySuspicious'),
    playbackGapMs: requiredNumber(source, 'playbackGapMs'),
    largestPlaybackGapMs: requiredNumber(source, 'largestPlaybackGapMs'),
    playbackGapSuspicious: requiredBoolean(source, 'playbackGapSuspicious'),
    generationComplete: requiredBoolean(source, 'generationComplete'),
    turnComplete: requiredBoolean(source, 'turnComplete'),
    interrupted: requiredBoolean(source, 'interrupted'),
    explicitlyStopped: requiredBoolean(source, 'explicitlyStopped'),
    transcriptionTimedOut: requiredBoolean(source, 'transcriptionTimedOut'),
    audioCoverageSuspicious: requiredBoolean(source, 'audioCoverageSuspicious'),
  };
}

export function assertCompleteResponsePlayback(result: ResponsePlaybackResult, label: string): void {
  const failures: string[] = [];
  if (result.outcome !== 'complete') failures.push(`outcome=${result.outcome}`);
  if (!result.expectedAudio) failures.push('expectedAudio=false');
  if (result.outputTextCharacters < 1 || result.outputWordCount < 1 || result.outputSentenceCount < 1) failures.push('missing-output-transcription');
  if (!result.outputEndsWithSentenceBoundary) failures.push('missing-sentence-boundary');
  if (result.outputHardTruncated) failures.push('hard-truncation');
  if (!result.outputTranscriptionFinished && !result.transcriptionCompletionInferred) failures.push('transcription-unfinished');
  if (result.transcriptionCompletionInferred && (!result.transcriptionTimedOut || result.outputTranscriptionFinished)) failures.push('invalid-transcription-inference');
  if (result.scheduledChunks < 1 || result.scheduledAudioMs < 1) failures.push('missing-scheduled-audio');
  if (result.naturallyEndedChunks !== result.scheduledChunks) failures.push(`natural-chunks=${result.naturallyEndedChunks}/${result.scheduledChunks}`);
  if (result.stoppedChunks > 0) failures.push(`stopped-chunks=${result.stoppedChunks}`);
  if (result.decodeFailedChunks > 0) failures.push(`decode-failures=${result.decodeFailedChunks}`);
  if (result.pendingChunks > 0) failures.push(`pending-chunks=${result.pendingChunks}`);
  if (result.pcmSampleCount < 1) failures.push('missing-pcm-samples');
  if (result.pcmPeakAmplitude < 0.001) failures.push(`pcm-peak=${result.pcmPeakAmplitude}`);
  if (result.pcmRmsAmplitude < 0.0001) failures.push(`pcm-rms=${result.pcmRmsAmplitude}`);
  if (result.pcmNonSilentSampleRatio < 0.005) failures.push(`pcm-non-silent-ratio=${result.pcmNonSilentSampleRatio}`);
  if (result.maxInternalSilenceMs > 1_500) failures.push(`internal-silence=${result.maxInternalSilenceMs}ms`);
  if (result.pcmQualitySuspicious) failures.push('suspicious-pcm-quality');
  if (result.playbackGapSuspicious) failures.push('suspicious-playback-gap');
  if (result.largestPlaybackGapMs > 120) failures.push(`largest-playback-gap=${result.largestPlaybackGapMs}ms`);
  if (result.playbackGapMs > 250) failures.push(`total-playback-gap=${result.playbackGapMs}ms`);
  if (!result.generationComplete) failures.push('generation-incomplete');
  if (!result.turnComplete) failures.push('turn-incomplete');
  if (result.interrupted) failures.push('interrupted');
  if (result.explicitlyStopped) failures.push('explicitly-stopped');
  if (result.transcriptionTimedOut && !result.transcriptionCompletionInferred) failures.push('transcription-timeout');
  if (result.audioCoverageSuspicious) failures.push('suspicious-audio-coverage');
  const minimumPlausibleAudioMs = result.outputWordCount > 0 ? (result.outputWordCount / 5) * 1_000 : 0;
  if (result.naturallyEndedAudioMs < minimumPlausibleAudioMs) failures.push(`implausible-speech-rate=${result.outputWordCount}/${result.naturallyEndedAudioMs}ms`);
  const coverage = result.scheduledAudioMs > 0 ? result.naturallyEndedAudioMs / result.scheduledAudioMs : 0;
  if (coverage < 0.97 || coverage > 1.03) failures.push(`audio-coverage=${coverage.toFixed(3)}`);
  if (failures.length > 0) throw new Error(`${label} audio playback is incomplete: ${failures.join(', ')}.`);
}

export function assertNoAudioPlaybackWatchdog(lines: readonly string[], label: string): void {
  if (lines.some((line) => line.includes('audio_playback_watchdog'))) {
    throw new Error(`${label} emitted audio_playback_watchdog.`);
  }
}

function scalarAfterMarker(line: string, marker: ProductLatencyMarker): number | undefined {
  const tail = line.slice(line.indexOf(marker) + marker.length);
  const direct = /^\s*[:=]?\s*(\d+(?:\.\d+)?)/u.exec(tail)?.[1];
  if (direct !== undefined) return Number(direct);
  const payload = parseJsonTail(line, marker);
  if (!payload) return undefined;
  for (const key of ['durationMs', 'latencyMs', 'elapsedMs', 'valueMs', marker]) {
    const value = payload[key];
    if (typeof value === 'number' && Number.isFinite(value) && value >= 0) return value;
  }
  return undefined;
}

export function collectProductLatencyTelemetry(lines: readonly string[]): ProductLatencyTelemetry {
  const scalars: Partial<Record<ProductLatencyMarker, number[]>> = {};
  const voiceBreakdowns: Array<Record<string, number>> = [];
  for (const line of lines) {
    for (const marker of LATENCY_MARKERS) {
      if (!line.includes(marker)) continue;
      const value = scalarAfterMarker(line, marker);
      if (value === undefined) continue;
      const samples = scalars[marker] ?? [];
      samples.push(value);
      scalars[marker] = samples;
    }
    if (!line.includes('voice_latency_breakdown')) continue;
    const payload = parseJsonTail(line, 'voice_latency_breakdown');
    if (!payload) continue;
    const numeric = Object.fromEntries(Object.entries(payload).filter((entry): entry is [string, number] => (
      /^[A-Za-z][A-Za-z0-9_]*Ms$/u.test(entry[0])
      && typeof entry[1] === 'number'
      && Number.isFinite(entry[1])
      && entry[1] >= 0
    )));
    if (Object.keys(numeric).length > 0) voiceBreakdowns.push(numeric);
  }
  return { scalarMs: scalars, voiceBreakdowns };
}

export function speechRequestsVisual(text: string): boolean {
  return VISUAL_REQUEST.test(text);
}

export function applyProfileVisualRequest(profile: LiveDemoProfile, turn: number, brainSpeech: string): string {
  const suffix = profile.visualRequestTurn === turn ? profile.visualRequestSuffix : null;
  if (!suffix || speechRequestsVisual(brainSpeech)) return brainSpeech;
  const maximumBaseLength = 280 - suffix.length - 1;
  const boundedBase = brainSpeech.trim().slice(0, maximumBaseLength).trimEnd();
  return `${boundedBase} ${suffix}`.trim();
}

export function parseRequestedProfiles(raw: string | undefined): readonly LiveDemoProfile[] {
  const normalized = raw?.trim().toLowerCase() || 'all';
  if (normalized === 'all') return [LIVE_DEMO_PROFILES.talk, LIVE_DEMO_PROFILES.stuck, LIVE_DEMO_PROFILES.unsure];
  if (normalized === 'talk' || normalized === 'stuck' || normalized === 'unsure') return [LIVE_DEMO_PROFILES[normalized]];
  throw new Error('QA_LIVE_DEMO_PROFILE must be talk, stuck, unsure, or all.');
}
