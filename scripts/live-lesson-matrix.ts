import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { hashAccountIdentity, loadAuthVerification, normalizeAccountEmail } from '../src/auth-bootstrap.js';
import { GuardedBrowserController, type BrowserEvent } from '../src/browser-controller.js';
import { loadConfig } from '../src/config.js';
import { createRunId } from '../src/run-store.js';
import { assertPrivatePath, loadStagingAppCheckDebugToken, loadStagingProfile } from '../src/staging-profile.js';
import { loadStagingResetConfig, StrictStagingResetAdapter } from '../src/staging-reset.js';

type CatalogLesson = { lessonId: string; title: string; gradeId: string; subjectId: string; chapterId: string };
type LessonResult = {
  lessonId: string;
  title: string;
  status: 'PASSED' | 'FAILED';
  setupComplete: boolean;
  lessonReady: boolean;
  verifierFeedback: boolean;
  hintResponse: boolean;
  boardObjectCount: number;
  semanticStage: boolean;
  semanticEntryCount: number;
  cleanStop: boolean;
  latencyMs: Record<string, number | null>;
  issues: string[];
};

type StageAudit = {
  semanticStage: boolean;
  semanticEntryCount: number;
  legacyEntryCount: number;
  issues: string[];
};

const wait = (durationMs: number) => new Promise(resolve => setTimeout(resolve, durationMs));

async function waitUntil(check: () => Promise<boolean> | boolean, timeoutMs: number, label: string): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return;
    await wait(400);
  }
  throw new Error(`Timed out waiting for ${label}.`);
}

function consoleLine(event: BrowserEvent): string {
  return event.event === 'console' ? JSON.stringify(event.data) : '';
}

function extractVoiceLatency(events: readonly BrowserEvent[]): Record<string, number | null> {
  const samples: number[] = [];
  let toolRejections = 0;
  for (const event of events) {
    const line = consoleLine(event);
    const match = line.match(/speech_end_to_first_ai_audio_ms\s+(\d+)/);
    if (match) samples.push(Number(match[1]));
    if (/tutor_action_gate\s+rejected/.test(line)) toolRejections += 1;
  }
  return {
    firstAudioLast: samples.at(-1) ?? null,
    firstAudioMax: samples.length ? Math.max(...samples) : null,
    firstAudioSamples: samples.length,
    tutorActionRejections: toolRejections,
  };
}

function collectEventIssues(events: readonly BrowserEvent[]): string[] {
  const issues = new Set<string>();
  for (const event of events) {
    const line = JSON.stringify(event.data);
    if (event.event === 'page-error') issues.add('PAGE_ERROR');
    if (event.event === 'request-denied') issues.add('REQUEST_DENIED');
    if (event.event === 'request-failed' && /\/api\/|generativelanguage\.googleapis\.com/.test(line)) issues.add('REQUEST_FAILED');
    if (/tutor_action_rejection_limit/.test(line)) issues.add('TUTOR_ACTION_REJECTION_LIMIT');
    if (/stop_output_audio\s+(?:quick_tutor_message|gemini_interrupted)/.test(line)) issues.add('AUDIO_INTERRUPTED');
    if (/APP_CHECK_REQUIRED|app_check_validation.*(?:invalid|missing)|FirebaseError.*App.?Check|auth_required|unauthorized|VERSION_CONFLICT|STATE_VERSION|revision conflict|state violation/i.test(line)) issues.add('AUTH_STATE_OR_REVISION_ERROR');
  }
  return [...issues];
}

