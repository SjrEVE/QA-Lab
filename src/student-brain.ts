import { z } from 'zod';
import type { StudentPersona, StudentScenario } from './student-contracts.js';

export const studentActionSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('speak'),
    intent: z.enum(['answer', 'confused', 'ask_hint', 'ask_example', 'confirm_understanding']),
    text: z.string().trim().min(1).max(280),
    locale: z.literal('vi-VN'),
    emotion: z.enum(['neutral', 'hesitant', 'confused', 'encouraged']),
  }).strict(),
  z.object({ action: z.literal('type'), target: z.literal('lesson-text-input'), text: z.string().trim().min(1).max(500) }).strict(),
  z.object({ action: z.literal('click'), target: z.literal('lesson-send') }).strict(),
  z.object({ action: z.literal('wait'), durationMs: z.number().int().min(0).max(5_000) }).strict(),
  z.object({ action: z.literal('report_issue'), category: z.enum(['teaching_clarity', 'pacing', 'whiteboard', 'runtime']), title: z.string().trim().min(1).max(200) }).strict(),
  z.object({ action: z.literal('finish'), reason: z.string().trim().min(1).max(200) }).strict(),
]);
export type StudentAction = z.infer<typeof studentActionSchema>;
export interface BrainTurn { readonly role: 'student' | 'tutor'; readonly turn: number; readonly text: string; }
export interface StudentBrainContext {
  readonly persona: StudentPersona;
  readonly scenario: StudentScenario;
  readonly turn: number;
  readonly understanding: number;
  readonly currentMisconception: string | null;
  readonly alreadyUsed: readonly string[];
  readonly remainingGoals: readonly string[];
  readonly recentTurns: readonly BrainTurn[];
}
export interface StudentBrainDecision { readonly actions: readonly StudentAction[]; readonly understanding: number; readonly currentMisconception: string | null; readonly usedBehavior?: string; readonly completedGoals?: readonly string[]; }
export interface StudentBrain { readonly name: string; readonly version: string; decide(context: StudentBrainContext): Promise<StudentBrainDecision>; }

export function assertBoundedBrainContext(context: StudentBrainContext): void {
  if (context.recentTurns.length < 1 || context.recentTurns.length > context.scenario.limits.max_brain_context_turns) throw new Error('StudentBrain context is outside the configured bounded turn window.');
  if (context.scenario.limits.max_brain_context_turns < 3 || context.scenario.limits.max_brain_context_turns > 5) throw new Error('StudentBrain context limit must remain between 3 and 5 turns.');
}

export function assertStudentBrainDecision(context: StudentBrainContext, decision: StudentBrainDecision): StudentBrainDecision {
  if (!Number.isInteger(decision.understanding) || decision.understanding < 0 || decision.understanding > 5) throw new Error('StudentBrain understanding is outside 0-5.');
  if (Math.abs(decision.understanding - context.understanding) > 1) throw new Error('StudentBrain understanding changed by more than one level in one turn.');
  if (decision.actions.length < 1 || decision.actions.length > 3) throw new Error('StudentBrain must emit between one and three bounded actions.');
  for (const action of decision.actions) studentActionSchema.parse(action);
  const speech = decision.actions.filter((action) => action.action === 'speak');
  if (speech.length > 1) throw new Error('StudentBrain may speak at most once per decision.');
  const completed = decision.completedGoals ?? [];
  if (new Set(completed).size !== completed.length || completed.some((goal) => !context.remainingGoals.includes(goal))) throw new Error('StudentBrain completed goals must be unique remaining scenario goals.');
  if (decision.usedBehavior && (!context.persona.behaviors.includes(decision.usedBehavior as StudentPersona['behaviors'][number]) || context.alreadyUsed.includes(decision.usedBehavior))) throw new Error('StudentBrain usedBehavior is not an unused persona behavior.');
  return decision;
}

export class ScriptedStudentBrain implements StudentBrain {
  public readonly name = 'scripted'; public readonly version = '1.0.0';
  public decide(context: StudentBrainContext): Promise<StudentBrainDecision> {
    assertBoundedBrainContext(context);
    const index = context.turn - 1; const text = context.scenario.scripted_responses[index];
    if (!text) return Promise.resolve({ actions: [{ action: 'finish', reason: 'Script exhausted' }], understanding: context.understanding, currentMisconception: context.currentMisconception });
    const usedBehavior = context.persona.behaviors[index] && !context.alreadyUsed.includes(context.persona.behaviors[index]) ? context.persona.behaviors[index] : undefined;
    const understanding = Math.min(5, context.understanding + (index >= 2 ? 1 : 0));
    const completedGoals: string[] = [];
    if (index === 1) completedGoals.push('misconception_detected');
    if (index === 3) completedGoals.push('explanation_changes');
    if (index === context.scenario.scripted_responses.length - 2) completedGoals.push('independent_check');
    if (index === context.scenario.scripted_responses.length - 1) completedGoals.push('independent_success');
    return Promise.resolve({ actions: [{ action: 'type', target: 'lesson-text-input', text }, { action: 'click', target: 'lesson-send' }], understanding, currentMisconception: index >= 4 ? null : context.currentMisconception, ...(usedBehavior ? { usedBehavior } : {}), completedGoals });
  }
}
