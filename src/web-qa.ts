import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Page } from 'playwright';
import { z } from 'zod';
import { GuardedBrowserController, type BrowserEvent } from './browser-controller.js';
import type { BrowserTargetPolicy } from './browser-policy.js';
import { normalizeTimeline } from './event-timeline.js';
import { redactSecrets } from './redaction.js';
import { PlaywrightFfmpegRecorder, recordingEnabled, type Recorder, type RecordingSummary } from './recorder.js';
import { WEB_VIEWPORTS, type WebScenario } from './web-scenario.js';

const severity = z.enum(['BLOCKER', 'HIGH', 'MEDIUM', 'LOW']);
export const webIssueSchema = z.object({
  schemaVersion: z.literal(1), id: z.string(), runner: z.literal('web'), scenarioId: z.string(), viewport: z.string(),
  category: z.enum(['page_open', 'action', 'console', 'network', 'text_overflow', 'blocking_overlap', 'limit']),
  severity, title: z.string(), url: z.string(), timestampMs: z.number().nonnegative(), expected: z.string(), actual: z.string(),
  evidence: z.array(z.string()).min(1), confidence: z.number().min(0).max(1), limitations: z.string(), status: z.literal('NEW'),
}).strict();
export type WebIssue = z.infer<typeof webIssueSchema>;
export interface WebCheckResult { readonly viewport: string; readonly check: string; readonly passed: boolean; readonly details: string }
export interface WebQaResult { readonly runId: string; readonly status: 'PASSED' | 'FAILED' | 'BLOCKED'; readonly artifactDirectory: string; readonly issues: readonly WebIssue[]; readonly checks: readonly WebCheckResult[] }
export interface WebQaOptions { readonly scenario: WebScenario; readonly baseUrl?: string; readonly artifactRoot: string; readonly policy: BrowserTargetPolicy; readonly runId: string; readonly recorder?: Recorder; readonly enableRecording?: boolean; readonly release?: boolean; readonly deletePassVideo?: boolean }

type GeometryFinding = { category: 'text_overflow' | 'blocking_overlap'; selector: string; details: string; confidence: number; limitations: string };

function issueId(scenario: string, viewport: string, category: string, actual: string): string {
  return `WEB-${createHash('sha256').update(`${scenario}|${viewport}|${category}|${actual}`).digest('hex').slice(0, 12).toUpperCase()}`;
}
function safeRunId(value: string): string { if (!/^[A-Za-z0-9._-]+$/.test(value) || value === '.' || value === '..') throw new Error('Unsafe run id.'); return value; }
function joinUrl(base: string, route: string): string { return new URL(route, base).href; }