async function auditLearningStage(page: ReturnType<GuardedBrowserController['runtime']>['page']): Promise<StageAudit> {
  return page.locator('.lesson-board-scene').evaluate((board) => {
    const stage = board.querySelector('.semantic-learning-stage');
    const semanticEntryCount = board.querySelectorAll('[data-stage-entry]').length;
    const legacyEntryCount = board.querySelectorAll('.board-math-block, svg > text, svg > polyline').length;
    const issues: string[] = [];
    if (!stage) return { semanticStage: false, semanticEntryCount, legacyEntryCount, issues };

    const zones = [...stage.querySelectorAll<SVGGElement>('[data-stage-region]')];
    const focused = zones.filter(zone => zone.classList.contains('is-focused'));
    if (zones.length !== 5) issues.push(`SEMANTIC_ZONE_COUNT_${zones.length}`);
    if (focused.length !== 1) issues.push(`SEMANTIC_FOCUS_COUNT_${focused.length}`);

    const svg = board.querySelector('svg');
    const svgBounds = svg?.getBoundingClientRect();
    const zoneBounds = zones.map(zone => ({
      region: zone.dataset.stageRegion ?? 'unknown',
      bounds: zone.querySelector('rect')?.getBoundingClientRect(),
      texts: [...zone.querySelectorAll<SVGTextElement>('text')],
    }));
    if (svgBounds) {
      for (const zone of zoneBounds) {
        const bounds = zone.bounds;
        if (!bounds || bounds.left < svgBounds.left - 1 || bounds.top < svgBounds.top - 1 || bounds.right > svgBounds.right + 1 || bounds.bottom > svgBounds.bottom + 1) {
          issues.push(`SEMANTIC_ZONE_OVERFLOW_${zone.region}`);
          continue;
        }
        for (const text of zone.texts) {
          const textBounds = text.getBoundingClientRect();
          if (textBounds.left < bounds.left - 1 || textBounds.top < bounds.top - 1 || textBounds.right > bounds.right + 1 || textBounds.bottom > bounds.bottom + 1) {
            issues.push(`SEMANTIC_TEXT_OVERFLOW_${zone.region}`);
            break;
          }
        }
      }
      for (let left = 0; left < zoneBounds.length; left += 1) {
        const first = zoneBounds[left]?.bounds;
        if (!first) continue;
        for (let right = left + 1; right < zoneBounds.length; right += 1) {
          const second = zoneBounds[right]?.bounds;
          if (!second) continue;
          const overlaps = first.left < second.right - 1 && first.right > second.left + 1 && first.top < second.bottom - 1 && first.bottom > second.top + 1;
          if (overlaps) issues.push(`SEMANTIC_ZONE_OVERLAP_${zoneBounds[left]?.region}_${zoneBounds[right]?.region}`);
        }
      }
    }
    return { semanticStage: true, semanticEntryCount, legacyEntryCount, issues: [...new Set(issues)] };
  });
}

async function discoverCatalog(page: ReturnType<GuardedBrowserController['runtime']>['page']): Promise<CatalogLesson[]> {
  const lessons: CatalogLesson[] = [];
  const gradeSelect = page.locator('select[data-qa="grade-option"]');
  const subjectSelect = page.locator('select[data-qa="subject-option"]');
  const chapterSelect = page.locator('select[data-qa="chapter-option"]');
  const lessonSelect = page.locator('select[data-qa="lesson-select"]');
  const gradeIds = await gradeSelect.locator('option').evaluateAll(options => options.map(option => (option as HTMLOptionElement).value).filter(Boolean));
  for (const gradeId of gradeIds) {
    await gradeSelect.selectOption(gradeId);
    const subjectIds = await subjectSelect.locator('option').evaluateAll(options => options.map(option => (option as HTMLOptionElement).value).filter(Boolean));
    for (const subjectId of subjectIds) {
      await subjectSelect.selectOption(subjectId);
      const chapterIds = await chapterSelect.locator('option').evaluateAll(options => options.map(option => (option as HTMLOptionElement).value).filter(Boolean));
      for (const chapterId of chapterIds) {
        await chapterSelect.selectOption(chapterId);
        const options = await lessonSelect.locator('option').evaluateAll(nodes => nodes.map(node => ({
          lessonId: (node as HTMLOptionElement).value,
          title: (node.textContent ?? '').trim(),
        })).filter(item => item.lessonId));
        for (const option of options) lessons.push({ ...option, gradeId, subjectId, chapterId });
      }
    }
  }
  return [...new Map(lessons.map(lesson => [lesson.lessonId, lesson])).values()];
}

