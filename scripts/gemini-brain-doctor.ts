import { performance } from 'node:perf_hooks';
import { createConfiguredGeminiStudentBrain } from '../src/gemini-student-brain.js';
import { findStudentPersona, findStudentScenario } from '../src/student-contracts.js';

const [persona, scenario] = await Promise.all([
  findStudentPersona('weak-fractions-grade-4'),
  findStudentScenario('weak-fractions-lesson'),
]);
const brain = createConfiguredGeminiStudentBrain();
const startedAt = performance.now();
const decision = await brain.decide({
  persona,
  scenario,
  turn: 1,
  understanding: persona.starting_understanding,
  currentMisconception: persona.misconception,
  alreadyUsed: [],
  remainingGoals: scenario.goals,
  recentTurns: [{ role: 'tutor', turn: 1, text: 'Con hãy nói ngắn gọn xem tử số và mẫu số có ý nghĩa gì nhé.' }],
});
const speech = decision.actions.find((action) => action.action === 'speak');
process.stdout.write(`${JSON.stringify({
  status: speech ? 'READY' : 'BLOCKED',
  brain: brain.name,
  version: brain.version,
  latencyMs: Math.round(performance.now() - startedAt),
  actionKinds: decision.actions.map((action) => action.action),
  vietnameseSpeech: speech?.action === 'speak' && speech.locale === 'vi-VN',
  secretLogged: false,
  providerOutputPersisted: false,
}, null, 2)}\n`);
if (!speech) process.exitCode = 1;