export async function runWebQa(options: WebQaOptions): Promise<WebQaResult> {
  const runDirectory = path.resolve(options.artifactRoot, safeRunId(options.runId));
  await mkdir(runDirectory, { recursive: false });
  const started = Date.now();
  const deadline = started + options.scenario.limits.max_minutes * 60_000;
  const issues: WebIssue[] = []; const checks: WebCheckResult[] = []; let steps = 0; let screenshots = 0;
  const recorder=options.recorder??new PlaywrightFfmpegRecorder();
  let recording:RecordingSummary=await recorder.prepare({artifactDirectory:runDirectory,enabled:options.enableRecording??recordingEnabled(),...(options.release===undefined?{}:{release:options.release}),...(options.deletePassVideo===undefined?{}:{deletePassVideo:options.deletePassVideo})});
  const addIssue = (draft: Omit<WebIssue, 'schemaVersion' | 'id' | 'runner' | 'scenarioId' | 'timestampMs' | 'status'>): void => {
    if (issues.length >= options.scenario.limits.max_issues) return;
    issues.push(webIssueSchema.parse({ ...draft, schemaVersion: 1, id: issueId(options.scenario.id, draft.viewport, draft.category, draft.actual), runner: 'web', scenarioId: options.scenario.id, timestampMs: Date.now() - started, status: 'NEW' }));
  };
  let blocked = false;
  if (!options.baseUrl) {
    blocked = true;
    addIssue({ viewport: 'run', category: 'limit', severity: 'BLOCKER', title: 'Real staging prerequisites are missing', url: '', expected: 'Approved staging URL and dedicated account/config', actual: 'No target URL was provided; run did not access staging or production', evidence: ['status.json'], confidence: 1, limitations: 'Configuration gate only; no browser was launched.' });
  } else for (const viewportName of options.scenario.viewports) {
    const viewportDirectory = path.join(runDirectory, viewportName); await mkdir(viewportDirectory);
    const controller = new GuardedBrowserController({ policy: options.policy, artifactDirectory: viewportDirectory, profileDirectory: path.join(runDirectory, `.profile-${viewportName}`), timeoutMs: 10_000, ...(recording.state==='available'?{recordVideoDirectory:runDirectory}:{}) });
    try {
      await controller.open(); const page = controller.runtime().page; await recorder.start(page); await page.setViewportSize(WEB_VIEWPORTS[viewportName]);
      for (const item of options.scenario.flow) {
        if (++steps > options.scenario.limits.max_steps || Date.now() > deadline) throw new Error('Scenario execution limit exceeded.');
        if (item.action === 'open') await controller.navigate(joinUrl(options.baseUrl, item.path));
        else if (item.action === 'click') await page.locator(item.selector).click();
        else if (item.action === 'fill') await page.locator(item.selector).fill(item.value);
        else if (item.action === 'expect_url') { const passed = new URL(page.url()).pathname === item.path; checks.push({ viewport: viewportName, check: `url:${item.path}`, passed, details: page.url() }); if (!passed) addIssue({ viewport: viewportName, category: 'action', severity: 'HIGH', title: 'Navigation did not reach expected route', url: page.url(), expected: item.path, actual: new URL(page.url()).pathname, evidence: [`screenshots/${viewportName}-checkpoint.png`], confidence: 1, limitations: 'Exact pathname comparison only.' }); }
        else { const passed = await page.locator(item.selector).isVisible(); checks.push({ viewport: viewportName, check: `visible:${item.name}`, passed, details: item.selector }); if (!passed) addIssue({ viewport: viewportName, category: 'action', severity: 'HIGH', title: `${item.name} is not visible`, url: page.url(), expected: 'Element visible', actual: 'Element absent or hidden', evidence: [`screenshots/${viewportName}-checkpoint.png`], confidence: 1, limitations: 'Visibility does not establish visual quality.' }); }
      }
      if (screenshots < options.scenario.limits.max_screenshots) { await controller.screenshot(`${viewportName}-checkpoint`); await recorder.checkpoint(`${viewportName}-complete`); screenshots++; }
      for (const action of options.scenario.checks.primary_actions_clickable) {
        const locator = page.locator(action.selector); const passed = await locator.isVisible() && await locator.isEnabled(); checks.push({ viewport: viewportName, check: `clickable:${action.name}`, passed, details: action.selector });
        if (!passed) addIssue({ viewport: viewportName, category: 'action', severity: 'HIGH', title: `${action.name} is not clickable`, url: page.url(), expected: 'Visible and enabled primary action', actual: 'Primary action hidden or disabled', evidence: [`${viewportName}/${viewportName}-checkpoint.png`], confidence: .98, limitations: 'Heuristic does not click the action during this check.' });
      }
      const findings = await detectGeometry(page, options.scenario.checks.text_overflow, options.scenario.checks.blocking_overlap);
      for (const finding of findings) addIssue({ viewport: viewportName, category: finding.category, severity: 'MEDIUM', title: finding.category === 'text_overflow' ? 'Text overflow detected' : 'Blocking overlap detected', url: page.url(), expected: 'Readable content without clipping or obstruction', actual: finding.details, evidence: [`${viewportName}/${viewportName}-checkpoint.png`, `DOM:${finding.selector}`], confidence: finding.confidence, limitations: finding.limitations });
      addEventIssues(controller.runtime().events, viewportName, page.url(), addIssue);
    } catch (error) {
      addIssue({ viewport: viewportName, category: 'page_open', severity: 'BLOCKER', title: 'Web flow could not complete', url: options.baseUrl, expected: 'Flow completes within configured limits', actual: error instanceof Error ? error.message : String(error), evidence: [`${viewportName}/browser-events.jsonl`], confidence: 1, limitations: 'Subsequent checks may not have run.' });
    } finally { await controller.close(); }
  }
  const status = blocked ? 'BLOCKED' : issues.some((issue) => issue.severity === 'BLOCKER' || issue.severity === 'HIGH') ? 'FAILED' : 'PASSED';
  recording=await recorder.stop(status==='PASSED'?'PASS':'FAIL');await recorder.cleanup();
  await writeReports(runDirectory, options, status, issues, checks, started, Date.now(), steps, screenshots, recording);
  return { runId: options.runId, status, artifactDirectory: runDirectory, issues, checks };
}

