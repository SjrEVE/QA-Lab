import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Page } from 'playwright';
import { loadAuthVerification, hashAccountIdentity, normalizeAccountEmail } from '../src/auth-bootstrap.js';
import { speakVietnameseAudibly } from '../src/browser-speech.js';
import { GuardedBrowserController } from '../src/browser-controller.js';
import { loadConfig } from '../src/config.js';
import { EdgeTtsClient } from '../src/edge-tts.js';
import { createConfiguredGeminiStudentBrain } from '../src/gemini-student-brain.js';
import { createRunId } from '../src/run-store.js';
import type { BrainTurn, StudentBrainDecision } from '../src/student-brain.js';
import { findStudentPersona, findStudentScenario } from '../src/student-contracts.js';
import { assertPrivatePath, loadStagingAppCheckDebugToken, loadStagingProfile } from '../src/staging-profile.js';
import { loadStagingResetConfig, StrictStagingResetAdapter } from '../src/staging-reset.js';
import { playEncodedAudioAudibly } from '../src/tab-audio-capture.js';

const LESSON_ID = 'G12_MATH_KNTT_CH01_L01';
const RESET_SCOPE = 'g12-session-start-smoke';
const SCENARIO_ID = 'gia-su-ai-live-grade-12';
const MIN_VISIBLE_TURNS = 4;
const TUTOR_TIMEOUT_MS = 90_000;

type TurnMetric = {
  readonly turn: number;
  readonly brainDecisionMs: number;
  readonly qaSpeechMs: number;
  readonly submitToTutorFirstResponseMs: number;
  readonly submitToTutorCompleteMs: number;
  readonly boardObjectCount: number;
};

function emit(event: string, details: Record<string, unknown>): void {
  process.stdout.write(`${JSON.stringify({ event, ...details })}\n`);
}

async function waitUntil(check: () => Promise<boolean> | boolean, timeoutMs: number, label: string): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error(`Timed out waiting for ${label}.`);
}

async function currentTutorText(page: Page): Promise<string> {
  const latest = page.locator('.activity-history article').filter({ has: page.locator('span.ai') }).last().locator('p');
  return (await latest.textContent().catch(() => ''))?.trim() ?? '';
}

async function nextSpeakingDecision(decide: () => Promise<StudentBrainDecision>, page: Page): Promise<StudentBrainDecision> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const decision = await decide();
    const wait = decision.actions.find((action) => action.action === 'wait');
    if (!wait || wait.action !== 'wait') return decision;
    await page.waitForTimeout(wait.durationMs);
  }
  throw new Error('QA Brain returned wait twice without a student turn.');
}