async function main(): Promise<void> {
  const cwd = process.cwd();
  const env = process.env;
  const config = await loadConfig({ cwd, env });
  const profile = await loadStagingProfile({ config, cwd, env });
  const verification = await loadAuthVerification(cwd, profile);
  const resetConfig = await loadStagingResetConfig(cwd, profile);
  const resetAdapter = new StrictStagingResetAdapter({ config, resetConfig, env });
  const baseUrl = config.staging.baseUrl;
  if (!baseUrl) throw new Error('Staging target is not configured.');
  const audioPath = await assertPrivatePath(cwd, env.QA_FAKE_AUDIO_CAPTURE_PATH ?? '.qa-private/audio/live-checkin-vi-short.wav');
  const audioBase64 = (await readFile(audioPath)).toString('base64');
  const [profileDirectory, appCheckDebugToken] = await Promise.all([
    assertPrivatePath(cwd, profile.privatePaths.browserProfileDirectory),
    loadStagingAppCheckDebugToken(cwd, profile),
  ]);
  const runId = createRunId();
  const runDirectory = path.resolve(config.artifacts.root, runId);
  const browserDirectory = path.join(runDirectory, 'browser');
  await mkdir(browserDirectory, { recursive: true });
  const controller = new GuardedBrowserController({
    policy: { allowedHosts: [...new Set([...config.staging.allowedHosts, ...profile.auth.allowedHosts])] },
    artifactDirectory: browserDirectory,
    profileDirectory,
    preserveProfile: true,
    headless: env.QA_MATRIX_VISIBLE !== 'true',
    timeoutMs: 30_000,
    ...(appCheckDebugToken ? { appCheckDebugToken } : {}),
    voice: { enabled: true, audible: env.QA_MATRIX_AUDIBLE === 'true', permissions: ['microphone'] },
  });
  const results: LessonResult[] = [];
  const apiFailures: Array<{ status: number; path: string }> = [];
  try {
    await controller.open();
    const page = controller.runtime().page;
    page.on('response', response => {
      if (response.status() >= 400 && response.url().startsWith(baseUrl) && response.url().includes('/api/')) {
        apiFailures.push({ status: response.status(), path: new URL(response.url()).pathname });
      }
    });
    await page.addInitScript({ content: `
      (() => {
        const encodedAudio = ${JSON.stringify(audioBase64)};
        let context; let destination; let bufferPromise;
        function ensureAudio() {
          if (!context) {
            context = new AudioContext();
            destination = context.createMediaStreamDestination();
            const bytes = Uint8Array.from(atob(encodedAudio), character => character.charCodeAt(0));
            bufferPromise = context.decodeAudioData(bytes.buffer);
          }
          return { context, destination, bufferPromise };
        }
        const originalGetUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
        navigator.mediaDevices.getUserMedia = async constraints => !constraints?.audio ? originalGetUserMedia(constraints) : ensureAudio().destination.stream;
        window.__qaPlayVietnameseCheckin = async () => {
          const audio = ensureAudio(); await audio.context.resume();
          const source = audio.context.createBufferSource(); source.buffer = await audio.bufferPromise;
          source.connect(audio.destination); source.connect(audio.context.destination); source.start();
          return Math.round(source.buffer.duration * 1000);
        };
      })();
    ` });
    await page.setViewportSize({ width: 1440, height: 900 });
    await controller.navigate(new URL('/app', baseUrl).href);
    await page.locator('[data-qa="authenticated-shell"]:visible').waitFor({ state: 'visible' });
    await page.locator('[data-qa="account-trigger"]:visible').click();
    const accountText = (await page.locator('[data-qa="account-email"]:visible').first().textContent()) ?? '';
    if (hashAccountIdentity(normalizeAccountEmail(accountText)) !== verification.identityHash) throw new Error('QA account identity mismatch.');
    await page.keyboard.press('Escape');

    const discovered = await discoverCatalog(page);
    const pattern = env.QA_MATRIX_PATTERN ? new RegExp(env.QA_MATRIX_PATTERN) : null;
    const start = Number(env.QA_MATRIX_START ?? 0);
    const limit = Number(env.QA_MATRIX_LIMIT ?? discovered.length);
    if (!Number.isInteger(start) || start < 0 || !Number.isInteger(limit) || limit < 1) throw new Error('Invalid QA matrix range.');
    const selected = discovered.filter(lesson => !pattern || pattern.test(lesson.lessonId)).slice(start, start + limit);
    process.stdout.write(`${JSON.stringify({ runId, discoveredLessons: discovered.length, selectedLessons: selected.length, start, limit })}\n`);

    for (const [index, lesson] of selected.entries()) {
      const eventStart = controller.runtime().events.length;
      const apiStart = apiFailures.length;
      const startedAt = Date.now();
      const latencyMs: Record<string, number | null> = {};
      let setupComplete = false;
      let lessonReady = false;
      let verifierFeedback = false;
      let hintResponse = false;
      let boardObjectCount = 0;
      let semanticStage = false;
      let semanticEntryCount = 0;
      let cleanStop = false;
      const issues: string[] = [];
      try {
        const reset = await resetAdapter.reset({ accountIdentityHash: verification.identityHash, scope: 'live-lesson-matrix', lessonId: lesson.lessonId });
        if (reset.status !== 'READY') throw new Error(`MATRIX_RESET_BLOCKED:${reset.reason}`);
        await page.evaluate((lessonId) => {
          const prefix = `k12.lessonSession.${lessonId}.`;
          for (const key of Object.keys(localStorage)) if (key.startsWith(prefix)) localStorage.removeItem(key);
        }, lesson.lessonId);
        await controller.navigate(new URL(`/app/tutor?mode=foundation_recovery&lessonId=${encodeURIComponent(lesson.lessonId)}`, baseUrl).href);
        await page.locator(`[data-qa="lesson-ready"][data-lesson-id="${lesson.lessonId}"]:visible`).waitFor({ state: 'visible' });
        const setupStartedAt = Date.now();
        await page.locator('[data-qa="start-lesson"][data-session-control="start"]:visible').click();
        await waitUntil(() => controller.runtime().events.slice(eventStart).some(event => consoleLine(event).includes('setup_complete')), 60_000, 'Gemini setupComplete');
        setupComplete = true;
        latencyMs.startToSetupComplete = Date.now() - setupStartedAt;
        await page.locator('.ai-online.AI-speaking:visible').waitFor({ state: 'visible', timeout: 30_000 });
        await page.locator('.ai-online.listening:visible').waitFor({ state: 'visible', timeout: 60_000 });
        await page.evaluate('window.__qaPlayVietnameseCheckin()');
        await page.locator('.ai-online.user-speaking:visible').waitFor({ state: 'visible', timeout: 15_000 });
        const readyStartedAt = Date.now();
        const textInput = page.locator('form.ai-input input:visible').first();
        await waitUntil(() => textInput.isEnabled(), 120_000, 'lesson_ready');
        lessonReady = true;
        latencyMs.checkinToLessonReady = Date.now() - readyStartedAt;

        const previousTutor = ((await page.locator('.activity-history article').filter({ has: page.locator('span.ai') }).last().locator('p').textContent().catch(() => '')) ?? '').trim();
        const verifierStartedAt = Date.now();
        await textInput.fill('Con chưa chắc, xin kiểm tra giúp con.');
        await page.locator('form.ai-input button[type="submit"]:visible').click();
        await page.locator('.verification-message:visible').waitFor({ state: 'visible', timeout: 30_000 });
        verifierFeedback = true;
        latencyMs.answerToVerifierFeedback = Date.now() - verifierStartedAt;
        await waitUntil(async () => {
          const current = ((await page.locator('.activity-history article').filter({ has: page.locator('span.ai') }).last().locator('p').textContent().catch(() => '')) ?? '').trim();
          return current.length > 0 && current !== previousTutor;
        }, 15_000, 'optional answer response').catch(() => undefined);
        await page.locator('.ai-online.listening:visible').waitFor({ state: 'visible', timeout: 60_000 });

        const tutorBeforeHint = ((await page.locator('.activity-history article').filter({ has: page.locator('span.ai') }).last().locator('p').textContent().catch(() => '')) ?? '').trim();
        const hintStartedAt = Date.now();
        await page.getByRole('button', { name: 'Gợi ý bước tiếp', exact: true }).click();
        await waitUntil(async () => {
          const current = ((await page.locator('.activity-history article').filter({ has: page.locator('span.ai') }).last().locator('p').textContent().catch(() => '')) ?? '').trim();
          return current.length > 0 && current !== tutorBeforeHint;
        }, 60_000, 'hint response');
        hintResponse = true;
        latencyMs.hintToFirstResponse = Date.now() - hintStartedAt;
        await page.locator('.ai-online.listening:visible').waitFor({ state: 'visible', timeout: 60_000 });
        await waitUntil(() => page.locator('[data-stage-entry]').count().then(count => count > 0), 20_000, 'semantic board persistence').catch(() => undefined);
        const stageAudit = await auditLearningStage(page);
        semanticStage = stageAudit.semanticStage;
        semanticEntryCount = stageAudit.semanticEntryCount;
        boardObjectCount = stageAudit.semanticEntryCount + stageAudit.legacyEntryCount;
        issues.push(...stageAudit.issues);
        if (boardObjectCount < 1) issues.push('WHITEBOARD_EMPTY_AFTER_HINT');
        if (!semanticStage) issues.push('SEMANTIC_STAGE_MISSING');
        if (semanticEntryCount < 1) issues.push('SEMANTIC_STAGE_EMPTY_AFTER_HINT');
        const endResponse = page.waitForResponse(response => response.url().startsWith(baseUrl) && response.url().endsWith('/api/endLessonSession'), { timeout: 30_000 });
        await page.locator('[data-qa="start-lesson"][data-session-control="stop"]:visible').click();
        const ended = await endResponse;
        if (ended.status() !== 200) throw new Error(`END_SESSION_HTTP_${ended.status()}`);
        await page.locator('[data-qa="start-lesson"][data-session-control="start"]:visible').waitFor({ state: 'visible', timeout: 30_000 });
        await wait(1_000);
        cleanStop = true;
      } catch (error) {
        issues.push(error instanceof Error ? error.message : String(error));
        const stopButton = page.locator('[data-qa="start-lesson"][data-session-control="stop"]:visible').first();
        if (await stopButton.isVisible().catch(() => false)) {
          const endResponse = page.waitForResponse(response => response.url().startsWith(baseUrl) && response.url().endsWith('/api/endLessonSession'), { timeout: 15_000 }).catch(() => null);
          await stopButton.click().catch(() => undefined);
          await endResponse;
          await page.locator('[data-qa="start-lesson"][data-session-control="start"]:visible').waitFor({ state: 'visible', timeout: 15_000 }).then(() => { cleanStop = true; }).catch(() => undefined);
          await wait(1_000);
        }
      }
      const lessonEvents = controller.runtime().events.slice(eventStart);
      issues.push(...collectEventIssues(lessonEvents));
      for (const failure of apiFailures.slice(apiStart)) issues.push(`HTTP_${failure.status}:${failure.path}`);
      Object.assign(latencyMs, extractVoiceLatency(lessonEvents));
      latencyMs.total = Date.now() - startedAt;
      const uniqueIssues = [...new Set(issues)];
      const result: LessonResult = {
        lessonId: lesson.lessonId,
        title: lesson.title,
        status: setupComplete && lessonReady && verifierFeedback && hintResponse && boardObjectCount > 0 && semanticStage && semanticEntryCount > 0 && cleanStop && uniqueIssues.length === 0 ? 'PASSED' : 'FAILED',
        setupComplete, lessonReady, verifierFeedback, hintResponse, boardObjectCount, semanticStage, semanticEntryCount, cleanStop, latencyMs, issues: uniqueIssues,
      };
      results.push(result);
      await writeFile(path.join(runDirectory, 'live-lesson-matrix-progress.json'), `${JSON.stringify({ schemaVersion: 1, runId, catalogCount: discovered.length, results }, null, 2)}\n`);
      process.stdout.write(`${JSON.stringify({ index: start + index, ...result })}\n`);
    }

    const summary = {
      schemaVersion: 1,
      runId,
      target: baseUrl,
      syntheticOnly: true,
      catalogCount: discovered.length,
      selectedCount: selected.length,
      passed: results.filter(result => result.status === 'PASSED').length,
      failed: results.filter(result => result.status === 'FAILED').length,
      results,
    };
    await writeFile(path.join(runDirectory, 'live-lesson-matrix-summary.json'), `${JSON.stringify(summary, null, 2)}\n`, { flag: 'wx' });
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
    if (summary.failed > 0) process.exitCode = 1;
  } finally {
    await controller.close();
  }
}

main().catch(error => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