async function detectGeometry(page: Page, overflow: boolean, overlap: boolean): Promise<GeometryFinding[]> {
  return page.evaluate(({ overflow, overlap }) => {
    const result: GeometryFinding[] = []; const elements = [...document.querySelectorAll<HTMLElement>('body *')].filter((el) => { const s = getComputedStyle(el); return s.display !== 'none' && s.visibility !== 'hidden'; });
    if (overflow) for (const el of elements) if ((el.innerText?.trim().length ?? 0) > 0 && (el.scrollWidth > el.clientWidth + 2 || el.scrollHeight > el.clientHeight + 2) && ['hidden', 'clip'].includes(getComputedStyle(el).overflow)) result.push({ category: 'text_overflow', selector: el.id ? `#${el.id}` : el.tagName.toLowerCase(), details: `scroll ${el.scrollWidth}x${el.scrollHeight} exceeds client ${el.clientWidth}x${el.clientHeight}`, confidence: .88, limitations: 'Geometry heuristic can flag intentional clipping; screenshot and DOM review required.' });
    if (overlap) { const fixed = elements.filter((el) => ['fixed', 'sticky'].includes(getComputedStyle(el).position)); for (const el of fixed) { const r = el.getBoundingClientRect(); const x = Math.max(0, Math.min(innerWidth - 1, r.left + r.width / 2)); const y = Math.max(0, Math.min(innerHeight - 1, r.top + r.height / 2)); const underneath = document.elementsFromPoint(x, y).find((other) => other !== el && !el.contains(other)); if (underneath && r.width * r.height > innerWidth * innerHeight * .12) { const currentSelector = el.id ? `#${el.id}` : el.tagName.toLowerCase(); const underElement = underneath as HTMLElement; const underSelector = underElement.id ? `#${underElement.id}` : underElement.tagName.toLowerCase(); result.push({ category: 'blocking_overlap', selector: currentSelector, details: `${currentSelector} covers ${underSelector} over a material viewport area`, confidence: .72, limitations: 'Fixed/sticky geometry heuristic cannot infer design intent; screenshot review required.' }); } } }
    return result.slice(0, 20);
  }, { overflow, overlap });
}

function addEventIssues(events: readonly BrowserEvent[], viewport: string, url: string, add: (issue: Omit<WebIssue, 'schemaVersion' | 'id' | 'runner' | 'scenarioId' | 'timestampMs' | 'status'>) => void): void {
  for (const event of events) {
    const data = JSON.stringify(redactSecrets(event.data));
    if (event.event === 'console' && /"type":"(error|assert)"/.test(data)) add({ viewport, category: 'console', severity: 'HIGH', title: 'Console blocker captured', url, expected: 'No console errors', actual: data, evidence: [`${viewport}/browser-events.jsonl`], confidence: 1, limitations: 'Browser console event; application impact may require triage.' });
    if (event.event === 'request-failed' || event.event === 'page-error' || event.event === 'request-denied') add({ viewport, category: 'network', severity: 'HIGH', title: 'Runtime/network blocker captured', url, expected: 'No failed or denied runtime requests', actual: `${event.event}: ${data}`, evidence: [`${viewport}/browser-events.jsonl`], confidence: 1, limitations: 'Failure may be non-critical; classified conservatively for MVP.' });
  }
}