async function main(): Promise<void> {
  const cwd = process.cwd();
  const env = process.env;
  const config = await loadConfig({ cwd, env });
  const profile = await loadStagingProfile({ config, cwd, env });
  const [verification, resetConfig, persona, scenario] = await Promise.all([
    loadAuthVerification(cwd, profile),
    loadStagingResetConfig(cwd, profile),
    findStudentPersona('hesitant-grade-12-live'),
    findStudentScenario(SCENARIO_ID),
  ]);
  if (verification.identityHash !== resetConfig.expectedAccountIdentityHash) throw new Error('Verified account and reset identity do not match.');
  const baseUrl = config.staging.baseUrl;
  if (!baseUrl) throw new Error('Staging target is not configured.');
  const reset = await new StrictStagingResetAdapter({ config, resetConfig, env }).reset({ accountIdentityHash: verification.identityHash, scope: RESET_SCOPE });
  if (reset.status !== 'READY') throw new Error(`Strict reset blocked: ${reset.reason}`);
  const brain = createConfiguredGeminiStudentBrain(env, undefined, 'voice');
  const edgeTts = new EdgeTtsClient();

  const runId = createRunId();
  const runDirectory = path.resolve(config.artifacts.root, runId);
  const browserDirectory = path.join(runDirectory, 'browser');
  await mkdir(browserDirectory, { recursive: true });
  const [profileDirectory, appCheckDebugToken] = await Promise.all([
    assertPrivatePath(cwd, profile.privatePaths.browserProfileDirectory),
    loadStagingAppCheckDebugToken(cwd, profile),
  ]);
  const controller = new GuardedBrowserController({
    policy: { allowedHosts: [...new Set([...config.staging.allowedHosts, ...profile.auth.allowedHosts])] },
    artifactDirectory: browserDirectory,
    profileDirectory,
    preserveProfile: true,
    headless: false,
    timeoutMs: 30_000,
    ...(appCheckDebugToken ? { appCheckDebugToken } : {}),
    captureTabAudio: true,
    voice: { enabled: true, audible: true, permissions: ['microphone'] },
  });

  const metrics: TurnMetric[] = [];
  const history: BrainTurn[] = [];
  const usedBehaviors: string[] = [];
  const remainingGoals = [...scenario.goals];
  let understanding = persona.starting_understanding;
  let misconception: string | null = persona.misconception;
  let setupCompleteMs = 0;
  let boardMaximum = 0;
  let sessionStarted = false;
  let sessionStopped = false;
  let status: 'PASSED' | 'FAILED' = 'FAILED';

  try {
    await controller.open();
    const page = controller.runtime().page;
    await page.addInitScript({ content: `
      (() => {
        let context;
        let silentDestination;
        const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
        navigator.mediaDevices.getUserMedia = async function(constraints) {
          if (!constraints || !constraints.audio) return original(constraints);
          if (!context) {
            context = new AudioContext();
            silentDestination = context.createMediaStreamDestination();
          }
          return silentDestination.stream;
        };
      })();
    ` });
    await page.setViewportSize({ width: 1440, height: 900 });
    await controller.navigate(new URL('/app', baseUrl).href);
    await page.locator('[data-qa="authenticated-shell"]:visible').waitFor({ state: 'visible' });
    await page.locator('[data-qa="account-trigger"]:visible').click();
    const account = page.locator('[data-qa="account-email"]:visible').first();
    await account.waitFor({ state: 'visible' });
    if (hashAccountIdentity(normalizeAccountEmail((await account.textContent()) ?? '')) !== verification.identityHash) throw new Error('Visible account identity does not match the verified QA profile.');
    await page.keyboard.press('Escape');
    await page.evaluate((lessonId) => {
      const prefix = `k12.lessonSession.${lessonId}.`;
      for (const key of Object.keys(localStorage)) if (key.startsWith(prefix)) localStorage.removeItem(key);
    }, LESSON_ID);

    const lesson = page.locator(`[data-qa="lesson-option"][data-lesson-id="${LESSON_ID}"][data-registry-status="approved"]:visible`).first();
    await lesson.waitFor({ state: 'visible' });
    await Promise.all([page.waitForURL(/\/app\/tutor(?:\?|$)/), lesson.click()]);
    await page.locator(`[data-qa="lesson-ready"][data-lesson-id="${LESSON_ID}"]:visible`).waitFor({ state: 'visible' });
    const startRequestedAt = Date.now();
    await page.locator('[data-qa="start-lesson"][data-session-control="start"]:visible').click();
    sessionStarted = true;
    await waitUntil(() => controller.runtime().events.some((event) => event.event === 'console' && JSON.stringify(event.data).includes('setup_complete')), 60_000, 'Gemini setupComplete');
    setupCompleteMs = Date.now() - startRequestedAt;
    emit('setup_complete', { latencyMs: setupCompleteMs, lessonId: LESSON_ID });
    const textInput = page.locator('form.ai-input input:visible').first();
    await waitUntil(() => textInput.isEnabled(), 120_000, 'authoritative lesson readiness');
    await waitUntil(async () => (await currentTutorText(page)).length > 0, 30_000, 'first tutor turn');
    await page.locator('.ai-online.listening:visible').waitFor({ state: 'visible', timeout: TUTOR_TIMEOUT_MS });

    for (let turn = 1; turn <= scenario.limits.max_turns; turn += 1) {
      const tutorText = await currentTutorText(page);
      if (!tutorText) throw new Error('Tutor turn text is unavailable for bounded Brain context.');
      history.push({ role: 'tutor', turn, text: tutorText });
      const brainStartedAt = Date.now();
      const decision = await nextSpeakingDecision(() => brain.decide({
        persona,
        scenario,
        turn,
        understanding,
        currentMisconception: misconception,
        alreadyUsed: usedBehaviors,
        remainingGoals,
        recentTurns: history.slice(-scenario.limits.max_brain_context_turns),
      }), page);
      const brainDecisionMs = Date.now() - brainStartedAt;
      understanding = decision.understanding;
      misconception = decision.currentMisconception;
      if (decision.usedBehavior && !usedBehaviors.includes(decision.usedBehavior)) usedBehaviors.push(decision.usedBehavior);
      for (const goal of decision.completedGoals ?? []) {
        const index = remainingGoals.indexOf(goal as typeof remainingGoals[number]);
        if (index >= 0) remainingGoals.splice(index, 1);
      }
      const finish = decision.actions.find((action) => action.action === 'finish');
      if (finish) {
        emit('brain_finish', { turn, brainDecisionMs, remainingGoalCount: remainingGoals.length });
        break;
      }
      const speech = decision.actions.find((action) => action.action === 'speak');
      if (!speech || speech.action !== 'speak') throw new Error('QA Brain did not produce a bounded Vietnamese speaking turn.');
      let audible: { durationMs: number; locale: string };
      try {
        const synthesized = await edgeTts.synthesize(speech.text);
        const played = await playEncodedAudioAudibly(page, synthesized.bytes, synthesized.mediaType);
        audible = { durationMs: played.durationMs, locale: synthesized.voice.slice(0, 5) };
        emit('qa_tts_complete', { turn, provider: 'edge-tts-qa-only', synthLatencyMs: synthesized.latencyMs, attempts: synthesized.attempts, playbackMs: played.durationMs });
      } catch (ttsError) {
        audible = await speakVietnameseAudibly(page, speech.text);
        emit('voice_fallback', { turn, locale: audible.locale, reason: ttsError instanceof Error ? ttsError.message : 'Edge TTS unavailable' });
      }
      history.push({ role: 'student', turn, text: speech.text });
      const previousTutor = tutorText;
      await textInput.fill(speech.text);
      const submittedAt = Date.now();
      await page.locator('form.ai-input button[type="submit"]:visible').click();
      await waitUntil(async () => {
        const next = await currentTutorText(page);
        return next.length > 0 && next !== previousTutor;
      }, TUTOR_TIMEOUT_MS, `tutor response ${turn}`);
      const firstResponseMs = Date.now() - submittedAt;
      await page.locator('.ai-online.listening:visible').waitFor({ state: 'visible', timeout: TUTOR_TIMEOUT_MS });
      const completeMs = Date.now() - submittedAt;
      const boardObjectCount = await page.locator('.lesson-board-scene text, .lesson-board-scene .board-math-block').count();
      boardMaximum = Math.max(boardMaximum, boardObjectCount);
      metrics.push({ turn, brainDecisionMs, qaSpeechMs: audible.durationMs, submitToTutorFirstResponseMs: firstResponseMs, submitToTutorCompleteMs: completeMs, boardObjectCount });
      emit('turn_complete', { turn, intent: speech.intent, brainDecisionMs, qaSpeechMs: audible.durationMs, submitToTutorFirstResponseMs: firstResponseMs, submitToTutorCompleteMs: completeMs, boardObjectCount, understanding, remainingGoalCount: remainingGoals.length });
      if (turn >= scenario.checks.minimum_turns && remainingGoals.length === 0) break;
    }

    const stop = page.locator('[data-qa="start-lesson"][data-session-control="stop"]:visible, button:has-text("Kết thúc"):visible').first();
    if (await stop.isVisible()) {
      await stop.click();
      sessionStopped = true;
    }
    status = metrics.length >= MIN_VISIBLE_TURNS && boardMaximum > 0 && sessionStopped ? 'PASSED' : 'FAILED';
  } finally {
    if (sessionStarted && !sessionStopped) {
      const page = controller.runtime().page;
      const stop = page.locator('[data-qa="start-lesson"][data-session-control="stop"]:visible, button:has-text("Kết thúc"):visible').first();
      if (await stop.isVisible().catch(() => false)) await stop.click().catch(() => undefined);
    }
    await controller.close();
  }

  const summary = {
    schemaVersion: 1,
    runId,
    status,
    targetHost: profile.target.expectedHost,
    lessonId: LESSON_ID,
    scenarioId: scenario.id,
    brain: { name: brain.name, version: brain.version },
    studentInputMode: 'audible-edge-tts-with-browser-fallback-plus-text-submit',
    microphoneRecognitionTested: false,
    recordingEnabled: false,
    transcriptPersisted: false,
    rawAudioPersisted: false,
    setupCompleteMs,
    turns: metrics,
    boardMaximum,
    goalsMet: scenario.goals.length - remainingGoals.length,
    goalsTotal: scenario.goals.length,
    sessionStopped,
    limitations: [
      'QA speech is audible locally but the identical turn is submitted as text; microphone/ASR is not evaluated.',
      'No independent real-provider UX evaluator is used; deterministic latency, session and whiteboard checks remain authoritative.',
      'No raw transcript, raw audio, account identity or provider response is persisted.',
    ],
  };
  await writeFile(path.join(runDirectory, 'live-brain-summary.json'), `${JSON.stringify(summary, null, 2)}\n`, { flag: 'wx' });
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  if (status !== 'PASSED') process.exitCode = 1;
}

await main();
