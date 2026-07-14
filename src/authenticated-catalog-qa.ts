import { createHash } from 'node:crypto';
import { lstat, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Locator, Page } from 'playwright';
import { z } from 'zod';
import {
  findAuthenticatedCatalogScenario,
  type AuthenticatedCatalogScenario,
  type CatalogSelectorContract,
} from './authenticated-catalog-scenario.js';
import { hashAccountIdentity, loadAuthVerification, normalizeAccountEmail } from './auth-bootstrap.js';
import { GuardedBrowserController, type BrowserEvent } from './browser-controller.js';
import type { BrowserTargetPolicy } from './browser-policy.js';
import { loadConfig, type QaConfig } from './config.js';
import { redactSecrets } from './redaction.js';
import { createRunId } from './run-store.js';
import { assertPrivatePath, loadStagingProfile, type StagingProfile } from './staging-profile.js';
import { WEB_VIEWPORTS } from './web-scenario.js';

const catalogIssueSchema = z.object({
  id: z.string(),
  severity: z.enum(['BLOCKER', 'HIGH', 'MEDIUM', 'LOW']),
  category: z.enum(['prerequisite', 'selector', 'identity', 'registry', 'navigation', 'console', 'network', 'layout', 'fallback']),
  viewport: z.string(),
  title: z.string(),
  expected: z.string(),
  actual: z.string(),
  evidence: z.array(z.string()).min(1),
  limitations: z.string(),
}).strict();
export type CatalogIssue = z.infer<typeof catalogIssueSchema>;

export interface CatalogCheck {
  readonly viewport: string;
  readonly check: string;
  readonly passed: boolean;
  readonly details: string;
}

export interface AuthenticatedCatalogQaResult {
  readonly runId: string;
  readonly status: 'PASSED' | 'FAILED' | 'BLOCKED';
  readonly artifactDirectory: string;
  readonly selectedLessonIds: readonly string[];
  readonly issues: readonly CatalogIssue[];
  readonly checks: readonly CatalogCheck[];
}

export interface AuthenticatedCatalogQaOptions {
  readonly cwd?: string;
  readonly config: QaConfig;
  readonly profile: StagingProfile;
  readonly scenario: AuthenticatedCatalogScenario;
  readonly verifiedIdentityHash: string;
  readonly artifactRoot: string;
  readonly runId: string;
  readonly baseUrl?: string;
  readonly policy?: BrowserTargetPolicy;
}

interface ResolvedSelector {
  readonly locator: Locator;
  readonly mode: 'primary' | 'fallback';
}

function issueId(scenarioId: string, viewport: string, category: string, actual: string): string {
  return `CAT-${createHash('sha256').update(`${scenarioId}|${viewport}|${category}|${actual}`).digest('hex').slice(0, 12).toUpperCase()}`;
}

function safeRunId(value: string): string {
  if (!/^[A-Za-z0-9._-]+$/.test(value) || value === '.' || value === '..') throw new Error('Unsafe run id.');
  return value;
}

function escapeHtml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}

async function resolveSelector(page: Page, contract: CatalogSelectorContract): Promise<ResolvedSelector> {
  const primary = page.locator(contract.primary).first();
  try {
    await primary.waitFor({ state: 'visible' });
    return { locator: primary, mode: 'primary' };
  } catch {
    if (!contract.fallback) throw new Error(`${contract.name} primary data-qa selector was not visible.`);
    const fallback = page.locator(contract.fallback).first();
    await fallback.waitFor({ state: 'visible' });
    return { locator: fallback, mode: 'fallback' };
  }
}

