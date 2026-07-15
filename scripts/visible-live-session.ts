import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { loadAuthVerification, hashAccountIdentity, normalizeAccountEmail } from '../src/auth-bootstrap.js';
import { GuardedBrowserController } from '../src/browser-controller.js';
import { loadConfig } from '../src/config.js';
import { createRunId } from '../src/run-store.js';
import { assertPrivatePath, loadStagingAppCheckDebugToken, loadStagingProfile } from '../src/staging-profile.js';
import { loadStagingResetConfig, StrictStagingResetAdapter } from '../src/staging-reset.js';

const LESSON_ID = 'G12_MATH_KNTT_CH01_L01';
const RESET_SCOPE = 'g12-session-start-smoke';

type LatencyMetrics = Record<string, number>;

function log(check: string, details: string): void {
  process.stdout.write(`${JSON.stringify({ check, details })}\n`);
}

async function waitUntil(check: () => Promise<boolean> | boolean, timeoutMs: number, label: string): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Timed out waiting for ${label}.`);
}

function extractProviderLatency(events: ReturnType<GuardedBrowserController['runtime']>['events']): LatencyMetrics {
  const metrics: LatencyMetrics = {};
  const firstAudioSamples: number[] = [];
  let outputInterruptions = 0;
  let tutorActionRejections = 0;
  for (const event of events) {
    if (event.event !== 'console') continue;
    const line = JSON.stringify(event.data);
    const connected = line.match(/start_to_connected_ms\s+(\d+)/);
    if (connected) metrics.provider_start_to_connected_ms = Number(connected[1]);
    const firstAudio = line.match(/speech_end_to_first_ai_audio_ms\s+(\d+)/);
    if (firstAudio) firstAudioSamples.push(Number(firstAudio[1]));
    if (/stop_output_audio\s+(?:quick_tutor_message|gemini_interrupted)/.test(line)) outputInterruptions += 1;
    if (/tutor_action_gate\s+rejected/.test(line)) tutorActionRejections += 1;
  }
  if (firstAudioSamples.length > 0) {
    metrics.provider_speech_end_to_first_ai_audio_last_ms = firstAudioSamples.at(-1)!;
    metrics.provider_speech_end_to_first_ai_audio_max_ms = Math.max(...firstAudioSamples);
    metrics.provider_speech_end_to_first_ai_audio_samples = firstAudioSamples.length;
  }
  metrics.provider_output_interruptions = outputInterruptions;
  metrics.tutor_action_rejections = tutorActionRejections;
  return metrics;
}

async function main(): Promise<void> {
  const cwd = process.cwd();
  const env = process.env;
  const viewerHoldMs = env.QA_VISIBLE_HOLD_MS === undefined ? 5 * 60_000 : Number(env.QA_VISIBLE_HOLD_MS);
  if (!Number.isInteger(viewerHoldMs) || viewerHoldMs < 0 || viewerHoldMs > 5 * 60_000) {
    throw new Error('QA_VISIBLE_HOLD_MS must be an integer between 0 and 300000.');
  }
  const config = await loadConfig({ cwd, env });
  const profile = await loadStagingProfile({ config, cwd, env });
  const [verification, resetConfig] = await Promise.all([
    loadAuthVerification(cwd, profile),
    loadStagingResetConfig(cwd, profile),
  ]);
  if (verification.identityHash !== resetConfig.expectedAccountIdentityHash) throw new Error('Verified account and reset identity do not match.');
  const baseUrl = config.staging.baseUrl;
  if (!baseUrl) throw new Error('Staging target is not configured.');

  const audioPath = await assertPrivatePath(cwd, env.QA_FAKE_AUDIO_CAPTURE_PATH ?? '.qa-private/audio/live-checkin-vi-short.wav');
  const audioBase64 = (await readFile(audioPath)).toString('base64');
  const [profileDirectory, appCheckDebugToken] = await Promise.all([
    assertPrivatePath(cwd, profile.privatePaths.browserProfileDirectory),
    loadStagingAppCheckDebugToken(cwd, profile),
  ]);
  const reset = await new StrictStagingResetAdapter({ config, resetConfig, env }).reset({ accountIdentityHash: verification.identityHash, scope: RESET_SCOPE });
  if (reset.status !== 'READY') throw new Error(`Strict reset blocked: ${reset.reason}`);
  log('reset', 'READY');

  const runId = createRunId();
  const runDirectory = path.resolve(config.artifacts.root, runId);
  const browserDirectory = path.join(runDirectory, 'browser');
  await mkdir(browserDirectory, { recursive: true });
  const controller = new GuardedBrowserController({
    policy: { allowedHosts: [...new Set([...config.staging.allowedHosts, ...profile.auth.allowedHosts])] },
    artifactDirectory: browserDirectory,
    profileDirectory,
    preserveProfile: true,
    headless: false,
    timeoutMs: 30_000,
    ...(appCheckDebugToken ? { appCheckDebugToken } : {}),
    voice: {
      enabled: true,
      audible: true,
      permissions: ['microphone'],
    },
  });

  let setupComplete = false;
  let lessonReady = false;
  let correctAnswer = false;
  let boardObjectCount = 0;
  let memoryCardVisible = false;
  const latencyMs: LatencyMetrics = {};
  let receivedToolCallFrames = 0;
  let sentToolResponseFrames = 0;
  try {
    await controller.open();
    const page = controller.runtime().page;
    page.on('websocket', (socket) => {
      socket.on('framereceived', ({ payload }) => {
        const structuralText = typeof payload === 'string' ? payload : payload.toString('utf8');
        if (/toolCall|tool_call/.test(structuralText)) receivedToolCallFrames += 1;
      });
      socket.on('framesent', ({ payload }) => {
        const structuralText = typeof payload === 'string' ? payload : payload.toString('utf8');
        if (/toolResponse|tool_response/.test(structuralText)) sentToolResponseFrames += 1;
      });
    });
    await page.addInitScript({ content: `
      (() => {
        const encodedAudio = ${JSON.stringify(audioBase64)};
        let context;
        let destination;
        let buffer;
        function ensureAudio() {
          if (!context) {
            context = new AudioContext();
            destination = context.createMediaStreamDestination();
            const bytes = Uint8Array.from(atob(encodedAudio), (character) => character.charCodeAt(0));
            buffer = context.decodeAudioData(bytes.buffer);
          }
          return { context, destination, buffer };
        }
        const originalGetUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
        navigator.mediaDevices.getUserMedia = async function(constraints) {
          if (!constraints || !constraints.audio) return originalGetUserMedia(constraints);
          return ensureAudio().destination.stream;
        };
        window.__qaPlayVietnameseCheckin = async function() {
          const audio = ensureAudio();
          await audio.context.resume();
          const source = audio.context.createBufferSource();
          source.buffer = await audio.buffer;
          source.connect(audio.destination);
          source.connect(audio.context.destination);
          source.start();
          return { durationMs: Math.round(source.buffer.duration * 1000), contextState: audio.context.state };
        };
      })();
    ` });
    await page.setViewportSize({ width: 1440, height: 900 });
    await controller.navigate(new URL('/app', baseUrl).href);
    await page.locator('[data-qa="authenticated-shell"]:visible').waitFor({ state: 'visible' });
    await page.locator('[data-qa="account-trigger"]:visible').click();
    const account = page.locator('[data-qa="account-email"]:visible').first();
    await account.waitFor({ state: 'visible' });
    const accountHash = hashAccountIdentity(normalizeAccountEmail((await account.textContent()) ?? ''));
    if (accountHash !== verification.identityHash) throw new Error('Visible account identity does not match the verified QA profile.');
    log('auth', verification.identityHash);
    await page.keyboard.press('Escape');
    await page.evaluate((lessonId) => {
      const prefix = `k12.lessonSession.${lessonId}.`;
      for (const key of Object.keys(localStorage)) if (key.startsWith(prefix)) localStorage.removeItem(key);
    }, LESSON_ID);

    const lesson = page.locator(`[data-qa="lesson-option"][data-lesson-id="${LESSON_ID}"][data-registry-status="approved"]:visible`).first();
    await lesson.waitFor({ state: 'visible' });
    await Promise.all([page.waitForURL(/\/app\/tutor(?:\?|$)/), lesson.click()]);
    await page.locator(`[data-qa="lesson-ready"][data-lesson-id="${LESSON_ID}"]:visible`).waitFor({ state: 'visible' });
    log('lesson', LESSON_ID);

    const startRequestedAt = Date.now();
    await page.locator('[data-qa="start-lesson"][data-session-control="start"]:visible').click();
    await waitUntil(() => controller.runtime().events.some((event) => event.event === 'console' && JSON.stringify(event.data).includes('setup_complete')), 60_000, 'Gemini setupComplete');
    const setupCompletedAt = Date.now();
    latencyMs.ui_start_to_setup_complete_ms = setupCompletedAt - startRequestedAt;
    setupComplete = true;
    log('gemini-live', `setupComplete in ${latencyMs.ui_start_to_setup_complete_ms} ms`);

    await page.locator('.ai-online.AI-speaking:visible').waitFor({ state: 'visible', timeout: 30_000 });
    await page.locator('.ai-online.listening:visible').waitFor({ state: 'visible', timeout: 60_000 });
    const checkinPlayedAt = Date.now();
    const playback = await page.evaluate<{ durationMs: number; contextState: string }>('window.__qaPlayVietnameseCheckin()');
    if (playback.contextState !== 'running') throw new Error(`Vietnamese QA audio context is ${playback.contextState}.`);
    await page.locator('.ai-online.user-speaking:visible').waitFor({ state: 'visible', timeout: 15_000 });
    latencyMs.checkin_play_to_speech_detected_ms = Date.now() - checkinPlayedAt;
    log('qa-student', `Vietnamese check-in detected in ${latencyMs.checkin_play_to_speech_detected_ms} ms (${playback.durationMs} ms audio)`);

    const textInput = page.locator('form.ai-input input:visible').first();
    await waitUntil(() => textInput.isEnabled(), 120_000, 'authoritative onboarding lesson_ready');
    latencyMs.setup_complete_to_lesson_ready_ms = Date.now() - setupCompletedAt;
    lessonReady = true;
    log('onboarding', `lesson_ready in ${latencyMs.setup_complete_to_lesson_ready_ms} ms after setupComplete`);
    await page.locator('.ai-online.listening:visible').waitFor({ state: 'visible', timeout: 60_000 });

    const latestTutorActivity = page.locator('.activity-history article').filter({ has: page.locator('span.ai') }).last().locator('p');
    async function currentTutorActivity(): Promise<string> {
      return (await latestTutorActivity.textContent().catch(() => ''))?.trim() ?? '';
    }
    async function waitForTutorTurn(previous: string, requestedAt: number): Promise<{ firstResponseMs: number; completeMs: number }> {
      await waitUntil(async () => {
        const current = await currentTutorActivity();
        return current.length > 0 && current !== previous;
      }, 60_000, 'new tutor response');
      const firstResponseMs = Date.now() - requestedAt;
      await page.locator('.ai-online.listening:visible').waitFor({ state: 'visible', timeout: 60_000 });
      return { firstResponseMs, completeMs: Date.now() - requestedAt };
    }
    async function sendAnswer(answer: string): Promise<{ sentAt: number; tutorTurn: Promise<{ firstResponseMs: number; completeMs: number }> }> {
      const previous = await currentTutorActivity();
      await textInput.fill(answer);
      const sentAt = Date.now();
      await page.locator('form.ai-input button[type="submit"]:visible').click();
      return {
        sentAt,
        tutorTurn: waitForTutorTurn(previous, sentAt),
      };
    }

    const wrongAnswer = await sendAnswer('4');
    const wrongVerifierMs = page.locator('.verification-message:visible').filter({ hasText: 'Chưa đúng' }).waitFor({ state: 'visible' }).then(() => Date.now() - wrongAnswer.sentAt);
    const [wrongTutorTurn, wrongVerifier] = await Promise.all([wrongAnswer.tutorTurn, wrongVerifierMs]);
    latencyMs.incorrect_submit_to_tutor_first_response_ms = wrongTutorTurn.firstResponseMs;
    latencyMs.incorrect_submit_to_tutor_turn_complete_ms = wrongTutorTurn.completeMs;
    latencyMs.incorrect_submit_to_verifier_ms = wrongVerifier;
    log('verifier', `incorrect outcome in ${latencyMs.incorrect_submit_to_verifier_ms} ms`);

    const boardBeforeExplanation = await page.locator('.lesson-board-scene text, .lesson-board-scene .board-math-block').count();
    const explanationRequestedAt = Date.now();
    const explanationButtons = [
      page.getByRole('button', { name: 'Giải thích lại', exact: true }),
      page.getByRole('button', { name: /Xem ví dụ minh họa/ }),
      page.getByRole('button', { name: 'Gợi ý bước tiếp', exact: true }),
    ];
    for (let attempt = 0; attempt < explanationButtons.length; attempt += 1) {
      const previousExplanation = await currentTutorActivity();
      const turnRequestedAt = Date.now();
      await explanationButtons[attempt]!.click();
      const tutorTurn = await waitForTutorTurn(previousExplanation, turnRequestedAt);
      if (attempt === 0) {
        latencyMs.explanation_request_to_tutor_first_response_ms = tutorTurn.firstResponseMs;
        latencyMs.explanation_request_to_tutor_turn_complete_ms = tutorTurn.completeMs;
      }
      boardObjectCount = await page.locator('.lesson-board-scene text, .lesson-board-scene .board-math-block').count();
      if (boardObjectCount > boardBeforeExplanation) {
        latencyMs.whiteboard_request_attempts = attempt + 1;
        break;
      }
    }
    if (boardObjectCount <= boardBeforeExplanation) throw new Error('Tutor completed three help turns without producing approved whiteboard content.');
    latencyMs.explanation_request_to_whiteboard_ms = Date.now() - explanationRequestedAt;
    log('whiteboard', `${boardObjectCount} rendered object(s) in ${latencyMs.explanation_request_to_whiteboard_ms} ms`);

    const correctAnswerSubmission = await sendAnswer('2');
    const correctVerifierMs = page.locator('.verification-message:visible').filter({ hasText: 'Chính xác' }).waitFor({ state: 'visible' }).then(() => Date.now() - correctAnswerSubmission.sentAt);
    const [correctTutorTurn, correctVerifier] = await Promise.all([correctAnswerSubmission.tutorTurn, correctVerifierMs]);
    latencyMs.correct_submit_to_tutor_first_response_ms = correctTutorTurn.firstResponseMs;
    latencyMs.correct_submit_to_tutor_turn_complete_ms = correctTutorTurn.completeMs;
    latencyMs.correct_submit_to_verifier_ms = correctVerifier;
    correctAnswer = true;
    log('verifier', `correct outcome in ${latencyMs.correct_submit_to_verifier_ms} ms`);

    const completionRequestedAt = Date.now();
    await page.getByRole('button', { name: 'Con đã hiểu', exact: true }).click();
    await page.locator('.lesson-memory-overlay:visible').waitFor({ state: 'visible', timeout: 30_000 });
    latencyMs.completion_to_memory_card_ms = Date.now() - completionRequestedAt;
    memoryCardVisible = true;
    log('session', `completed memory card visible in ${latencyMs.completion_to_memory_card_ms} ms`);
    if (viewerHoldMs > 0) {
      log('viewer', `Browser remains open for up to ${viewerHoldMs} ms; close it when inspection is finished.`);
      await Promise.race([
        page.waitForEvent('close').catch(() => undefined),
        new Promise((resolve) => setTimeout(resolve, viewerHoldMs)),
      ]);
    }
  } finally {
    try { Object.assign(latencyMs, extractProviderLatency(controller.runtime().events)); } catch { /* browser did not open */ }
    latencyMs.received_tool_call_frames = receivedToolCallFrames;
    latencyMs.sent_tool_response_frames = sentToolResponseFrames;
    await controller.close();
    const summary = {
      schemaVersion: 1,
      runId,
      status: setupComplete && lessonReady && correctAnswer && boardObjectCount > 0 && memoryCardVisible && latencyMs.provider_output_interruptions === 0 ? 'PASSED' : 'FAILED',
      lessonId: LESSON_ID,
      recording: false,
      setupComplete,
      lessonReady,
      correctAnswer,
      boardObjectCount,
      memoryCardVisible,
      latencyMs,
      limitations: ['Synthetic QA account and vi-VN synthetic check-in audio.', 'No video or raw transcript artifact was recorded.'],
    };
    await writeFile(path.join(runDirectory, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`, { flag: 'wx' });
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
