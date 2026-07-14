import { createHash } from 'node:crypto';
import { lstat, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Page } from 'playwright';
import { z } from 'zod';
import { findAuthenticatedSessionScenario, type AuthenticatedSessionScenario } from './authenticated-session-scenario.js';
import { hashAccountIdentity, loadAuthVerification, normalizeAccountEmail } from './auth-bootstrap.js';
import { GuardedBrowserController, type BrowserEvent } from './browser-controller.js';
import type { BrowserTargetPolicy } from './browser-policy.js';
import { loadConfig, type QaConfig } from './config.js';
import { redactSecrets } from './redaction.js';
import { createRunId } from './run-store.js';
import { assertPrivatePath, loadStagingProfile, type StagingProfile } from './staging-profile.js';
import {
  loadStagingResetConfig,
  type StagingResetRequest,
  type StagingResetResult,
  StrictStagingResetAdapter,
} from './staging-reset.js';
import { WEB_VIEWPORTS } from './web-scenario.js';

const sessionIssueSchema = z.object({
  id: z.string(),
  severity: z.enum(['BLOCKER', 'HIGH', 'MEDIUM', 'LOW']),
  category: z.enum(['prerequisite', 'reset', 'identity', 'registry', 'navigation', 'session', 'provider', 'console', 'network', 'cleanup']),
  title: z.string(),
  expected: z.string(),
  actual: z.string(),
  evidence: z.array(z.string()).min(1),
  limitations: z.string(),
}).strict();
export type SessionIssue = z.infer<typeof sessionIssueSchema>;

export interface SessionCheck {
  readonly check: string;
  readonly passed: boolean;
  readonly details: string;
}

export interface AuthenticatedSessionQaResult {
  readonly runId: string;
  readonly status: 'PASSED' | 'FAILED' | 'BLOCKED';
  readonly artifactDirectory: string;
  readonly lessonId: string;
  readonly activeStatus?: string;
  readonly connectLatencyMs?: number;
  readonly issues: readonly SessionIssue[];
  readonly checks: readonly SessionCheck[];
}

export interface SessionResetGate {
  reset(request: StagingResetRequest): Promise<StagingResetResult>;
}

export interface AuthenticatedSessionQaOptions {
  readonly cwd?: string;
  readonly config: QaConfig;
  readonly profile: StagingProfile;
  readonly scenario: AuthenticatedSessionScenario;
  readonly verifiedIdentityHash: string;
  readonly reset: SessionResetGate;
  readonly artifactRoot: string;
  readonly runId: string;
  readonly baseUrl?: string;
  readonly policy?: BrowserTargetPolicy;
}

function safeRunId(value: string): string {
  if (!/^[A-Za-z0-9._-]+$/.test(value) || value === '.' || value === '..') throw new Error('Unsafe run id.');
  return value;
}

function issueId(scenarioId: string, category: string, actual: string): string {
  return `SES-${createHash('sha256').update(`${scenarioId}|${category}|${actual}`).digest('hex').slice(0, 12).toUpperCase()}`;
}

function escapeHtml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}

function addBrowserEventIssues(events: readonly BrowserEvent[], addIssue: (draft: Omit<SessionIssue, 'id'>) => void): void {
  for (const event of events) {
    const actual = JSON.stringify(redactSecrets(event.data));
    if (event.event === 'console' && /"type":"(error|assert)"/.test(actual)) {
      addIssue({ severity: 'HIGH', category: 'console', title: 'Console blocker captured', expected: 'No console errors during session start', actual, evidence: ['browser/browser-events.jsonl'], limitations: 'Console impact requires product triage.' });
    }
    if ((event.event === 'request-failed' && !/net::ERR_ABORTED/.test(actual)) || event.event === 'page-error' || event.event === 'request-denied') {
      addIssue({ severity: 'HIGH', category: 'network', title: 'Runtime or network blocker captured', expected: 'No failed or denied session request', actual: `${event.event}: ${actual}`, evidence: ['browser/browser-events.jsonl'], limitations: 'Navigation net::ERR_ABORTED is ignored; all other failures are conservative blockers.' });
    }
  }
}