function addBrowserEventIssues(
  events: readonly BrowserEvent[],
  viewport: string,
  addIssue: (issue: Omit<CatalogIssue, 'id'>) => void,
): void {
  for (const event of events) {
    const actual = JSON.stringify(redactSecrets(event.data));
    if (event.event === 'console' && /"type":"(error|assert)"/.test(actual)) {
      addIssue({ severity: 'HIGH', category: 'console', viewport, title: 'Console blocker captured', expected: 'No console errors', actual, evidence: [`${viewport}/browser-events.jsonl`], limitations: 'Console impact may require product triage.' });
    }
    if ((event.event === 'request-failed' && !/net::ERR_ABORTED/.test(actual)) || event.event === 'page-error' || event.event === 'request-denied') {
      addIssue({ severity: 'HIGH', category: 'network', viewport, title: 'Runtime or network blocker captured', expected: 'No failed or denied runtime request', actual: `${event.event}: ${actual}`, evidence: [`${viewport}/browser-events.jsonl`], limitations: 'Navigation net::ERR_ABORTED is ignored; other failures are conservative blockers.' });
    }
  }
}

async function layoutFindings(page: Page): Promise<{ overflow: number; overlap: number }> {
  return page.evaluate(() => {
    const visible = [...document.querySelectorAll<HTMLElement>('body *')].filter((element) => {
      const style = getComputedStyle(element);
      return style.display !== 'none' && style.visibility !== 'hidden';
    });
    const overflow = visible.filter((element) => {
      const style = getComputedStyle(element);
      return (element.scrollWidth > element.clientWidth + 2 || element.scrollHeight > element.clientHeight + 2)
        && ['hidden', 'clip'].includes(style.overflow);
    }).length;
    const overlap = visible.filter((element) => {
      const style = getComputedStyle(element);
      if (!['fixed', 'sticky'].includes(style.position)) return false;
      const rect = element.getBoundingClientRect();
      return rect.width * rect.height > innerWidth * innerHeight * 0.5;
    }).length;
    return { overflow, overlap };
  });
}

