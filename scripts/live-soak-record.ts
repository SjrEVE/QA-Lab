import { appendFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Page } from 'playwright';
import { hashAccountIdentity, loadAuthVerification, normalizeAccountEmail } from '../src/auth-bootstrap.js';
import { GuardedBrowserController, type BrowserEvent } from '../src/browser-controller.js';
import { loadConfig } from '../src/config.js';
import { EdgeTtsClient } from '../src/edge-tts.js';
import { createConfiguredGeminiStudentBrain, type GeminiStudentBrain } from '../src/gemini-student-brain.js';
import {
  applyProfileVisualRequest,
  assertCompleteResponsePlayback,
  assertNoAudioPlaybackWatchdog,
  collectProductLatencyTelemetry,
  LIVE_DEMO_MAXIMUM_AUDIO_COVERAGE_RATIO,
  LIVE_DEMO_MAXIMUM_VIDEO_DURATION_MS,
  LIVE_DEMO_MINIMUM_AUDIO_COVERAGE_RATIO,
  LIVE_DEMO_MINIMUM_VIDEO_DURATION_MS,
  LIVE_DEMO_TARGET_DURATION_MS,
  parseRequestedProfiles,
  parseResponsePlaybackResult,
  speechRequestsVisual,
  type LiveDemoProfile,
  type ProductLatencyTelemetry,
  type ResponsePlaybackResult,
} from '../src/live-demo-contract.js';
import { assertVideoArtifact, PlaywrightFfmpegRecorder, type RecordingSummary, type VideoArtifactInspection } from '../src/recorder.js';
import { redactSecrets } from '../src/redaction.js';
import { createRunId } from '../src/run-store.js';
import type { BrainTurn, StudentBrainDecision } from '../src/student-brain.js';
import { findStudentPersona, findStudentScenario, type StudentPersona, type StudentScenario } from '../src/student-contracts.js';
import { assertPrivatePath, loadStagingAppCheckDebugToken, loadStagingProfile, type StagingProfile } from '../src/staging-profile.js';
import { loadStagingResetConfig, StrictStagingResetAdapter, type StagingResetConfig } from '../src/staging-reset.js';
import { scheduleEncodedAudioAudibly } from '../src/tab-audio-capture.js';

const SCENARIO_ID = 'gia-su-ai-live-grade-12';
const RESET_SCOPE = 'live-lesson-matrix';
const TUTOR_TIMEOUT_MS = 90_000;
const FULL_HD = Object.freeze({ width: 1_920, height: 1_080 });

interface TurnMetric {
  readonly turn: number;
  readonly studentIntent: string;
  readonly studentCharacters: number;
  readonly brainDecisionMs: number;
  readonly ttsSynthesisMs: number;
  readonly studentAudioMs: number;
  readonly submitToTutorTextMs: number;
  readonly submitToPlaybackCompleteMs: number;
  readonly visualRequested: boolean;
  readonly boardEntriesBefore: number;
  readonly boardEntriesAfter: number;
  readonly boardVisible: boolean;
  readonly playback: ResponsePlaybackResult;
  readonly productLatency: ProductLatencyTelemetry;
}

interface DemoResult {
  readonly schemaVersion: 1;
  readonly runId: string;
  readonly status: 'PASSED' | 'FAILED';
  readonly profile: LiveDemoProfile['key'];
  readonly profileLabel: string;
  readonly lessonId: string;
  readonly lessonLabel: string;
  readonly openingIntent: string;
  readonly targetDurationMs: number;
  readonly measuredRunDurationMs: number;
  readonly targetHost: string;
  readonly syntheticOnly: true;
  readonly brain: { readonly name: string; readonly version: string };
  readonly studentInputMode: 'visible-audible-edge-tts-plus-identical-text-submit';
  readonly microphoneRecognitionTested: false;
  readonly rawAudioPersisted: false;
  readonly rawTranscriptPersisted: false;
  readonly providerOutputPersisted: false;
  readonly startupLatency: ProductLatencyTelemetry;
  readonly openingPlayback: ResponsePlaybackResult | null;
  readonly turns: readonly TurnMetric[];
  readonly sessionEndedByTwoClicks: boolean;
  readonly endLessonSessionStatus: number | null;
  readonly recording: RecordingSummary;
  readonly videoInspection: VideoArtifactInspection | null;
  readonly failureReason: unknown;
}