async function observedIdentityHash(page: Page, profile: StagingProfile, selector: string): Promise<string> {
  const identity = page.locator(selector).first();
  await identity.waitFor({ state: 'visible' });
  let raw = '';
  if (profile.auth.accountIdentitySource === 'value') raw = await identity.inputValue();
  else if (profile.auth.accountIdentitySource === 'data-email') raw = (await identity.getAttribute('data-email')) ?? '';
  else raw = (await identity.textContent()) ?? '';
  return hashAccountIdentity(normalizeAccountEmail(raw));
}

async function waitForSessionStatus(
  page: Page,
  selector: string,
  statuses: readonly string[],
  timeout: number,
): Promise<string> {
  await page.waitForFunction(
    ({ target, allowed }) => {
      const status = document.querySelector(target)?.getAttribute('data-session-status') ?? '';
      return allowed.includes(status);
    },
    { target: selector, allowed: [...statuses] },
    { timeout },
  );
  return (await page.locator(selector).first().getAttribute('data-session-status')) ?? '';
}

class ProviderUnavailableError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'ProviderUnavailableError';
  }
}

async function waitForSessionStartOutcome(
  page: Page,
  statusSelector: string,
  errorSelector: string,
  statuses: readonly string[],
  timeout: number,
): Promise<string> {
  await page.waitForFunction(
    ({ statusTarget, errorTarget, allowed }) => {
      const status = document.querySelector(statusTarget)?.getAttribute('data-session-status') ?? '';
      const error = document.querySelector(errorTarget)?.textContent?.trim() ?? '';
      return allowed.includes(status) || error.length > 0;
    },
    { statusTarget: statusSelector, errorTarget: errorSelector, allowed: [...statuses] },
    { timeout },
  );
  const error = (await page.locator(errorSelector).first().textContent().catch(() => null))?.trim();
  if (error) throw new ProviderUnavailableError(error.slice(0, 500));
  return (await page.locator(statusSelector).first().getAttribute('data-session-status')) ?? '';
}

