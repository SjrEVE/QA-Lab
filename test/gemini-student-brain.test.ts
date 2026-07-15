import assert from 'node:assert/strict';
import test from 'node:test';
import { GeminiFetchTransport, GeminiStudentBrain, createConfiguredGeminiStudentBrain, type GeminiBrainTransport } from '../src/gemini-student-brain.js';
import { findStudentPersona, findStudentScenario } from '../src/student-contracts.js';

class StubTransport implements GeminiBrainTransport {
  public readonly name = 'stub';
  public readonly model = 'gemini-test';
  public constructor(private readonly output: unknown) {}
  public generate(): Promise<string> { return Promise.resolve(JSON.stringify(this.output)); }
}

async function context() {
  const persona = await findStudentPersona('weak-fractions-grade-4');
  const scenario = await findStudentScenario('weak-fractions-lesson');
  return { persona, scenario, turn: 1, understanding: 1, currentMisconception: persona.misconception, alreadyUsed: [] as string[], remainingGoals: scenario.goals, recentTurns: [{ role: 'tutor' as const, turn: 1, text: 'Con thử giải thích tử số nhé.' }] };
}

const valid = { intent: 'confused', speech: 'Con vẫn chưa hiểu tử số ạ.', emotion: 'confused', understanding: 1, currentMisconception: 'numerator-denominator', usedBehavior: null, completedGoals: [], reason: null };
const SYNTHETIC_KEY = 'synthetic-test-key-never-real';

test('Gemini StudentBrain emits one bounded Vietnamese speak action', async () => {
  const decision = await new GeminiStudentBrain(new StubTransport(valid)).decide(await context());
  assert.deepEqual(decision.actions, [{ action: 'speak', intent: 'confused', text: valid.speech, locale: 'vi-VN', emotion: 'confused' }]);
});

test('Gemini StudentBrain maps Vietnamese speech to bounded text controls for text QA', async () => {
  const decision = await new GeminiStudentBrain(new StubTransport(valid), 'text').decide(await context());
  assert.deepEqual(decision.actions, [
    { action: 'type', target: 'lesson-text-input', text: valid.speech },
    { action: 'click', target: 'lesson-send' },
  ]);
});

test('Gemini StudentBrain rejects English speech, privilege fields, and unsupported state jumps', async () => {
  await assert.rejects(new GeminiStudentBrain(new StubTransport({ ...valid, speech: 'I do not understand.' })).decide(await context()), /Vietnamese/);
  await assert.rejects(new GeminiStudentBrain(new StubTransport({ ...valid, shell: 'dir' })).decide(await context()));
  await assert.rejects(new GeminiStudentBrain(new StubTransport({ ...valid, understanding: 5 })).decide(await context()), /more than one/);
});

test('Gemini StudentBrain accepts only declared unused behaviors and remaining goals', async () => {
  const input = await context();
  const decision = await new GeminiStudentBrain(new StubTransport({ ...valid, usedBehavior: 'ask_for_example_once', completedGoals: ['independent_check'] })).decide(input);
  assert.equal(decision.usedBehavior, 'ask_for_example_once');
  assert.deepEqual(decision.completedGoals, ['independent_check']);
  await assert.rejects(new GeminiStudentBrain(new StubTransport({ ...valid, usedBehavior: 'run_shell' })).decide(input), /approved schema/);
  await assert.rejects(new GeminiStudentBrain(new StubTransport({ ...valid, completedGoals: ['unknown_goal'] })).decide(input), /approved schema/);
});

test('Gemini StudentBrain rejects already-used behavior and completed goal without remaining evidence', async () => {
  const input = await context();
  await assert.rejects(new GeminiStudentBrain(new StubTransport({ ...valid, usedBehavior: 'silence_once' })).decide({ ...input, alreadyUsed: ['silence_once'] }), /unused persona behavior/);
  await assert.rejects(new GeminiStudentBrain(new StubTransport({ ...valid, completedGoals: ['independent_check'] })).decide({ ...input, remainingGoals: ['misconception_detected'] }), /remaining scenario goals/);
});