async function writeReports(directory: string, options: WebQaOptions, status: string, issues: readonly WebIssue[], checks: readonly WebCheckResult[], started: number, ended: number, steps: number, screenshots: number, recording: RecordingSummary): Promise<void> {
  const passed = checks.filter((check) => check.passed).length; const failed = checks.length - passed;
  const metadata = { schemaVersion: 1, runId: options.runId, runner: 'web', scenarioId: options.scenario.id, scenarioVersion: options.scenario.version, mode: options.policy.fixtureMode ? 'fixture' : 'staging', status, startedAt: new Date(started).toISOString(), endedAt: new Date(ended).toISOString(), durationMs: ended - started, target: options.baseUrl ? new URL(options.baseUrl).origin : null };
  const summary = { schemaVersion: 1, status, recording, flows: { passed: status === 'PASSED' ? options.scenario.viewports.length : 0, total: options.scenario.viewports.length }, checks: { passed, failed, total: checks.length }, issues: { total: issues.length, blocker: issues.filter((x) => x.severity === 'BLOCKER').length, high: issues.filter((x) => x.severity === 'HIGH').length } };
  const metrics = { schemaVersion: 1, durationMs: ended - started, steps, screenshots, viewports: options.scenario.viewports.length, checksPassed: passed, checksFailed: failed, issues: issues.length };
  const report = `# QA Lab Web QA — ${options.scenario.name}\n\n- Status: **${status}**\n- Run: \`${options.runId}\`\n- Mode: \`${metadata.mode}\`\n- Recording: **${recording.state}** (${recording.video??recording.checkpoints})\n- Recording limitations: ${recording.limitations.join('; ')}\n- Viewports: ${options.scenario.viewports.join(', ')}\n- Checks: ${passed} passed / ${failed} failed\n- Issues: ${issues.length}\n\n## Passed checks\n${checks.filter((x) => x.passed).map((x) => `- ${x.viewport}: ${x.check}`).join('\n') || '- None'}\n\n## Issues\n${issues.map((x) => `- **${x.severity}** ${x.title} (${x.viewport}) — confidence ${x.confidence}; ${x.limitations}`).join('\n') || '- None'}\n`;
  const timeline = normalizeTimeline([
    { timestampMs: 0, source: 'checkpoint' as const, event: 'run_started', scenarioId: options.scenario.id, data: { runner: 'web', mode: metadata.mode } },
    ...issues.map((issue) => ({ timestampMs: issue.timestampMs, source: 'evaluation' as const, event: 'issue_observed', scenarioId: options.scenario.id, ...(issue.url ? { route: new URL(issue.url).pathname } : {}), data: { category: issue.category, severity: issue.severity, actual: issue.actual, evidence: issue.evidence } })),
    { timestampMs: ended - started, source: 'checkpoint' as const, event: 'run_completed', scenarioId: options.scenario.id, data: { status, checksPassed: passed, checksFailed: failed } },
  ].sort((a, b) => a.timestampMs - b.timestampMs));
  const timelineJsonl = `${timeline.map((event) => JSON.stringify(event)).join('\n')}\n`;
  await Promise.all([['run.json', metadata], ['status.json', metadata], ['summary.json', summary], ['issues.json', { schemaVersion: 1, issues }], ['metrics.json', metrics]].map(([name, value]) => writeFile(path.join(directory, name as string), `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx' })));
  await Promise.all([writeFile(path.join(directory, 'timeline.jsonl'), timelineJsonl, { flag: 'wx' }), writeFile(path.join(directory, 'report.md'), report, { flag: 'wx' })]);
}