async function writeReports(
  directory: string,
  result: Omit<AuthenticatedSessionQaResult, 'artifactDirectory'>,
  scenario: Pick<AuthenticatedSessionScenario, 'id' | 'name'>,
): Promise<void> {
  const summary = {
    schemaVersion: 1,
    status: result.status,
    checks: { total: result.checks.length, passed: result.checks.filter((check) => check.passed).length },
    issues: result.issues.length,
    lessonId: result.lessonId,
    activeStatus: result.activeStatus ?? null,
    connectLatencyMs: result.connectLatencyMs ?? null,
    limitations: [
      'This smoke proves authenticated session creation, real staging realtime connection, and clean stop only.',
      'Synthetic silent microphone input is used; tutor pedagogy, transcript quality, mastery, OCR, and child voice are not evaluated.',
    ],
  };
  const markdown = `# TutorProof authenticated session-start QA\n\n- Status: **${result.status}**\n- Scenario: \`${scenario.id}\`\n- Lesson: \`${result.lessonId}\`\n- Active status: ${result.activeStatus ?? 'not reached'}\n- Connect latency: ${result.connectLatencyMs === undefined ? 'not measured' : `${result.connectLatencyMs} ms`}\n- Checks: ${summary.checks.passed}/${summary.checks.total}\n- Issues: ${result.issues.length}\n\n## Scope limits\n\n- No student turn, transcript scoring, mastery, verifier, OCR, or real child audio.\n`;
  const html = `<!doctype html><meta charset="utf-8"><title>TutorProof session-start report</title><h1>${escapeHtml(scenario.name)}</h1><p>Status: <strong>${escapeHtml(result.status)}</strong></p><p>Lesson: <code>${escapeHtml(result.lessonId)}</code></p><p>Checks: ${summary.checks.passed}/${summary.checks.total}</p><ul>${result.issues.map((issue) => `<li><strong>${escapeHtml(issue.severity)}</strong> ${escapeHtml(issue.title)}: ${escapeHtml(issue.actual)}</li>`).join('')}</ul>`;
  await Promise.all([
    writeFile(path.join(directory, 'run.json'), `${JSON.stringify({ schemaVersion: 1, runner: 'authenticated-session-start', runId: result.runId, scenarioId: scenario.id, status: result.status }, null, 2)}\n`, { flag: 'wx' }),
    writeFile(path.join(directory, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`, { flag: 'wx' }),
    writeFile(path.join(directory, 'issues.json'), `${JSON.stringify({ schemaVersion: 1, issues: result.issues }, null, 2)}\n`, { flag: 'wx' }),
    writeFile(path.join(directory, 'checks.json'), `${JSON.stringify({ schemaVersion: 1, checks: result.checks }, null, 2)}\n`, { flag: 'wx' }),
    writeFile(path.join(directory, 'report.md'), markdown, { flag: 'wx' }),
    writeFile(path.join(directory, 'report.html'), html, { flag: 'wx' }),
  ]);
}

export async function runAuthenticatedSessionStartQa(
  options: AuthenticatedSessionQaOptions,
): Promise<AuthenticatedSessionQaResult> {
  const cwd = path.resolve(options.cwd ?? process.cwd());
  await mkdir(path.resolve(options.artifactRoot), { recursive: true });
  const runDirectory = path.resolve(options.artifactRoot, safeRunId(options.runId));
  await mkdir(runDirectory, { recursive: false });
  const browserDirectory = path.join(runDirectory, 'browser');
  const issues: SessionIssue[] = [];
  const checks: SessionCheck[] = [];
  const addIssue = (draft: Omit<SessionIssue, 'id'>): void => {
    if (issues.length >= options.scenario.limits.maxIssues) return;
    const issue = sessionIssueSchema.parse({ ...draft, id: issueId(options.scenario.id, draft.category, draft.actual) });
    if (!issues.some((candidate) => candidate.id === issue.id)) issues.push(issue);
  };
  let blocked = false;
  let profileDirectory = '';
  let activeStatus: string | undefined;
  let connectLatencyMs: number | undefined;
  let sessionStarted = false;
  let sessionStopped = false;

  if (!options.baseUrl) {
    blocked = true;
    addIssue({ severity: 'BLOCKER', category: 'prerequisite', title: 'Typed staging target is missing', expected: 'Approved exact HTTPS staging target', actual: 'No reset or browser action was attempted.', evidence: ['run.json'], limitations: 'Prerequisite failure only.' });
  } else {
    try {
      profileDirectory = await assertPrivatePath(cwd, options.profile.privatePaths.browserProfileDirectory);
      const stats = await lstat(profileDirectory);
      if (!stats.isDirectory() || stats.isSymbolicLink()) throw new Error('unsafe profile');
    } catch {
      blocked = true;
      addIssue({ severity: 'BLOCKER', category: 'prerequisite', title: 'Verified persistent browser profile is unavailable', expected: 'Safe persistent test-account profile beneath .qa-private/', actual: 'Profile is missing, malformed, or unsafe.', evidence: ['run.json'], limitations: 'No reset or browser action was attempted.' });
    }
  }

  if (!blocked) {
    const reset = await options.reset.reset({ accountIdentityHash: options.verifiedIdentityHash, scope: options.scenario.reset.scope });
    if (reset.status !== 'READY') {
      blocked = true;
      addIssue({ severity: 'BLOCKER', category: 'reset', title: 'Strict staging reset did not become ready', expected: `Allowlisted reset scope ${options.scenario.reset.scope}`, actual: reset.reason, evidence: ['run.json'], limitations: 'No browser was launched after reset refusal.' });
    } else {
      checks.push({ check: 'reset:strict-scope-ready', passed: true, details: options.scenario.reset.scope });
    }
  }

  if (!blocked && options.baseUrl) {
    await mkdir(browserDirectory);
    const policy: BrowserTargetPolicy = options.policy ?? { allowedHosts: [...new Set([...options.config.staging.allowedHosts, ...options.profile.auth.allowedHosts])] };
    const controller = new GuardedBrowserController({
      policy,
      artifactDirectory: browserDirectory,
      profileDirectory,
      preserveProfile: true,
      timeoutMs: options.scenario.limits.selectorTimeoutMs,
      voice: { enabled: true, permissions: ['microphone'], args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] },
    });
    let opened = false;
    try {
      const deadline = Date.now() + options.scenario.limits.maxMinutes * 60_000;
      await controller.open();
      opened = true;
      const page = controller.runtime().page;
      await page.setViewportSize(WEB_VIEWPORTS.laptop);
      await controller.navigate(new URL(options.scenario.target.path, options.baseUrl).href);
      await page.locator(options.scenario.selectors.authenticatedShell).first().waitFor({ state: 'visible' });
      checks.push({ check: 'auth:shell-visible', passed: true, details: 'data-qa' });
      if (await observedIdentityHash(page, options.profile, options.scenario.selectors.accountIdentity) !== options.verifiedIdentityHash) {
        throw new Error('Authenticated account identity hash did not match the verified profile.');
      }
      checks.push({ check: 'auth:verified-identity-hash', passed: true, details: options.verifiedIdentityHash });

      const lesson = page.locator(options.scenario.selectors.lesson).first();
      await lesson.waitFor({ state: 'visible' });
      if ((await lesson.getAttribute('data-lesson-id')) !== options.scenario.lesson.id
        || (await lesson.getAttribute(options.scenario.lesson.registryStatusAttribute)) !== options.scenario.lesson.approvedRegistryValue) {
        throw new Error('Selected lesson does not match the approved scenario registry contract.');
      }
      checks.push({ check: 'registry:approved-exact-lesson', passed: true, details: options.scenario.lesson.id });
      const clearedPointers = await page.evaluate((targetLessonId) => {
        const prefix = `k12.lessonSession.${targetLessonId}.`;
        const keys = Object.keys(localStorage).filter((key) => key.startsWith(prefix));
        for (const key of keys) localStorage.removeItem(key);
        return keys.length;
      }, options.scenario.lesson.id);
      checks.push({ check: 'reset:scoped-client-session-pointer', passed: true, details: String(clearedPointers) });
      await Promise.all([page.waitForURL(/\/app\/tutor(?:\?|$)/), lesson.click()]);
      const classroom = page.locator(options.scenario.selectors.classroomReady).first();
      await classroom.waitFor({ state: 'visible' });
      if ((await classroom.getAttribute('data-lesson-id')) !== options.scenario.lesson.id) throw new Error('Classroom lesson ID continuity failed.');
      checks.push({ check: 'classroom:lesson-id-continuity', passed: true, details: options.scenario.lesson.id });
      if (Date.now() > deadline) throw new Error('Session-start smoke exceeded its bounded deadline.');

      const start = page.locator(options.scenario.selectors.start).first();
      await start.waitFor({ state: 'visible' });
      const startedAt = Date.now();
      await start.click();
      sessionStarted = true;
      activeStatus = await waitForSessionStartOutcome(page, options.scenario.selectors.status, options.scenario.selectors.error, options.scenario.expected.activeStatuses, options.scenario.limits.activeTimeoutMs);
      connectLatencyMs = Date.now() - startedAt;
      checks.push({ check: 'session:real-staging-connected', passed: true, details: activeStatus });
      await page.screenshot({ path: path.join(browserDirectory, 'connected.png'), fullPage: true, mask: [page.locator(options.profile.auth.accountIdentitySelector)] });

      const stop = page.locator(options.scenario.selectors.stop).first();
      await stop.waitFor({ state: 'visible' });
      await stop.click();
      await waitForSessionStatus(page, options.scenario.selectors.status, [options.scenario.expected.stoppedStatus], options.scenario.limits.selectorTimeoutMs);
      sessionStopped = true;
      checks.push({ check: 'session:clean-stop', passed: true, details: options.scenario.expected.stoppedStatus });
      await page.screenshot({ path: path.join(browserDirectory, 'stopped.png'), fullPage: true, mask: [page.locator(options.profile.auth.accountIdentitySelector)] });
    } catch (error) {
      const actual = error instanceof Error ? error.message : String(error);
      if (error instanceof ProviderUnavailableError) blocked = true;
      addIssue({ severity: error instanceof ProviderUnavailableError ? 'BLOCKER' : 'HIGH', category: error instanceof ProviderUnavailableError ? 'provider' : /identity/i.test(actual) ? 'identity' : /registry|lesson ID/i.test(actual) ? 'registry' : /reset/i.test(actual) ? 'reset' : 'session', title: error instanceof ProviderUnavailableError ? 'Realtime provider is unavailable' : 'Authenticated session-start smoke could not complete', expected: 'Verified account, exact approved G12 lesson, real staging connection, then clean stop', actual, evidence: ['browser/failure.json'], limitations: 'The runner does not force product state, mutate provider billing, or downgrade a runtime failure.' });
      await writeFile(path.join(browserDirectory, 'failure.json'), `${JSON.stringify({ schemaVersion: 1, status: 'FAILED', reason: redactSecrets(actual) }, null, 2)}\n`, { flag: 'wx' });
      if (opened) {
        const page = controller.runtime().page;
        await page.screenshot({ path: path.join(browserDirectory, 'failure.png'), fullPage: true, mask: [page.locator(options.profile.auth.accountIdentitySelector)] }).catch(() => undefined);
      }
    } finally {
      if (opened && sessionStarted && !sessionStopped) {
        const page = controller.runtime().page;
        try {
          const stop = page.locator(options.scenario.selectors.stop).first();
          if (await stop.isVisible()) await stop.click();
          await waitForSessionStatus(page, options.scenario.selectors.status, [options.scenario.expected.stoppedStatus], options.scenario.limits.selectorTimeoutMs);
          sessionStopped = true;
          checks.push({ check: 'cleanup:stop-after-failure', passed: true, details: options.scenario.expected.stoppedStatus });
        } catch {
          addIssue({ severity: 'HIGH', category: 'cleanup', title: 'Started session could not be stopped through the UI', expected: 'Disconnected session before browser close', actual: 'Browser close and a second strict reset were required.', evidence: ['browser/failure.json'], limitations: 'The browser close terminates the client transport; reset covers only the allowlisted staging session record.' });
        }
      }
      if (opened) addBrowserEventIssues(controller.runtime().events, addIssue);
      await controller.close();
      if (sessionStarted && !sessionStopped) {
        const cleanup = await options.reset.reset({ accountIdentityHash: options.verifiedIdentityHash, scope: options.scenario.reset.scope });
        checks.push({ check: 'cleanup:strict-reset-after-failure', passed: cleanup.status === 'READY', details: cleanup.reason });
      }
    }
  }

  const status = blocked ? 'BLOCKED' : issues.some((issue) => ['BLOCKER', 'HIGH'].includes(issue.severity)) ? 'FAILED' : 'PASSED';
  const result = {
    runId: options.runId,
    status,
    lessonId: options.scenario.lesson.id,
    ...(activeStatus === undefined ? {} : { activeStatus }),
    ...(connectLatencyMs === undefined ? {} : { connectLatencyMs }),
    issues,
    checks,
  } as const;
  await writeReports(runDirectory, result, options.scenario);
  return { ...result, artifactDirectory: runDirectory };
}

export async function runConfiguredAuthenticatedSessionStartQa(
  scenarioId = 'gia-su-ai-session-start',
  options: { readonly cwd?: string; readonly env?: NodeJS.ProcessEnv; readonly loadEnvFile?: boolean; readonly runId?: string } = {},
): Promise<AuthenticatedSessionQaResult> {
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const env = options.env ?? process.env;
  const config = await loadConfig({ cwd, env, ...(options.loadEnvFile === undefined ? {} : { loadEnvFile: options.loadEnvFile }) });
  const [profile, scenario] = await Promise.all([
    loadStagingProfile({ config, cwd, env }),
    findAuthenticatedSessionScenario(scenarioId, path.join(cwd, 'scenarios', 'authenticated')),
  ]);
  if (!profile.suites.journeyIds.includes(scenario.id)) throw new Error('Session scenario is not linked to the staging profile.');
  const [verification, resetConfig] = await Promise.all([
    loadAuthVerification(cwd, profile),
    loadStagingResetConfig(cwd, profile),
  ]);
  if (verification.profileId !== profile.id || verification.identityHash !== resetConfig.expectedAccountIdentityHash) {
    throw new Error('Reset config does not match the verified staging profile identity.');
  }
  return runAuthenticatedSessionStartQa({
    cwd,
    config,
    profile,
    scenario,
    verifiedIdentityHash: verification.identityHash,
    reset: new StrictStagingResetAdapter({ config, resetConfig, env }),
    artifactRoot: path.resolve(cwd, config.artifacts.root),
    runId: options.runId ?? createRunId(),
    ...(config.staging.baseUrl ? { baseUrl: config.staging.baseUrl } : {}),
  });
}