async function writeReports(
  directory: string,
  result: Omit<AuthenticatedCatalogQaResult, 'artifactDirectory'>,
  scenario: Pick<AuthenticatedCatalogScenario, 'id' | 'name'>,
): Promise<void> {
  const summary = {
    schemaVersion: 1,
    status: result.status,
    checks: { total: result.checks.length, passed: result.checks.filter((check) => check.passed).length },
    issues: result.issues.length,
    selectedLessonIds: result.selectedLessonIds,
    limitations: ['Runtime catalog approval is proven only through explicit staging DOM attributes and classroom continuity; backend source is not inspected.'],
  };
  const markdown = `# TutorProof authenticated catalog QA\n\n- Status: **${result.status}**\n- Scenario: \`${scenario.id}\`\n- Checks: ${summary.checks.passed}/${summary.checks.total}\n- Issues: ${result.issues.length}\n- Runtime lesson IDs: ${result.selectedLessonIds.map((id) => `\`${id}\``).join(', ') || 'none'}\n\n## Issues\n${result.issues.map((issue) => `- **${issue.severity}** ${issue.title}: ${issue.actual}`).join('\n') || '- None'}\n`;
  const html = `<!doctype html><meta charset="utf-8"><title>TutorProof catalog report</title><h1>${escapeHtml(scenario.name)}</h1><p>Status: <strong>${escapeHtml(result.status)}</strong></p><p>Checks: ${summary.checks.passed}/${summary.checks.total}</p><ul>${result.issues.map((issue) => `<li><strong>${escapeHtml(issue.severity)}</strong> ${escapeHtml(issue.title)}: ${escapeHtml(issue.actual)}</li>`).join('')}</ul>`;
  await Promise.all([
    writeFile(path.join(directory, 'run.json'), `${JSON.stringify({ schemaVersion: 1, runner: 'authenticated-catalog', runId: result.runId, scenarioId: scenario.id, status: result.status }, null, 2)}\n`, { flag: 'wx' }),
    writeFile(path.join(directory, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`, { flag: 'wx' }),
    writeFile(path.join(directory, 'issues.json'), `${JSON.stringify({ schemaVersion: 1, issues: result.issues }, null, 2)}\n`, { flag: 'wx' }),
    writeFile(path.join(directory, 'checks.json'), `${JSON.stringify({ schemaVersion: 1, checks: result.checks }, null, 2)}\n`, { flag: 'wx' }),
    writeFile(path.join(directory, 'report.md'), markdown, { flag: 'wx' }),
    writeFile(path.join(directory, 'report.html'), html, { flag: 'wx' }),
  ]);
}

export async function runAuthenticatedCatalogQa(
  options: AuthenticatedCatalogQaOptions,
): Promise<AuthenticatedCatalogQaResult> {
  const cwd = path.resolve(options.cwd ?? process.cwd());
  await mkdir(path.resolve(options.artifactRoot), { recursive: true });
  const runDirectory = path.resolve(options.artifactRoot, safeRunId(options.runId));
  await mkdir(runDirectory, { recursive: false });
  const issues: CatalogIssue[] = [];
  const checks: CatalogCheck[] = [];
  const selectedLessonIds: string[] = [];
  const addIssue = (draft: Omit<CatalogIssue, 'id'>): void => {
    if (issues.length >= options.scenario.limits.maxIssues) return;
    const issue = catalogIssueSchema.parse({ ...draft, id: issueId(options.scenario.id, draft.viewport, draft.category, draft.actual) });
    if (!issues.some((candidate) => candidate.id === issue.id)) issues.push(issue);
  };
  let blocked = false;
  let profileDirectory = '';
  if (!options.baseUrl) {
    blocked = true;
    addIssue({ severity: 'BLOCKER', category: 'prerequisite', viewport: 'run', title: 'Typed staging target is missing', expected: 'Approved exact HTTPS staging target', actual: 'No browser was launched.', evidence: ['run.json'], limitations: 'Prerequisite failure only.' });
  } else {
    try {
      profileDirectory = await assertPrivatePath(cwd, options.profile.privatePaths.browserProfileDirectory);
      const stats = await lstat(profileDirectory);
      if (!stats.isDirectory() || stats.isSymbolicLink()) throw new Error('unsafe profile');
    } catch {
      blocked = true;
      addIssue({ severity: 'BLOCKER', category: 'prerequisite', viewport: 'run', title: 'Verified persistent browser profile is unavailable', expected: 'Safe persistent test-account profile beneath .qa-private/', actual: 'Profile is missing, malformed, or unsafe.', evidence: ['run.json'], limitations: 'No authenticated browser was launched.' });
    }
  }

  if (!blocked && options.baseUrl) {
    const policy: BrowserTargetPolicy = options.policy ?? { allowedHosts: [...new Set([...options.config.staging.allowedHosts, ...options.profile.auth.allowedHosts])] };
    const deadline = Date.now() + options.scenario.limits.maxMinutes * 60_000;
    for (const viewport of options.scenario.viewports) {
      const viewportDirectory = path.join(runDirectory, viewport);
      await mkdir(viewportDirectory);
      const controller = new GuardedBrowserController({
        policy,
        artifactDirectory: viewportDirectory,
        profileDirectory,
        preserveProfile: true,
        timeoutMs: options.scenario.limits.selectorTimeoutMs,
      });
      let opened = false;
      try {
        if (Date.now() > deadline) throw new Error('Catalog run exceeded its bounded deadline.');
        await controller.open();
        opened = true;
        const page = controller.runtime().page;
        await page.setViewportSize(WEB_VIEWPORTS[viewport]);
        await controller.navigate(new URL(options.scenario.target.path, options.baseUrl).href);
        const resolveAndCheck = async (contract: CatalogSelectorContract): Promise<ResolvedSelector> => {
          const resolved = await resolveSelector(page, contract);
          checks.push({ viewport, check: `visible:${contract.name}`, passed: true, details: resolved.mode });
          if (resolved.mode === 'fallback') addIssue({ severity: 'LOW', category: 'fallback', viewport, title: `${contract.name} used semantic fallback`, expected: 'Stable data-qa selector', actual: 'Semantic selector fallback was required.', evidence: ['checks.json'], limitations: 'Fallback can be less stable and must not be treated as selector acceptance.' });
          return resolved;
        };

        await resolveAndCheck(options.scenario.selectors.authenticatedShell);
        const identity = await resolveAndCheck(options.scenario.selectors.accountIdentity);
        let rawIdentity = '';
        if (options.profile.auth.accountIdentitySource === 'value') rawIdentity = await identity.locator.inputValue();
        else if (options.profile.auth.accountIdentitySource === 'data-email') rawIdentity = (await identity.locator.getAttribute('data-email')) ?? '';
        else rawIdentity = (await identity.locator.textContent()) ?? '';
        let observedIdentityHash = '';
        try {
          observedIdentityHash = hashAccountIdentity(normalizeAccountEmail(rawIdentity));
        } catch {
          throw new Error('Account identity selector did not provide a valid email identity.');
        }
        if (observedIdentityHash !== options.verifiedIdentityHash) {
          throw new Error('Authenticated account identity hash did not match the verified profile.');
        }
        checks.push({ viewport, check: 'identity:verified-hash', passed: true, details: options.verifiedIdentityHash });

        for (const contract of [options.scenario.selectors.grade, options.scenario.selectors.subject, options.scenario.selectors.chapter]) {
          const selection = await resolveAndCheck(contract);
          await selection.locator.click();
        }
        const lesson = await resolveAndCheck(options.scenario.selectors.lesson);
        const lessonId = (await lesson.locator.getAttribute(options.scenario.lessonContract.lessonIdAttribute))?.trim() ?? '';
        const registryStatus = await lesson.locator.getAttribute(options.scenario.lessonContract.registryStatusAttribute);
        if (!/^[A-Za-z0-9._-]{2,128}$/.test(lessonId) || registryStatus !== options.scenario.lessonContract.approvedRegistryValue) {
          throw new Error('Selected lesson lacks an approved runtime registry contract.');
        }
        if (!selectedLessonIds.includes(lessonId)) selectedLessonIds.push(lessonId);
        checks.push({ viewport, check: 'registry:approved-lesson-id', passed: true, details: lessonId });
        await lesson.locator.click();

        const classroom = await resolveAndCheck(options.scenario.selectors.classroomReady);
        const classroomLessonId = (await classroom.locator.getAttribute(options.scenario.lessonContract.lessonIdAttribute))?.trim();
        if (classroomLessonId !== lessonId) throw new Error('Classroom lesson ID does not match the approved catalog lesson ID.');
        checks.push({ viewport, check: 'classroom:lesson-id-continuity', passed: true, details: lessonId });
        const start = await resolveAndCheck(options.scenario.selectors.startLesson);
        if (!(await start.locator.isEnabled())) throw new Error('Start lesson CTA is disabled.');
        checks.push({ viewport, check: 'clickable:start-lesson', passed: true, details: start.mode });

        const layout = await layoutFindings(page);
        checks.push({ viewport, check: 'layout:text-overflow', passed: layout.overflow === 0, details: String(layout.overflow) });
        checks.push({ viewport, check: 'layout:blocking-overlap', passed: layout.overlap === 0, details: String(layout.overlap) });
        if (layout.overflow > 0 || layout.overlap > 0) addIssue({ severity: 'MEDIUM', category: 'layout', viewport, title: 'Catalog layout heuristic found a risk', expected: 'No clipped text or material fixed overlay', actual: JSON.stringify(layout), evidence: [`${viewport}/checkpoint.png`], limitations: 'Geometry heuristics require screenshot review.' });
        await page.screenshot({ path: path.join(viewportDirectory, 'checkpoint.png'), fullPage: true, mask: [page.locator(options.profile.auth.accountIdentitySelector)] });
      } catch (error) {
        const actual = error instanceof Error ? error.message : String(error);
        await writeFile(path.join(viewportDirectory, 'failure.json'), `${JSON.stringify({ schemaVersion: 1, status: 'FAILED', reason: redactSecrets(actual) }, null, 2)}\n`, { flag: 'wx' });
        addIssue({ severity: 'HIGH', category: /identity/i.test(actual) ? 'identity' : /registry|lesson ID/i.test(actual) ? 'registry' : 'selector', viewport, title: 'Authenticated catalog flow could not complete', expected: 'Authenticated shell, verified account, catalog hierarchy, approved lesson, classroom and start CTA', actual, evidence: [`${viewport}/failure.json`], limitations: 'Missing product selectors or registry observability are reported; the product is not modified to force a pass.' });
        if (opened) {
          const page = controller.runtime().page;
          await page.screenshot({ path: path.join(viewportDirectory, 'failure.png'), fullPage: true, mask: [page.locator(options.profile.auth.accountIdentitySelector)] }).catch(() => undefined);
        }
      } finally {
        if (opened) addBrowserEventIssues(controller.runtime().events, viewport, addIssue);
        await controller.close();
      }
    }
  }

  const status = blocked ? 'BLOCKED' : issues.some((issue) => ['BLOCKER', 'HIGH'].includes(issue.severity)) ? 'FAILED' : 'PASSED';
  const result = { runId: options.runId, status, selectedLessonIds, issues, checks } as const;
  await writeReports(runDirectory, result, options.scenario);
  return { ...result, artifactDirectory: runDirectory };
}

export async function runConfiguredAuthenticatedCatalogQa(
  scenarioId = 'gia-su-ai-authenticated-catalog',
  options: { readonly cwd?: string; readonly env?: NodeJS.ProcessEnv; readonly loadEnvFile?: boolean; readonly runId?: string } = {},
): Promise<AuthenticatedCatalogQaResult> {
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const env = options.env ?? process.env;
  const runId = options.runId ?? createRunId();
  let config: QaConfig;
  try {
    config = await loadConfig({ cwd, env, ...(options.loadEnvFile === undefined ? {} : { loadEnvFile: options.loadEnvFile }) });
    const [profile, scenario] = await Promise.all([
      loadStagingProfile({ config, cwd, env }),
      findAuthenticatedCatalogScenario(scenarioId, path.join(cwd, 'scenarios', 'authenticated')),
    ]);
    if (!profile.suites.authenticatedWebScenarioIds.includes(scenario.id)) throw new Error('scenario not linked');
    const verification = await loadAuthVerification(cwd, profile);
    if (verification.profileId !== profile.id) throw new Error('profile mismatch');
    return runAuthenticatedCatalogQa({
      cwd,
      config,
      profile,
      scenario,
      verifiedIdentityHash: verification.identityHash,
      artifactRoot: path.resolve(cwd, config.artifacts.root),
      runId,
      ...(config.staging.baseUrl ? { baseUrl: config.staging.baseUrl } : {}),
    });
  } catch {
    const artifactRoot = path.resolve(cwd, 'runs');
    await mkdir(artifactRoot, { recursive: true });
    const artifactDirectory = path.join(artifactRoot, safeRunId(runId));
    await mkdir(artifactDirectory, { recursive: false });
    const issue = catalogIssueSchema.parse({ id: issueId(scenarioId, 'run', 'prerequisite', 'missing'), severity: 'BLOCKER', category: 'prerequisite', viewport: 'run', title: 'Authenticated catalog prerequisites are unavailable', expected: 'Typed target, linked scenario, verified auth metadata, and safe persistent profile', actual: 'Configuration is missing, malformed, or unsafe; no browser was launched.', evidence: ['run.json'], limitations: 'Fail-closed prerequisite result.' });
    const result = { runId, status: 'BLOCKED' as const, selectedLessonIds: [], issues: [issue], checks: [] };
    const fallbackScenario = { id: scenarioId, name: 'Authenticated catalog QA' };
    await writeReports(artifactDirectory, result, fallbackScenario);
    return { ...result, artifactDirectory };
  }
}
