import { createHash } from 'node:crypto';
import { lstat, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Page } from 'playwright';
import { z } from 'zod';
import { hashAccountIdentity, loadAuthVerification, normalizeAccountEmail } from './auth-bootstrap.js';
import { GuardedBrowserController, type BrowserEvent } from './browser-controller.js';
import type { BrowserTargetPolicy } from './browser-policy.js';
import { loadConfig, type QaConfig } from './config.js';
import { findGuidedSelfStudyScenario, GUIDED_SELF_STUDY_VIEWPORTS, type GuidedSelfStudyScenario } from './guided-self-study-scenario.js';
import { redactSecrets } from './redaction.js';
import { createRunId } from './run-store.js';
import { assertPrivatePath, loadStagingProfile, type StagingProfile } from './staging-profile.js';
import { loadStagingResetConfig, StrictStagingResetAdapter, type StagingResetResult } from './staging-reset.js';

const issueSchema = z.object({
  id: z.string(), severity: z.enum(['BLOCKER', 'HIGH', 'MEDIUM', 'LOW']),
  category: z.enum(['prerequisite', 'reset', 'identity', 'package', 'transition', 'verifier', 'resume', 'console', 'network', 'layout', 'accessibility']),
  viewport: z.string(), title: z.string(), expected: z.string(), actual: z.string(), evidence: z.array(z.string()).min(1), limitations: z.string(),
}).strict();
export type GuidedSelfStudyIssue = z.infer<typeof issueSchema>;

export interface GuidedSelfStudyCheck { readonly viewport: string; readonly check: string; readonly passed: boolean; readonly details: string }
export interface GuidedSelfStudyQaResult { readonly runId: string; readonly status: 'PASSED' | 'FAILED' | 'BLOCKED'; readonly artifactDirectory: string; readonly checks: readonly GuidedSelfStudyCheck[]; readonly issues: readonly GuidedSelfStudyIssue[] }
export interface GuidedSelfStudyReset { reset(input: { accountIdentityHash: string; scope: string }): Promise<StagingResetResult> }
export interface GuidedSelfStudyQaOptions {
  readonly cwd?: string; readonly config: QaConfig; readonly profile: StagingProfile; readonly scenario: GuidedSelfStudyScenario;
  readonly verifiedIdentityHash: string; readonly reset: GuidedSelfStudyReset; readonly artifactRoot: string; readonly runId: string;
  readonly baseUrl?: string; readonly policy?: BrowserTargetPolicy;
}

export const GUIDED_SELF_STUDY_CRITICAL_API_PATHS = Object.freeze([
  '/api/startOrResumeGuidedSelfStudy',
  '/api/advanceGuidedSelfStudy',
  '/api/submitLessonAnswer',
] as const);
const SELF_STUDY_DENIED_HOSTS = Object.freeze(['generativelanguage.googleapis.com'] as const);
type CriticalApiPath = typeof GUIDED_SELF_STUDY_CRITICAL_API_PATHS[number];
export type AppCheckRequestEvidence = Readonly<Record<CriticalApiPath, { readonly requests: number; readonly withHeader: number }>>;