test('configured Gemini StudentBrain is opt-in and requires a key without exposing it', () => {
  assert.throws(() => createConfiguredGeminiStudentBrain({}), /disabled/);
  assert.throws(() => createConfiguredGeminiStudentBrain({ QA_ENABLE_REAL_BRAIN: 'true' }), /QA_BRAIN_GEMINI_API_KEY/);
  assert.throws(() => createConfiguredGeminiStudentBrain({ QA_ENABLE_REAL_BRAIN: 'true', QA_BRAIN_GEMINI_API_KEY: 'AIza-valid-looking\u200bhidden-character-value' }), /format is invalid/);
});

test('Gemini fetch transport keeps the key in the header and validates structured provider response', async () => {
  const key = SYNTHETIC_KEY;
  let observedUrl = '';
  let observedHeader = '';
  const fetchImpl = (input: string | URL | Request, init?: RequestInit) => {
    observedUrl = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    observedHeader = new Headers(init?.headers).get('x-goog-api-key') ?? '';
    const body = JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(valid) }] } }] });
    return Promise.resolve(new Response(body, { status: 200, headers: { 'content-type': 'application/json' } }));
  };
  const transport = new GeminiFetchTransport({ apiKey: key, fetchImpl });
  const raw = await transport.generate({ systemInstruction: 'system', prompt: 'prompt', responseJsonSchema: { type: 'object' } });
  assert.equal((JSON.parse(raw) as { intent: string }).intent, 'confused');
  assert.equal(observedHeader, key);
  assert.equal(observedUrl.includes(key), false);
  assert.match(observedUrl, /^https:\/\/generativelanguage\.googleapis\.com\/v1beta\/models\/gemini-2\.5-flash-lite:generateContent$/);
});

test('Gemini fetch transport sanitizes provider failures and rejects oversized output', async () => {
  const failed = new GeminiFetchTransport({ apiKey: SYNTHETIC_KEY, fetchImpl: () => Promise.resolve(new Response('sensitive provider body', { status: 429 })) });
  await assert.rejects(failed.generate({ systemInstruction: 's', prompt: 'p', responseJsonSchema: {} }), (error: unknown) => error instanceof Error && error.message === 'Gemini Brain provider returned HTTP 429.' && !error.message.includes('sensitive'));

  const oversized = new GeminiFetchTransport({ apiKey: SYNTHETIC_KEY, fetchImpl: () => Promise.resolve(new Response('x', { status: 200, headers: { 'content-length': String(65 * 1024) } })) });
  await assert.rejects(oversized.generate({ systemInstruction: 's', prompt: 'p', responseJsonSchema: {} }), /size limit/);
});

test('Gemini fetch transport distinguishes timeout and network failures without exposing raw causes', async () => {
  const timeout = new GeminiFetchTransport({ apiKey: SYNTHETIC_KEY, timeoutMs: 1_000, fetchImpl: () => Promise.reject(new DOMException('raw timeout detail', 'TimeoutError')) });
  await assert.rejects(timeout.generate({ systemInstruction: 's', prompt: 'p', responseJsonSchema: {} }), (error: unknown) => error instanceof Error && error.message === 'Gemini Brain provider timed out after 1000 ms.' && !error.message.includes('raw'));

  const networkError = new TypeError('raw fetch failure', { cause: Object.assign(new Error('raw DNS detail'), { code: 'ENOTFOUND' }) });
  const network = new GeminiFetchTransport({ apiKey: SYNTHETIC_KEY, fetchImpl: () => Promise.reject(networkError) });
  await assert.rejects(network.generate({ systemInstruction: 's', prompt: 'p', responseJsonSchema: {} }), (error: unknown) => error instanceof Error && error.message === 'Gemini Brain network/TLS request failed (ENOTFOUND).' && !error.message.includes('raw'));
});