interface SharedRunContext {
  readonly cwd: string;
  readonly env: NodeJS.ProcessEnv;
  readonly config: Awaited<ReturnType<typeof loadConfig>>;
  readonly staging: StagingProfile;
  readonly verification: Awaited<ReturnType<typeof loadAuthVerification>>;
  readonly resetConfig: StagingResetConfig;
  readonly browserProfile: string;
  readonly appCheckDebugToken: string | undefined;
  readonly brain: GeminiStudentBrain;
  readonly persona: StudentPersona;
  readonly scenario: StudentScenario;
  readonly batchDirectory: string;
}

const sleep = (durationMs: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, durationMs));

function eventText(event: BrowserEvent): string {
  if (event.event !== 'console' || typeof event.data !== 'object' || event.data === null || !('text' in event.data)) return '';
  return String(event.data.text);
}

function consoleLines(events: readonly BrowserEvent[], startIndex = 0): string[] {
  return events.slice(startIndex).map(eventText).filter(Boolean);
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  return 'Unknown live demo failure.';
}

async function waitUntil(check: () => Promise<boolean> | boolean, timeoutMs: number, label: string): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return;
    await sleep(250);
  }
  throw new Error(`Timed out waiting for ${label}.`);
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs} ms.`)), timeoutMs);
  });
  try { return await Promise.race([promise, timeout]); }
  finally { if (timer) clearTimeout(timer); }
}

function playbackResults(events: readonly BrowserEvent[], startIndex: number): ResponsePlaybackResult[] {
  return consoleLines(events, startIndex).flatMap((line) => {
    const result = parseResponsePlaybackResult(line);
    return result ? [result] : [];
  });
}

async function waitForPlaybackResult(controller: GuardedBrowserController, startIndex: number, label: string): Promise<ResponsePlaybackResult> {
  await waitUntil(() => playbackResults(controller.runtime().events, startIndex).length > 0, TUTOR_TIMEOUT_MS, `${label} response_playback_result`);
  const result = playbackResults(controller.runtime().events, startIndex)[0];
  if (!result) throw new Error(`${label} response_playback_result disappeared.`);
  assertCompleteResponsePlayback(result, label);
  return result;
}

async function currentTutorText(page: Page): Promise<string> {
  const selectors = [
    '[data-qa="tutor-message"]:visible',
    '.activity-history article:has(span.ai) p',
    '[data-speaker="tutor"]:visible',
  ];
  for (const selector of selectors) {
    const locator = page.locator(selector).last();
    const value = (await locator.textContent().catch(() => ''))?.trim() ?? '';
    if (value) return value;
  }
  return '';
}

async function nextSpeakingDecision(decide: () => Promise<StudentBrainDecision>, page: Page): Promise<StudentBrainDecision> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const decision = await decide();
    const wait = decision.actions.find((action) => action.action === 'wait');
    if (!wait || wait.action !== 'wait') return decision;
    await page.waitForTimeout(wait.durationMs);
  }
  throw new Error('Real Gemini StudentBrain returned wait three times without producing a student turn.');
}

async function boardAudit(page: Page): Promise<{ entries: number; visible: boolean; focusedZones: number }> {
  const board = page.locator('.lesson-board-scene').first();
  return {
    entries: await board.locator('[data-stage-entry]').count(),
    visible: await board.isVisible().catch(() => false),
    focusedZones: await board.locator('.learning-stage-zone.is-focused').count(),
  };
}

async function endSessionWithTwoClicks(page: Page): Promise<number> {
  const endButton = page.locator('[data-qa="start-lesson"][data-session-control="stop"]:visible').first();
  await endButton.waitFor({ state: 'visible', timeout: 10_000 });
  let responseAfterFirstClick = false;
  const firstClickObserver = (response: { url(): string }): void => {
    if (response.url().includes('/api/endLessonSession')) responseAfterFirstClick = true;
  };
  page.on('response', firstClickObserver);
  await endButton.click();
  await page.waitForTimeout(500);
  page.off('response', firstClickObserver);
  if (responseAfterFirstClick) throw new Error('End session API fired on the first click; two-click confirmation was bypassed.');
  await endButton.waitFor({ state: 'visible', timeout: 5_000 });
  const endResponse = page.waitForResponse((response) => (
    response.url().includes('/api/endLessonSession') && response.request().method() === 'POST'
  ), { timeout: 30_000 });
  await endButton.click();
  const response = await endResponse;
  if (response.status() !== 200) throw new Error(`endLessonSession returned HTTP ${response.status()}.`);
  return response.status();
}

function updateBrainState(
  decision: StudentBrainDecision,
  usedBehaviors: string[],
  remainingGoals: string[],
): void {
  if (decision.usedBehavior && !usedBehaviors.includes(decision.usedBehavior)) usedBehaviors.push(decision.usedBehavior);
  for (const goal of decision.completedGoals ?? []) {
    const index = remainingGoals.indexOf(goal);
    if (index >= 0) remainingGoals.splice(index, 1);
  }
}

async function runProfile(shared: SharedRunContext, profile: LiveDemoProfile): Promise<DemoResult> {
  const reset = await new StrictStagingResetAdapter({ config: shared.config, resetConfig: shared.resetConfig, env: shared.env }).reset({
    accountIdentityHash: shared.verification.identityHash,
    scope: RESET_SCOPE,
    lessonId: profile.lessonId,
  });
  if (reset.status !== 'READY') throw new Error(`Staging reset blocked for ${profile.key}: ${reset.reason}`);

  const runId = createRunId();
  const runDirectory = path.join(shared.batchDirectory, `${runId}-${profile.key}`);
  const browserDirectory = path.join(runDirectory, 'browser');
  await mkdir(browserDirectory, { recursive: true });
  const stage = async (name: string, detail: Record<string, unknown> = {}): Promise<void> => {
    const event = redactSecrets({ timestamp: new Date().toISOString(), name, ...detail });
    await appendFile(path.join(runDirectory, 'demo-events.jsonl'), `${JSON.stringify(event)}\n`);
    process.stdout.write(`[live-demo:${profile.key}] ${name}\n`);
  };

  const recorder = new PlaywrightFfmpegRecorder();
  const prepared = await recorder.prepare({
    artifactDirectory: runDirectory,
    enabled: true,
    release: true,
    deletePassVideo: false,
    captureTabAudio: true,
    requireAudio: true,
    minimumFreeBytes: 2 * 1_024 * 1_024 * 1_024,
  });
  if (prepared.state !== 'available') throw new Error(`Recording is ${prepared.state}: ${prepared.limitations.join('; ')}`);

  const controller = new GuardedBrowserController({
    policy: { allowedHosts: [...new Set([...shared.config.staging.allowedHosts, ...shared.staging.auth.allowedHosts])] },
    artifactDirectory: browserDirectory,
    profileDirectory: shared.browserProfile,
    preserveProfile: true,
    headless: false,
    timeoutMs: 30_000,
    recordVideoDirectory: runDirectory,
    recordVideoSize: FULL_HD,
    captureTabAudio: true,
    ...(shared.appCheckDebugToken ? { appCheckDebugToken: shared.appCheckDebugToken } : {}),
    voice: {
      enabled: true,
      audible: true,
      permissions: ['microphone'],
      args: ['--start-maximized', '--autoplay-policy=no-user-gesture-required'],
    },
  });
  const edgeTts = new EdgeTtsClient({ retries: 5, timeoutMs: 40_000, cacheDirectory: path.join(shared.cwd, '.qa-private', 'tts-cache') });
  const history: BrainTurn[] = [];
  const usedBehaviors: string[] = [];
  const remainingGoals = [...shared.scenario.goals];
  const turns: TurnMetric[] = [];
  let understanding = shared.persona.starting_understanding;
  let currentMisconception: string | null = shared.persona.misconception;
  let openingPlayback: ResponsePlaybackResult | null = null;
  let startupLatency: ProductLatencyTelemetry = { scalarMs: {}, voiceBreakdowns: [] };
  let recordingStartedAt = 0;
  let recordingFinishedAt = 0;
  let sessionEndedByTwoClicks = false;
  let endLessonSessionStatus: number | null = null;
  let recording = prepared;
  let videoInspection: VideoArtifactInspection | null = null;
  let failure: unknown = null;

  try {
    await stage('browser_open_start');
    await controller.open();
    const page = controller.runtime().page;
    await page.addInitScript({ content: `
      (() => {
        let context;
        let destination;
        const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
        navigator.mediaDevices.getUserMedia = async (constraints) => {
          if (!constraints || !constraints.audio) return original(constraints);
          if (!context) {
            context = new AudioContext();
            destination = context.createMediaStreamDestination();
          }
          return destination.stream;
        };
      })();
    ` });
    await page.setViewportSize(FULL_HD);
    await recorder.start(page);
    recordingStartedAt = Date.now();
    await stage('recording_started', { targetDurationMs: LIVE_DEMO_TARGET_DURATION_MS, viewport: FULL_HD });
    const baseUrl = shared.config.staging.baseUrl;
    if (!baseUrl) throw new Error('Staging URL is missing.');
    await controller.navigate(new URL('/app', baseUrl).href);
    await page.locator('[data-qa="authenticated-shell"]:visible').waitFor({ state: 'visible' });
    await page.locator('[data-qa="account-trigger"]:visible').click();
    const account = (await page.locator('[data-qa="account-email"]:visible').first().textContent()) ?? '';
    if (hashAccountIdentity(normalizeAccountEmail(account)) !== shared.verification.identityHash) throw new Error('Visible QA account does not match the verified synthetic identity.');
    await page.keyboard.press('Escape');
    await page.locator(`[data-qa="lesson-option"][data-lesson-id="${profile.lessonId}"][data-registry-status="approved"]`).first().waitFor({ state: 'attached', timeout: 15_000 });
    await page.evaluate((lessonId) => {
      const prefix = `k12.lessonSession.${lessonId}.`;
      for (const key of Object.keys(localStorage)) if (key.startsWith(prefix)) localStorage.removeItem(key);
    }, profile.lessonId);
    await controller.navigate(new URL(`/app/tutor?mode=foundation_recovery&lessonId=${encodeURIComponent(profile.lessonId)}`, baseUrl).href);
    await page.locator(`[data-qa="lesson-ready"][data-lesson-id="${profile.lessonId}"]:visible`).waitFor({ state: 'visible' });

    await recorder.checkpoint('entry-before-opening-intent');
    const openingIntent = page.locator(`${profile.openingIntentSelector}:visible`).first();
    await openingIntent.waitFor({ state: 'visible', timeout: 10_000 });
    const openingIntentText = (await openingIntent.textContent())?.replace(/\s+/gu, ' ').trim() ?? '';
    if (!openingIntentText.includes(profile.openingIntentLabel)) throw new Error(`${profile.openingIntentSelector} does not expose the expected opening label.`);
    await openingIntent.click();
    await stage('opening_intent_selected', { intent: profile.key, selector: profile.openingIntentSelector });

    const startupEventIndex = controller.runtime().events.length;
    await page.locator('[data-qa="start-lesson"][data-session-control="start"]:visible').click();
    await waitUntil(() => consoleLines(controller.runtime().events, startupEventIndex).some((line) => line.includes('setup_complete')), 60_000, 'Gemini setupComplete');
    openingPlayback = await waitForPlaybackResult(controller, startupEventIndex, 'opening tutor turn');
    startupLatency = collectProductLatencyTelemetry(consoleLines(controller.runtime().events, startupEventIndex));
    await page.locator('.ai-online.listening:visible').waitFor({ state: 'visible', timeout: TUTOR_TIMEOUT_MS });
    const textInput = page.locator('form.ai-input input:visible').first();
    await waitUntil(() => textInput.isEnabled().catch(() => false), 15_000, 'lesson text input');
    await waitUntil(async () => (await currentTutorText(page)).length > 0, 15_000, 'opening tutor transcript');
    history.push({ role: 'tutor', turn: 1, text: await currentTutorText(page) });
    await stage('opening_complete', {
      epoch: openingPlayback.epoch,
      audioMs: openingPlayback.naturallyEndedAudioMs,
      startupLatency,
    });

    const firstTurnAt = Math.max(Date.now(), recordingStartedAt + 25_000);
    const lastTurnAt = recordingStartedAt + LIVE_DEMO_TARGET_DURATION_MS - 50_000;
    if (firstTurnAt >= lastTurnAt) throw new Error('Startup consumed too much of the fixed five-minute recording window.');
    const turnIntervalMs = Math.floor((lastTurnAt - firstTurnAt) / (profile.minimumStudentTurns - 1));

    for (let turn = 1; turn <= profile.minimumStudentTurns; turn += 1) {
      const scheduledAt = firstTurnAt + (turn - 1) * turnIntervalMs;
      if (Date.now() < scheduledAt) await sleep(scheduledAt - Date.now());
      const brainStartedAt = Date.now();
      const decision = await nextSpeakingDecision(() => shared.brain.decide({
        persona: shared.persona,
        scenario: shared.scenario,
        turn,
        understanding,
        currentMisconception,
        alreadyUsed: usedBehaviors,
        remainingGoals,
        recentTurns: history.slice(-shared.scenario.limits.max_brain_context_turns),
      }), page);
      const brainDecisionMs = Date.now() - brainStartedAt;
      const finish = decision.actions.find((action) => action.action === 'finish');
      if (finish) throw new Error(`Real Gemini StudentBrain finished before the required ${profile.minimumStudentTurns} turns.`);
      const speech = decision.actions.find((action) => action.action === 'speak');
      if (!speech || speech.action !== 'speak') throw new Error('Real Gemini StudentBrain did not produce a bounded Vietnamese speaking turn.');
      understanding = decision.understanding;
      currentMisconception = decision.currentMisconception;
      updateBrainState(decision, usedBehaviors, remainingGoals);
      const studentText = applyProfileVisualRequest(profile, turn, speech.text);
      const visualRequested = speechRequestsVisual(studentText);
      const beforeBoard = await boardAudit(page);
      await textInput.fill(studentText);
      if (await textInput.inputValue() !== studentText) throw new Error(`Turn ${turn} visible input did not match the QA Brain speech exactly.`);

      const synthesisStartedAt = Date.now();
      const synthesized = await withTimeout(edgeTts.synthesize(studentText), 210_000, `turn ${turn} Edge TTS`);
      const ttsSynthesisMs = Date.now() - synthesisStartedAt;
      const playback = await withTimeout(scheduleEncodedAudioAudibly(page, synthesized.bytes, synthesized.mediaType), 10_000, `turn ${turn} Edge TTS scheduling`);
      await sleep(playback.decodedDurationMs + 150);
      if (await textInput.inputValue() !== studentText) throw new Error(`Turn ${turn} text changed while the identical Edge TTS audio was playing.`);

      const previousTutorText = await currentTutorText(page);
      const responseEventIndex = controller.runtime().events.length;
      const submittedAt = Date.now();
      await page.locator('form.ai-input button[type="submit"]:visible').click();
      history.push({ role: 'student', turn, text: studentText });
      await waitUntil(async () => {
        const next = await currentTutorText(page);
        return next.length > 0 && next !== previousTutorText;
      }, TUTOR_TIMEOUT_MS, `turn ${turn} tutor transcript`);
      const submitToTutorTextMs = Date.now() - submittedAt;
      const tutorPlayback = await waitForPlaybackResult(controller, responseEventIndex, `tutor turn ${turn}`);
      const submitToPlaybackCompleteMs = Date.now() - submittedAt;
      await page.locator('.ai-online.listening:visible').waitFor({ state: 'visible', timeout: TUTOR_TIMEOUT_MS });
      history.push({ role: 'tutor', turn, text: await currentTutorText(page) });

      if (visualRequested) {
        await waitUntil(async () => {
          const current = await boardAudit(page);
          return current.visible && current.entries > 0;
        }, 30_000, `turn ${turn} requested board visual`);
      }
      const afterBoard = await boardAudit(page);
      if (visualRequested && afterBoard.focusedZones !== 1) throw new Error(`Turn ${turn} requested a visual but the semantic board has ${afterBoard.focusedZones} focused zones.`);
      const productLatency = collectProductLatencyTelemetry(consoleLines(controller.runtime().events, responseEventIndex));
      turns.push({
        turn,
        studentIntent: speech.intent,
        studentCharacters: studentText.length,
        brainDecisionMs,
        ttsSynthesisMs,
        studentAudioMs: playback.decodedDurationMs,
        submitToTutorTextMs,
        submitToPlaybackCompleteMs,
        visualRequested,
        boardEntriesBefore: beforeBoard.entries,
        boardEntriesAfter: afterBoard.entries,
        boardVisible: afterBoard.visible,
        playback: tutorPlayback,
        productLatency,
      });
      await stage('turn_complete', {
        turn,
        intent: speech.intent,
        studentCharacters: studentText.length,
        brainDecisionMs,
        ttsSynthesisMs,
        studentAudioMs: playback.decodedDurationMs,
        submitToTutorTextMs,
        submitToPlaybackCompleteMs,
        visualRequested,
        boardEntries: afterBoard.entries,
        productLatency,
      });
      if (turn === 4 || turn === profile.minimumStudentTurns) await recorder.checkpoint(`turn-${turn}`);
    }

    const completeSessionConsole = consoleLines(controller.runtime().events);
    assertNoAudioPlaybackWatchdog(completeSessionConsole, `${profile.key} session`);
    const completeSessionPlaybacks = playbackResults(controller.runtime().events, 0);
    const expectedPlaybackResults = turns.length + 1;
    if (completeSessionPlaybacks.length !== expectedPlaybackResults) {
      throw new Error(`Expected ${expectedPlaybackResults} complete tutor playback results, received ${completeSessionPlaybacks.length}.`);
    }
    completeSessionPlaybacks.forEach((playbackResult, index) => {
      assertCompleteResponsePlayback(playbackResult, index === 0 ? 'opening tutor turn' : `tutor turn ${index}`);
    });

    const remainingDurationMs = recordingStartedAt + LIVE_DEMO_TARGET_DURATION_MS - Date.now();
    if (remainingDurationMs > 0) await sleep(remainingDurationMs);
    endLessonSessionStatus = await endSessionWithTwoClicks(page);
    sessionEndedByTwoClicks = true;
    await stage('session_ended', { clicks: 2, status: endLessonSessionStatus });
    await recorder.checkpoint('session-ended');
  } catch (error) {
    failure = error;
    await stage('run_failed', { reason: errorMessage(error) }).catch(() => undefined);
  } finally {
    recordingFinishedAt = recordingStartedAt > 0 ? Date.now() : 0;
    const recorderOutcome = failure === null && sessionEndedByTwoClicks ? 'RELEASE' : 'FAIL';
    recording = await withTimeout(recorder.stop(recorderOutcome), 240_000, 'recorder stop').catch(() => recorder.summary());
    await withTimeout(controller.close(), 30_000, 'browser close').catch(() => undefined);
    await recorder.cleanup(failure === null ? 'RELEASE' : 'FAIL');
  }

  if (failure === null) {
    try {
      videoInspection = await assertVideoArtifact(runDirectory, recording, {
        expectedWidth: FULL_HD.width,
        expectedHeight: FULL_HD.height,
        minimumDurationMs: LIVE_DEMO_MINIMUM_VIDEO_DURATION_MS,
        maximumDurationMs: LIVE_DEMO_MAXIMUM_VIDEO_DURATION_MS,
        minimumAudioCoverageRatio: LIVE_DEMO_MINIMUM_AUDIO_COVERAGE_RATIO,
        maximumAudioCoverageRatio: LIVE_DEMO_MAXIMUM_AUDIO_COVERAGE_RATIO,
        requireAudio: true,
      });
    } catch (error) {
      failure = error;
    }
  }

  const result: DemoResult = {
    schemaVersion: 1,
    runId,
    status: failure === null ? 'PASSED' : 'FAILED',
    profile: profile.key,
    profileLabel: profile.label,
    lessonId: profile.lessonId,
    lessonLabel: profile.lessonLabel,
    openingIntent: profile.openingIntentLabel,
    targetDurationMs: LIVE_DEMO_TARGET_DURATION_MS,
    measuredRunDurationMs: recordingStartedAt > 0 && recordingFinishedAt >= recordingStartedAt ? recordingFinishedAt - recordingStartedAt : 0,
    targetHost: shared.staging.target.expectedHost,
    syntheticOnly: true,
    brain: { name: shared.brain.name, version: shared.brain.version },
    studentInputMode: 'visible-audible-edge-tts-plus-identical-text-submit',
    microphoneRecognitionTested: false,
    rawAudioPersisted: false,
    rawTranscriptPersisted: false,
    providerOutputPersisted: false,
    startupLatency,
    openingPlayback,
    turns,
    sessionEndedByTwoClicks,
    endLessonSessionStatus,
    recording,
    videoInspection,
    failureReason: failure === null ? null : redactSecrets(errorMessage(failure)),
  };
  await writeFile(path.join(runDirectory, 'live-demo-summary.json'), `${JSON.stringify(result, null, 2)}\n`, { flag: 'wx' });
  process.stdout.write(`${JSON.stringify({ runDirectory, status: result.status, profile: result.profile, video: recording.video, videoInspection }, null, 2)}\n`);
  if (failure !== null) throw new Error(errorMessage(failure));
  return result;
}

async function main(): Promise<void> {
  const cwd = process.cwd();
  const env = process.env;
  if (env.QA_ENABLE_RECORDING?.trim().toLowerCase() !== 'true') throw new Error('Set QA_ENABLE_RECORDING=true explicitly for the three local-only demo recordings.');
  const config = await loadConfig({ cwd, env });
  const staging = await loadStagingProfile({ config, cwd, env });
  const [verification, resetConfig, browserProfile, appCheckDebugToken, persona, scenario] = await Promise.all([
    loadAuthVerification(cwd, staging),
    loadStagingResetConfig(cwd, staging),
    assertPrivatePath(cwd, staging.privatePaths.browserProfileDirectory),
    loadStagingAppCheckDebugToken(cwd, staging),
    findStudentPersona('hesitant-grade-12-live'),
    findStudentScenario(SCENARIO_ID),
  ]);
  if (verification.identityHash !== resetConfig.expectedAccountIdentityHash) throw new Error('QA identity and strict-reset identity do not match.');
  const brain = createConfiguredGeminiStudentBrain(env, undefined, 'voice');
  const profiles = parseRequestedProfiles(env.QA_LIVE_DEMO_PROFILE);
  const batchDirectory = path.resolve(config.artifacts.root, `${createRunId()}-live-demos`);
  await mkdir(batchDirectory, { recursive: true });
  const shared: SharedRunContext = {
    cwd,
    env,
    config,
    staging,
    verification,
    resetConfig,
    browserProfile,
    appCheckDebugToken,
    brain,
    persona,
    scenario,
    batchDirectory,
  };
  const results: DemoResult[] = [];
  for (const profile of profiles) results.push(await runProfile(shared, profile));
  const batchSummary = {
    schemaVersion: 1,
    status: results.every((result) => result.status === 'PASSED') ? 'PASSED' : 'FAILED',
    targetDurationMsPerProfile: LIVE_DEMO_TARGET_DURATION_MS,
    requestedProfiles: profiles.map((profile) => profile.key),
    results: results.map((result) => ({
      runId: result.runId,
      profile: result.profile,
      lessonId: result.lessonId,
      status: result.status,
      video: result.recording.video,
      durationMs: result.videoInspection?.durationMs ?? null,
      audioCoverageRatio: result.videoInspection?.audioCoverageRatio ?? null,
      turnCount: result.turns.length,
    })),
  };
  await writeFile(path.join(batchDirectory, 'live-demo-batch-summary.json'), `${JSON.stringify(batchSummary, null, 2)}\n`, { flag: 'wx' });
  process.stdout.write(`${JSON.stringify({ batchDirectory, ...batchSummary }, null, 2)}\n`);
}

await main();
