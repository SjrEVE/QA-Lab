import assert from 'node:assert/strict';
import { access, mkdir, mkdtemp, readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { hashAccountIdentity } from '../src/auth-bootstrap.js';
import type { QaConfig } from '../src/config.js';
import { appCheckCoverageFailures, hasFirebaseAppCheckHeader, runGuidedSelfStudyQa } from '../src/guided-self-study-qa.js';
import { guidedSelfStudyScenarioSchema } from '../src/guided-self-study-scenario.js';
import { stagingProfileSchema } from '../src/staging-profile.js';

const email = 'qa-student@example.test';
const exerciseIds = ['E01', 'E02', 'E03', 'E04', 'E05', 'E06'];
const values = ['2', '1', '-3', '4', '2', '0'];

function learnPage() {
  return `<!doctype html><meta name="viewport" content="width=device-width"><style>body{font:16px sans-serif;margin:20px}.card{max-width:760px;margin:auto}button,input{font:inherit;padding:10px;margin:4px}</style><main id="root"></main><script>
  const ids=${JSON.stringify(exerciseIds)},answers=${JSON.stringify(values)},key='gss-fixture-state';
  let s=JSON.parse(sessionStorage.getItem(key)||'{"phase":"READY","index":0,"attempts":0,"hint":false,"verification":null,"correct":false}');
  const save=()=>sessionStorage.setItem(key,JSON.stringify(s)); const phaseFor=()=>s.index===0?'DIAGNOSTIC':s.index<4?'GUIDED_PRACTICE':'INDEPENDENT_PRACTICE';
  function render(){save(); const exercise=ids[s.index]||''; let body='';
    if(s.phase==='READY')body='<button data-qa="self-study-start">Start</button>';
    else if(['DIAGNOSTIC','GUIDED_PRACTICE','INDEPENDENT_PRACTICE'].includes(s.phase))body='<label>Answer <input data-qa="self-study-answer"></label><button data-qa="self-study-answer-submit">Check</button>'+(s.verification?'<p data-qa="self-study-verification" data-verification-result="'+s.verification+'">'+s.verification+'</p>':'')+(s.hint?'<aside data-qa="self-study-hint" data-hint-level="1">hint</aside>':'')+(!s.hint?'<button data-qa="self-study-hint-request">Hint</button>':'')+(s.attempts>=2&&!s.correct?'<button data-qa="self-study-remediation-enter">Remediate</button>':'')+(s.correct?'<button data-qa="self-study-next">Next</button>':'');
    else if(s.phase==='LEARN')body='<button data-qa="self-study-learn-continue">Learn continue</button>';
    else if(s.phase==='REMEDIATE')body='<button data-qa="self-study-remediation-return">Return</button>';
    else if(s.phase==='VERIFY')body='<button data-qa="self-study-verify-complete">Complete</button>';
    else body='<dl data-qa="self-study-summary"><dt>Complete</dt><dd>6/6</dd></dl>';
    root.innerHTML='<div class="card"><section data-qa="guided-self-study-player" data-activity-state="'+s.phase+'" data-step-id="fixture" data-exercise-id="'+exercise+'" data-lesson-id="LESSON_1" data-package-id="fixture-package" data-package-fingerprint="${'a'.repeat(64)}">'+body+'</section></div>'; bind(); }
  function bind(){document.querySelector('[data-qa=self-study-start]')?.addEventListener('click',()=>{s.phase='DIAGNOSTIC';render()});
    document.querySelector('[data-qa=self-study-answer-submit]')?.addEventListener('click',()=>{const v=document.querySelector('[data-qa=self-study-answer]').value;s.verification=v===answers[s.index]?'correct':'incorrect';s.correct=s.verification==='correct';if(!s.correct)s.attempts++;render()});
    document.querySelector('[data-qa=self-study-hint-request]')?.addEventListener('click',()=>{s.hint=true;s.verification=null;render()});
    document.querySelector('[data-qa=self-study-remediation-enter]')?.addEventListener('click',()=>{s.phase='REMEDIATE';render()});
    document.querySelector('[data-qa=self-study-remediation-return]')?.addEventListener('click',()=>{s.phase=phaseFor();s.verification=null;render()});
    document.querySelector('[data-qa=self-study-next]')?.addEventListener('click',()=>setTimeout(()=>{s.verification=null;s.correct=false;s.attempts=0;s.hint=false;if(s.index===0){s.phase='LEARN'}else if(s.index===ids.length-1){s.phase='VERIFY'}else{s.index++;s.phase=phaseFor()}render()},25));
    document.querySelector('[data-qa=self-study-learn-continue]')?.addEventListener('click',()=>{s.index=1;s.phase='GUIDED_PRACTICE';render()});
    document.querySelector('[data-qa=self-study-verify-complete]')?.addEventListener('click',()=>{s.phase='COMPLETE';render()});}
  render();</script>`;
}

async function fixtureSite() {
  const server = createServer((request, response) => {
    response.setHeader('content-type', 'text/html; charset=utf-8');
    if (request.url?.startsWith('/app/learn')) { response.end(learnPage()); return; }
    response.end(`<main data-qa="authenticated-shell"><button data-qa="account-trigger">Account</button><span data-qa="account-email">${email}</span></main>`);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('fixture bind failed');
  return { origin: `http://127.0.0.1:${address.port}`, port: address.port, close: () => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())) };
}

function scenario() { return guidedSelfStudyScenarioSchema.parse({
  version: 1, id: 'fixture-guided-self-study', name: '<script>fixture</script>', type: 'authenticated-guided-self-study', target: { path: '/app/learn' }, reset: { scope: 'fixture-reset' },
  package: { lessonId: 'LESSON_1', learningMode: 'textbook', packageId: 'fixture-package', fingerprint: 'a'.repeat(64) }, viewports: ['mobile-common', 'tablet', 'desktop'],
  selectors: { authenticatedShell: '[data-qa="authenticated-shell"]', accountTrigger: '[data-qa="account-trigger"]', accountIdentity: '[data-qa="account-email"]', player: '[data-qa="guided-self-study-player"]', start: '[data-qa="self-study-start"]', answer: '[data-qa="self-study-answer"]', submit: '[data-qa="self-study-answer-submit"]', verification: '[data-qa="self-study-verification"]', hintRequest: '[data-qa="self-study-hint-request"]', hint: '[data-qa="self-study-hint"]', remediationEnter: '[data-qa="self-study-remediation-enter"]', remediationReturn: '[data-qa="self-study-remediation-return"]', next: '[data-qa="self-study-next"]', learnContinue: '[data-qa="self-study-learn-continue"]', verifyComplete: '[data-qa="self-study-verify-complete"]', summary: '[data-qa="self-study-summary"]' },
  answers: exerciseIds.map((exerciseId, index) => ({ exerciseId, value: values[index], ...(index === 0 ? { incorrectValue: '3' } : index === 1 ? { incorrectValue: '99' } : {}) })), limits: { maxMinutes: 2, selectorTimeoutMs: 5_000, transitionTimeoutMs: 5_000, maxIssues: 20 },
}); }

function fixtureContracts(cwd: string) {
  const config: QaConfig = { version: 1, environment: 'staging', staging: { allowedHosts: ['stage.example.test'], baseUrl: 'https://stage.example.test' }, artifacts: { root: 'runs' }, logging: { level: 'info' } };
  const profile = stagingProfileSchema.parse({ version: 1, id: 'gia-su-ai', name: 'Fixture', target: { expectedHost: 'stage.example.test', loginPath: '/login', authenticatedPath: '/app' }, privatePaths: { browserProfileDirectory: '.qa-private/browser/gia-su-ai', authStatePath: '.qa-private/auth/gia-su-ai.json', resetConfigPath: '.qa-private/reset/gia-su-ai.json' }, auth: { authenticatedSelector: '[data-qa="authenticated-shell"]', accountIdentitySelector: '[data-qa="account-email"]', accountIdentitySource: 'textContent', bootstrapTimeoutMs: 30_000 }, suites: { publicWebScenarioIds: [], authenticatedWebScenarioIds: [], journeyIds: ['fixture-guided-self-study'] } });
  return { config, profile, artifactRoot: path.join(cwd, 'runs') };
}

test('guided self-study fixture proves reset, exact resume, remediation, verifier, summary and geometry', async () => {
  const site = await fixtureSite(); const cwd = await mkdtemp(path.join(tmpdir(), 'qa-gss-')); const profileDirectory = path.join(cwd, '.qa-private', 'browser', 'gia-su-ai'); await mkdir(profileDirectory, { recursive: true }); const contracts = fixtureContracts(cwd);
  try {
    const result = await runGuidedSelfStudyQa({ cwd, ...contracts, scenario: scenario(), verifiedIdentityHash: hashAccountIdentity(email), reset: { reset: () => Promise.resolve({ status: 'READY', reason: 'fixture', scope: 'fixture-reset', resetVersion: 'fixture-v1' }) }, runId: 'gss-pass', baseUrl: site.origin, policy: { allowedHosts: ['unused.invalid'], fixtureMode: true, fixturePort: site.port } });
    assert.equal(result.status, 'PASSED'); assert.equal(result.issues.length, 0); assert.equal(result.checks.filter((check) => check.check === 'summary:complete').length, 3);
    await access(path.join(result.artifactDirectory, 'mobile-common', 'complete.png')); await access(path.join(result.artifactDirectory, 'tablet', 'complete.png')); await access(path.join(result.artifactDirectory, 'desktop', 'complete.png'));
    assert.doesNotMatch(await readFile(path.join(result.artifactDirectory, 'report.html'), 'utf8'), /<script>fixture/);
  } finally { await site.close(); }
});

test('guided self-study fails closed before browser launch when strict reset blocks', async () => {
  const site = await fixtureSite(); const cwd = await mkdtemp(path.join(tmpdir(), 'qa-gss-')); await mkdir(path.join(cwd, '.qa-private', 'browser', 'gia-su-ai'), { recursive: true }); const contracts = fixtureContracts(cwd);
  try {
    const result = await runGuidedSelfStudyQa({ cwd, ...contracts, scenario: scenario(), verifiedIdentityHash: hashAccountIdentity(email), reset: { reset: () => Promise.resolve({ status: 'BLOCKED', reason: 'fixture reset refused' }) }, runId: 'gss-blocked', baseUrl: site.origin, policy: { allowedHosts: ['unused.invalid'], fixtureMode: true, fixturePort: site.port } });
    assert.equal(result.status, 'BLOCKED'); assert.equal(result.issues.every((issue) => issue.category === 'reset'), true);
  } finally { await site.close(); }
});

test('App Check evidence records presence without retaining the token value', () => {
  assert.equal(hasFirebaseAppCheckHeader({ 'x-firebase-appcheck': 'opaque-token' }), true);
  assert.equal(hasFirebaseAppCheckHeader({ 'x-firebase-appcheck': '   ' }), false);
  assert.equal(hasFirebaseAppCheckHeader({ authorization: 'Bearer unrelated' }), false);
});

test('App Check coverage requires every request to every critical endpoint', () => {
  assert.deepEqual(appCheckCoverageFailures({
    '/api/startOrResumeGuidedSelfStudy': { requests: 1, withHeader: 1 },
    '/api/advanceGuidedSelfStudy': { requests: 7, withHeader: 7 },
    '/api/submitLessonAnswer': { requests: 9, withHeader: 9 },
  }), []);
  assert.deepEqual(appCheckCoverageFailures({
    '/api/startOrResumeGuidedSelfStudy': { requests: 1, withHeader: 0 },
    '/api/advanceGuidedSelfStudy': { requests: 0, withHeader: 0 },
    '/api/submitLessonAnswer': { requests: 3, withHeader: 2 },
  }), [
    '/api/startOrResumeGuidedSelfStudy:0/1',
    '/api/advanceGuidedSelfStudy:not-observed',
    '/api/submitLessonAnswer:2/3',
  ]);
});