function safeRunId(value: string): string { if (!/^[A-Za-z0-9._-]+$/.test(value) || value === '.' || value === '..') throw new Error('Unsafe run id.'); return value; }
function issueId(scenarioId: string, viewport: string, category: string, actual: string): string { return `GSS-${createHash('sha256').update(`${scenarioId}|${viewport}|${category}|${actual}`).digest('hex').slice(0, 12).toUpperCase()}`; }
function escapeHtml(value: string): string { return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;'); }

export function hasFirebaseAppCheckHeader(headers: Record<string, string>): boolean {
  return typeof headers['x-firebase-appcheck'] === 'string' && headers['x-firebase-appcheck'].trim().length > 0;
}

export function appCheckCoverageFailures(evidence: AppCheckRequestEvidence): readonly string[] {
  return GUIDED_SELF_STUDY_CRITICAL_API_PATHS.flatMap((endpoint) => {
    const observed = evidence[endpoint];
    if (observed.requests === 0) return [`${endpoint}:not-observed`];
    if (observed.withHeader !== observed.requests) return [`${endpoint}:${observed.withHeader}/${observed.requests}`];
    return [];
  });
}

function emptyAppCheckEvidence(): Record<CriticalApiPath, { requests: number; withHeader: number }> {
  return Object.fromEntries(GUIDED_SELF_STUDY_CRITICAL_API_PATHS.map((endpoint) => [endpoint, { requests: 0, withHeader: 0 }])) as Record<CriticalApiPath, { requests: number; withHeader: number }>;
}

async function waitState(page: Page, playerSelector: string, state: string, timeout: number) {
  const player = page.locator(`${playerSelector}[data-activity-state="${state}"]`).first();
  await player.waitFor({ state: 'visible', timeout });
  return player;
}

async function submitAnswer(page: Page, scenario: GuidedSelfStudyScenario, exerciseId: string, answer: string, expectedResult: 'correct' | 'incorrect'): Promise<void> {
  const player = page.locator(`${scenario.selectors.player}[data-exercise-id="${exerciseId}"]`).first();
  await player.waitFor({ state: 'visible', timeout: scenario.limits.transitionTimeoutMs });
  if (await player.getAttribute('data-exercise-id') !== exerciseId) throw new Error(`Exercise continuity mismatch for ${exerciseId}.`);
  await page.locator(scenario.selectors.answer).fill(answer);
  await page.locator(scenario.selectors.submit).click();
  const verification = page.locator(`${scenario.selectors.verification}[data-verification-result="${expectedResult}"]`).first();
  await verification.waitFor({ state: 'visible', timeout: scenario.limits.transitionTimeoutMs });
}

function browserIssues(events: readonly BrowserEvent[], viewport: string, addIssue: (draft: Omit<GuidedSelfStudyIssue, 'id'>) => void): void {
  for (const event of events) {
    const actual = JSON.stringify(redactSecrets(event.data));
    const expectedRecaptchaStorageWarning = event.event === 'console' && /requestStorageAccess: Permission denied/i.test(actual) && /google\.com\/recaptcha\/enterprise/i.test(actual);
    const expectedRecaptchaCspReport = event.event === 'console' && /Framing 'https:\/\/www\.google\.com\/' violates the following report-only Content Security Policy directive/i.test(actual) && /frame-ancestors 'self'/i.test(actual) && /no further action has been taken/i.test(actual);
    if (expectedRecaptchaStorageWarning || expectedRecaptchaCspReport) continue;
    if (event.event === 'console' && /"type":"(error|assert)"/.test(actual)) addIssue({ severity: 'HIGH', category: 'console', viewport, title: 'Console blocker captured', expected: 'No product console errors', actual, evidence: [`${viewport}/browser-events.jsonl`], limitations: 'The known headless reCAPTCHA storage-access warning is excluded; other console errors fail.' });
    if ((event.event === 'request-failed' && !/net::ERR_ABORTED/.test(actual)) || event.event === 'page-error' || event.event === 'request-denied') addIssue({ severity: 'HIGH', category: 'network', viewport, title: 'Runtime or network blocker captured', expected: 'No failed or denied request', actual: `${event.event}: ${actual}`, evidence: [`${viewport}/browser-events.jsonl`], limitations: 'Navigation aborts are excluded; all other failures are conservative blockers.' });
  }
}

async function layout(page: Page): Promise<{ horizontalOverflow: number; blockingOverlay: number }> {
  return page.evaluate(() => {
    const elements = [...document.querySelectorAll<HTMLElement>('body *')].filter((element) => { const style = getComputedStyle(element); return style.display !== 'none' && style.visibility !== 'hidden'; });
    return {
      horizontalOverflow: document.documentElement.scrollWidth > innerWidth + 2 ? 1 : 0,
      blockingOverlay: elements.filter((element) => { const style = getComputedStyle(element); const rect = element.getBoundingClientRect(); return ['fixed', 'sticky'].includes(style.position) && rect.width * rect.height > innerWidth * innerHeight * 0.5; }).length,
    };
  });
}

async function productAssetFingerprint(page: Page, baseUrl: string): Promise<string> {
  const origin = new URL(baseUrl).origin;
  const assetPaths = await page.evaluate((expectedOrigin) => {
    const urls = [
      ...performance.getEntriesByType('resource').map((entry) => entry.name),
      ...[...document.querySelectorAll<HTMLScriptElement>('script[src]')].map((element) => element.src),
      ...[...document.querySelectorAll<HTMLLinkElement>('link[href]')].map((element) => element.href),
    ];
    return [...new Set(urls.flatMap((value) => {
      try {
        const url = new URL(value, location.href);
        return url.origin === expectedOrigin && url.pathname.startsWith('/assets/') ? [`${url.pathname}${url.search}`] : [];
      } catch { return []; }
    }))].sort();
  }, origin);
  if (assetPaths.length === 0) throw new Error('Product deployment asset fingerprint is unavailable.');
  return createHash('sha256').update(assetPaths.join('\n')).digest('hex');
}

async function writeReports(directory: string, result: Omit<GuidedSelfStudyQaResult, 'artifactDirectory'>, scenario: Pick<GuidedSelfStudyScenario, 'id' | 'name'>): Promise<void> {
  const passed = result.checks.filter((check) => check.passed).length;
  const summary = { schemaVersion: 1, status: result.status, checks: { total: result.checks.length, passed }, issues: result.issues.length, limitations: ['Synthetic staging account only; deterministic self-study journey; no Gemini, payment, real child data, or production.'] };
  const markdown = `# TutorProof guided self-study QA\n\n- Status: **${result.status}**\n- Scenario: \`${scenario.id}\`\n- Checks: ${passed}/${result.checks.length}\n- Issues: ${result.issues.length}\n\n## Issues\n${result.issues.map((issue) => `- **${issue.severity}** ${issue.title}: ${issue.actual}`).join('\n') || '- None'}\n`;
  const html = `<!doctype html><meta charset="utf-8"><title>TutorProof guided self-study report</title><h1>${escapeHtml(scenario.name)}</h1><p>Status: <strong>${result.status}</strong></p><p>Checks: ${passed}/${result.checks.length}</p><ul>${result.issues.map((issue) => `<li><strong>${issue.severity}</strong> ${escapeHtml(issue.title)}: ${escapeHtml(issue.actual)}</li>`).join('')}</ul>`;
  await Promise.all([
    writeFile(path.join(directory, 'run.json'), `${JSON.stringify({ schemaVersion: 1, runner: 'authenticated-guided-self-study', runId: result.runId, scenarioId: scenario.id, status: result.status }, null, 2)}\n`, { flag: 'wx' }),
    writeFile(path.join(directory, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`, { flag: 'wx' }),
    writeFile(path.join(directory, 'checks.json'), `${JSON.stringify({ schemaVersion: 1, checks: result.checks }, null, 2)}\n`, { flag: 'wx' }),
    writeFile(path.join(directory, 'issues.json'), `${JSON.stringify({ schemaVersion: 1, issues: result.issues }, null, 2)}\n`, { flag: 'wx' }),
    writeFile(path.join(directory, 'report.md'), markdown, { flag: 'wx' }), writeFile(path.join(directory, 'report.html'), html, { flag: 'wx' }),
  ]);
}

export async function runGuidedSelfStudyQa(options: GuidedSelfStudyQaOptions): Promise<GuidedSelfStudyQaResult> {
  const cwd = path.resolve(options.cwd ?? process.cwd());
  await mkdir(path.resolve(options.artifactRoot), { recursive: true });
  const runDirectory = path.resolve(options.artifactRoot, safeRunId(options.runId)); await mkdir(runDirectory, { recursive: false });
  const issues: GuidedSelfStudyIssue[] = []; const checks: GuidedSelfStudyCheck[] = [];
  const addIssue = (draft: Omit<GuidedSelfStudyIssue, 'id'>) => { if (issues.length >= options.scenario.limits.maxIssues) return; const issue = issueSchema.parse({ ...draft, id: issueId(options.scenario.id, draft.viewport, draft.category, draft.actual) }); if (!issues.some((item) => item.id === issue.id)) issues.push(issue); };
  let blocked = false; let profileDirectory = '';
  if (!options.baseUrl) blocked = true;
  else try { profileDirectory = await assertPrivatePath(cwd, options.profile.privatePaths.browserProfileDirectory); const stats = await lstat(profileDirectory); if (!stats.isDirectory() || stats.isSymbolicLink()) throw new Error('unsafe profile'); } catch { blocked = true; }
  if (blocked) addIssue({ severity: 'BLOCKER', category: 'prerequisite', viewport: 'run', title: 'Guided self-study prerequisites are unavailable', expected: 'Typed staging target and safe verified profile', actual: 'No browser was launched.', evidence: ['run.json'], limitations: 'Fail-closed prerequisite result.' });

  if (!blocked && options.baseUrl) {
    const basePolicy = options.policy ?? { allowedHosts: [...new Set([...options.config.staging.allowedHosts, ...options.profile.auth.allowedHosts])] };
    const policy: BrowserTargetPolicy = {
      ...basePolicy,
      deniedHosts: [...new Set([...(basePolicy.deniedHosts ?? []), ...SELF_STUDY_DENIED_HOSTS])],
    };
    const deadline = Date.now() + options.scenario.limits.maxMinutes * 60_000;
    for (const viewport of options.scenario.viewports) {
      const viewportDirectory = path.join(runDirectory, viewport); await mkdir(viewportDirectory);
      const reset = await options.reset.reset({ accountIdentityHash: options.verifiedIdentityHash, scope: options.scenario.reset.scope });
      if (reset.status !== 'READY') { blocked = true; addIssue({ severity: 'BLOCKER', category: 'reset', viewport, title: 'Strict staging reset was blocked', expected: 'Identity-bound scoped reset READY', actual: reset.reason, evidence: [`${viewport}/reset.json`], limitations: 'The journey is not executed after a failed reset.' }); await writeFile(path.join(viewportDirectory, 'reset.json'), `${JSON.stringify(redactSecrets(reset), null, 2)}\n`, { flag: 'wx' }); continue; }
      await writeFile(path.join(viewportDirectory, 'reset.json'), `${JSON.stringify(redactSecrets(reset), null, 2)}\n`, { flag: 'wx' });
      checks.push({ viewport, check: 'reset:strict-ready', passed: true, details: reset.resetVersion ?? 'manual' });
      const controller = new GuardedBrowserController({ policy, artifactDirectory: viewportDirectory, profileDirectory, preserveProfile: true, timeoutMs: options.scenario.limits.selectorTimeoutMs });
      let opened = false; const observedHosts = new Set<string>(); const appCheckEvidence = emptyAppCheckEvidence();
      try {
        if (Date.now() > deadline) throw new Error('Guided self-study run exceeded its bounded deadline.');
        await controller.open(); opened = true; const page = controller.runtime().page; page.on('request', (request) => {
          try {
            const requestUrl = new URL(request.url());
            observedHosts.add(requestUrl.hostname);
            if (GUIDED_SELF_STUDY_CRITICAL_API_PATHS.includes(requestUrl.pathname as CriticalApiPath)) {
              const endpoint = requestUrl.pathname as CriticalApiPath;
              appCheckEvidence[endpoint].requests += 1;
              if (hasFirebaseAppCheckHeader(request.headers())) appCheckEvidence[endpoint].withHeader += 1;
            }
          } catch { /* ignored */ }
        });
        await page.setViewportSize(GUIDED_SELF_STUDY_VIEWPORTS[viewport]);
        await controller.navigate(new URL(options.profile.target.authenticatedPath, options.baseUrl).href);
        await page.locator(options.scenario.selectors.authenticatedShell).waitFor({ state: 'visible' });
        await page.locator(options.scenario.selectors.accountTrigger).click();
        const rawIdentity = (await page.locator(options.scenario.selectors.accountIdentity).textContent()) ?? '';
        if (hashAccountIdentity(normalizeAccountEmail(rawIdentity)) !== options.verifiedIdentityHash) throw new Error('Authenticated account identity hash mismatch.');
        checks.push({ viewport, check: 'identity:verified', passed: true, details: 'matched-private-verification' });

        const url = new URL(options.scenario.target.path, options.baseUrl); url.searchParams.set('lessonId', options.scenario.package.lessonId); url.searchParams.set('mode', options.scenario.package.learningMode);
        if (options.scenario.entry) {
          const entry = options.scenario.entry;
          await page.locator(entry.grade).selectOption(entry.expectedGrade);
          await page.locator(entry.subject).selectOption(entry.expectedSubject);
          await page.locator(entry.chapter).locator(`option[value="${entry.expectedChapter}"]`).waitFor({ state: 'attached' });
          await page.locator(entry.chapter).selectOption(entry.expectedChapter);
          await page.locator(entry.lesson).locator(`option[value="${options.scenario.package.lessonId}"]`).waitFor({ state: 'attached' });
          await page.locator(entry.lesson).selectOption(options.scenario.package.lessonId);
          const mode = page.locator(entry.mode).first();
          await mode.waitFor({ state: 'visible' });
          if (await mode.getAttribute('data-lesson-id') !== options.scenario.package.lessonId) throw new Error('App Home entry lesson continuity mismatch.');
          await Promise.all([page.waitForURL((candidate) => candidate.pathname === options.scenario.target.path, { timeout: options.scenario.limits.transitionTimeoutMs }), mode.click()]);
          const routed = new URL(page.url());
          if (routed.searchParams.get('lessonId') !== options.scenario.package.lessonId || routed.searchParams.get('mode') !== options.scenario.package.learningMode) throw new Error('App Home self-study route continuity mismatch.');
          checks.push({ viewport, check: 'entry:app-home-to-self-study', passed: true, details: options.scenario.package.lessonId });
        } else await controller.navigate(url.href);
        let player = await waitState(page, options.scenario.selectors.player, 'READY', options.scenario.limits.transitionTimeoutMs);
        for (const [attribute, expected] of [['data-lesson-id', options.scenario.package.lessonId], ['data-package-id', options.scenario.package.packageId], ['data-package-fingerprint', options.scenario.package.fingerprint]] as const) if (await player.getAttribute(attribute) !== expected) throw new Error(`Pinned package contract mismatch: ${attribute}.`);
        checks.push({ viewport, check: 'package:pinned-release', passed: true, details: options.scenario.package.packageId });
        await page.screenshot({ path: path.join(viewportDirectory, 'ready.png'), fullPage: true });
        await page.locator(options.scenario.selectors.start).click(); await waitState(page, options.scenario.selectors.player, 'DIAGNOSTIC', options.scenario.limits.transitionTimeoutMs);

        const diagnostic = options.scenario.answers[0]; if (!diagnostic?.incorrectValue) throw new Error('Diagnostic remediation fixture is missing.');
        await submitAnswer(page, options.scenario, diagnostic.exerciseId, diagnostic.incorrectValue, 'incorrect');
        checks.push({ viewport, check: 'verifier:incorrect-distinct', passed: true, details: diagnostic.exerciseId });
        await page.locator(options.scenario.selectors.hintRequest).click(); await page.locator(options.scenario.selectors.hint).waitFor({ state: 'visible' });
        checks.push({ viewport, check: 'hint:bounded-visible', passed: true, details: 'level-1' });
        await page.reload({ waitUntil: 'load' }); player = await waitState(page, options.scenario.selectors.player, 'DIAGNOSTIC', options.scenario.limits.transitionTimeoutMs);
        if (await player.getAttribute('data-exercise-id') !== diagnostic.exerciseId) throw new Error('Exact resume lost the diagnostic exercise.');
        await page.locator(options.scenario.selectors.hint).waitFor({ state: 'visible' }); checks.push({ viewport, check: 'resume:exact-state-and-hint', passed: true, details: diagnostic.exerciseId });
        await submitAnswer(page, options.scenario, diagnostic.exerciseId, diagnostic.value, 'correct'); await page.locator(options.scenario.selectors.next).click();
        await waitState(page, options.scenario.selectors.player, 'LEARN', options.scenario.limits.transitionTimeoutMs); await page.locator(options.scenario.selectors.learnContinue).click();
        await waitState(page, options.scenario.selectors.player, 'GUIDED_PRACTICE', options.scenario.limits.transitionTimeoutMs);
        const guidedRemediation = options.scenario.answers[1];
        if (!guidedRemediation?.incorrectValue) throw new Error('Guided-practice remediation fixture is missing.');
        await submitAnswer(page, options.scenario, guidedRemediation.exerciseId, guidedRemediation.incorrectValue, 'incorrect');
        await submitAnswer(page, options.scenario, guidedRemediation.exerciseId, guidedRemediation.incorrectValue, 'incorrect');
        await page.locator(options.scenario.selectors.remediationEnter).click(); await waitState(page, options.scenario.selectors.player, 'REMEDIATE', options.scenario.limits.transitionTimeoutMs);
        checks.push({ viewport, check: 'remediation:entered', passed: true, details: 'guided-practice-after-two-incorrect-attempts' });
        await page.locator(options.scenario.selectors.remediationReturn).click(); await waitState(page, options.scenario.selectors.player, 'GUIDED_PRACTICE', options.scenario.limits.transitionTimeoutMs);
        for (const item of options.scenario.answers.slice(1)) { await submitAnswer(page, options.scenario, item.exerciseId, item.value, 'correct'); checks.push({ viewport, check: `verifier:correct:${item.exerciseId}`, passed: true, details: 'server-verified' }); await page.locator(options.scenario.selectors.next).click(); }
        await waitState(page, options.scenario.selectors.player, 'VERIFY', options.scenario.limits.transitionTimeoutMs); checks.push({ viewport, check: 'state:verify-before-complete', passed: true, details: 'reached' });
        await page.locator(options.scenario.selectors.verifyComplete).click(); await waitState(page, options.scenario.selectors.player, 'COMPLETE', options.scenario.limits.transitionTimeoutMs); await page.locator(options.scenario.selectors.summary).waitFor({ state: 'visible' });
        checks.push({ viewport, check: 'summary:complete', passed: true, details: 'memory-card-visible' });
        if (observedHosts.has('generativelanguage.googleapis.com')) throw new Error('Self-study attempted a policy-denied Gemini request.');
        checks.push({ viewport, check: 'network:gemini-denied-and-absent', passed: true, details: 'request-interception-denylist' });
        if (policy.fixtureMode === true) checks.push({ viewport, check: 'app-check:exchange-observed', passed: true, details: 'fixture-excluded' });
        else {
          const failures = appCheckCoverageFailures(appCheckEvidence);
          if (failures.length > 0) throw new Error(`Firebase App Check missing from critical request coverage: ${failures.join(', ')}.`);
          for (const endpoint of GUIDED_SELF_STUDY_CRITICAL_API_PATHS) {
            const evidence = appCheckEvidence[endpoint];
            checks.push({ viewport, check: `app-check:all-requests:${endpoint.slice('/api/'.length)}`, passed: true, details: `${evidence.withHeader}/${evidence.requests}` });
          }
          checks.push({ viewport, check: 'deployment:asset-fingerprint', passed: true, details: await productAssetFingerprint(page, options.baseUrl) });
        }
        const geometry = await layout(page); checks.push({ viewport, check: 'layout:no-horizontal-overflow', passed: geometry.horizontalOverflow === 0, details: String(geometry.horizontalOverflow) }); checks.push({ viewport, check: 'layout:no-blocking-overlay', passed: geometry.blockingOverlay === 0, details: String(geometry.blockingOverlay) });
        if (geometry.horizontalOverflow || geometry.blockingOverlay) addIssue({ severity: 'MEDIUM', category: 'layout', viewport, title: 'Player layout heuristic found a risk', expected: 'No horizontal overflow or blocking overlay', actual: JSON.stringify(geometry), evidence: [`${viewport}/complete.png`], limitations: 'Geometry finding requires screenshot review.' });
        await page.screenshot({ path: path.join(viewportDirectory, 'complete.png'), fullPage: true });
      } catch (error) {
        const actual = error instanceof Error ? error.message : String(error); await writeFile(path.join(viewportDirectory, 'failure.json'), `${JSON.stringify({ schemaVersion: 1, reason: redactSecrets(actual) }, null, 2)}\n`, { flag: 'wx' });
        addIssue({ severity: 'HIGH', category: /reset/i.test(actual) ? 'reset' : /identity/i.test(actual) ? 'identity' : /package|fingerprint/i.test(actual) ? 'package' : /verif|Exercise/i.test(actual) ? 'verifier' : /resume/i.test(actual) ? 'resume' : /overflow|overlay/i.test(actual) ? 'layout' : 'transition', viewport, title: 'Guided self-study journey could not complete', expected: 'Reset, exact resume, hint/remediation, six verified answers, verify and summary', actual, evidence: [`${viewport}/failure.json`], limitations: 'No state is forced and no provider or production fallback is used.' });
        if (opened) await controller.runtime().page.screenshot({ path: path.join(viewportDirectory, 'failure.png'), fullPage: true }).catch(() => undefined);
      } finally { if (opened) browserIssues(controller.runtime().events, viewport, addIssue); await controller.close(); }
    }
  }
  const status = blocked ? 'BLOCKED' : issues.some((issue) => ['BLOCKER', 'HIGH'].includes(issue.severity)) ? 'FAILED' : 'PASSED';
  const result = { runId: options.runId, status, checks, issues } as const; await writeReports(runDirectory, result, options.scenario); return { ...result, artifactDirectory: runDirectory };
}

export async function runConfiguredGuidedSelfStudyQa(scenarioId = 'gia-su-ai-guided-self-study-integrals', options: { readonly cwd?: string; readonly env?: NodeJS.ProcessEnv; readonly loadEnvFile?: boolean; readonly runId?: string } = {}): Promise<GuidedSelfStudyQaResult> {
  const cwd = path.resolve(options.cwd ?? process.cwd()); const env = options.env ?? process.env; const runId = options.runId ?? createRunId();
  try {
    const config = await loadConfig({ cwd, env, ...(options.loadEnvFile === undefined ? {} : { loadEnvFile: options.loadEnvFile }) });
    const [profile, scenario] = await Promise.all([loadStagingProfile({ config, cwd, env }), findGuidedSelfStudyScenario(scenarioId, path.join(cwd, 'scenarios', 'authenticated'))]);
    if (!profile.suites.journeyIds.includes(scenario.id)) throw new Error('scenario not linked');
    const verification = await loadAuthVerification(cwd, profile); if (verification.profileId !== profile.id) throw new Error('profile mismatch');
    const resetConfig = await loadStagingResetConfig(cwd, profile); const reset = new StrictStagingResetAdapter({ config, resetConfig, env });
    return runGuidedSelfStudyQa({ cwd, config, profile, scenario, verifiedIdentityHash: verification.identityHash, reset, artifactRoot: path.resolve(cwd, config.artifacts.root), runId, ...(config.staging.baseUrl ? { baseUrl: config.staging.baseUrl } : {}) });
  } catch {
    const artifactRoot = path.resolve(cwd, 'runs'); await mkdir(artifactRoot, { recursive: true }); const artifactDirectory = path.join(artifactRoot, safeRunId(runId)); await mkdir(artifactDirectory, { recursive: false });
    const issue = issueSchema.parse({ id: issueId(scenarioId, 'run', 'prerequisite', 'missing'), severity: 'BLOCKER', category: 'prerequisite', viewport: 'run', title: 'Guided self-study prerequisites are unavailable', expected: 'Typed target, linked scenario, verified auth and strict reset', actual: 'Configuration is missing, malformed, or unsafe; no browser was launched.', evidence: ['run.json'], limitations: 'Fail-closed prerequisite result.' });
    const result = { runId, status: 'BLOCKED' as const, checks: [], issues: [issue] }; await writeReports(artifactDirectory, result, { id: scenarioId, name: 'Guided self-study QA' }); return { ...result, artifactDirectory };
  }
}
