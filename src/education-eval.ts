import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';

export const EVALUATION_INPUT_VERSION = 1 as const;
export const EVALUATION_RESULT_VERSION = 1 as const;
export const EDUCATION_RUBRIC_VERSION = 1 as const;
export type EvaluationStatus = 'PASS' | 'PASS_WITH_RISKS' | 'FAIL' | 'BLOCKED' | 'NEEDS_REVIEW';
export type Measurement = 'observed' | 'estimated' | 'unknown';

const evidenceSchema = z.object({ ref: z.string().min(1), description: z.string().min(1), timestampMs: z.number().nonnegative().optional() }).strict();
const turnSchema = z.object({ role: z.enum(['student', 'tutor']), turn: z.number().int().positive(), timestampMs: z.number().nonnegative(), text: z.string(), latencyMs: z.number().nonnegative().optional(), durationMs: z.number().nonnegative().optional() }).strict();
const whiteboardSchema = z.object({ turn: z.number().int().positive(), timestampMs: z.number().nonnegative(), state: z.string(), measurement: z.enum(['observed', 'estimated']) }).strict();
const blockerSchema = z.object({ code: z.string().min(1), message: z.string().min(1), evidence: z.array(evidenceSchema).min(1) }).strict();
const versionValue = z.string().min(1).nullable().optional();

export const evaluationInputSchema = z.object({
  schemaVersion: z.literal(EVALUATION_INPUT_VERSION),
  runner: z.enum(['student', 'web']),
  runId: z.string().min(1),
  required: z.object({ flows: z.number().int().nonnegative(), pages: z.number().int().nonnegative(), lessons: z.number().int().nonnegative(), minimumTurns: z.number().int().nonnegative(), transcript: z.boolean() }).strict(),
  observed: z.object({ flows: z.number().int().nonnegative(), pages: z.number().int().nonnegative(), lessons: z.number().int().nonnegative(), transcriptAvailable: z.boolean(), crashed: z.boolean(), sessionStuck: z.boolean(), integrationAvailable: z.boolean() }).strict(),
  turns: z.array(turnSchema),
  whiteboardEvents: z.array(whiteboardSchema),
  deterministicBlockers: z.array(blockerSchema).default([]),
  limitations: z.array(z.string().min(1)),
  metadata: z.object({ modelVersion: versionValue, endpointVersion: versionValue, systemPromptHash: versionValue, teachingPolicyVersion: versionValue, rubricVersion: versionValue, curriculumVersion: versionValue, exerciseGeneratorVersion: versionValue, verifierVersion: versionValue, whiteboardChoreographyVersion: versionValue, buildId: versionValue }).strict(),
}).strict();
export type EvaluationInput = z.infer<typeof evaluationInputSchema>;

export const rubricCriterionSchema = z.object({ id: z.enum(['misconception_detection', 'no_early_answer_reveal', 'progressive_hints', 'adaptation', 'whiteboard_alignment', 'independent_answer']), weight: z.number().positive(), grader: z.enum(['rule', 'ai', 'hybrid']), description: z.string().min(1) }).strict();
export const educationRubricSchema = z.object({ schemaVersion: z.literal(EDUCATION_RUBRIC_VERSION), id: z.string().regex(/^[a-z0-9.-]+$/), skill: z.string().min(1), title: z.string().min(1), criteria: z.array(rubricCriterionSchema).length(6).refine((items) => new Set(items.map((x) => x.id)).size === 6, 'criteria must be unique').refine((items) => Math.abs(items.reduce((sum, x) => sum + x.weight, 0) - 100) < 0.0001, 'rubric weights must total 100'), humanCalibration: z.object({ required: z.boolean(), marker: z.string().min(1) }).strict() }).strict();
export type EducationRubric = z.infer<typeof educationRubricSchema>;
export async function loadEducationRubric(filePath: string): Promise<EducationRubric> { return educationRubricSchema.parse(parseYaml(await readFile(filePath, 'utf8')) as unknown); }

export interface UxCriterionJudgment { readonly criterionId: string; readonly score: number; readonly confidence: number; readonly evidence: readonly z.infer<typeof evidenceSchema>[]; readonly limitations: readonly string[] }
export interface UxEvaluation { readonly evaluator: string; readonly version: string; readonly promptVersion?: string; readonly promptHash?: string; readonly judgments: readonly UxCriterionJudgment[]; readonly overallConfidence: number; readonly limitations: readonly string[] }
export interface UxEvaluator { readonly name: string; readonly version: string; evaluate(input: EvaluationInput, rubric: EducationRubric): Promise<UxEvaluation> }
export class ScriptedUxEvaluator implements UxEvaluator {
  public readonly name = 'scripted-ux-evaluator'; public readonly version = '1';
  public constructor(private readonly scripted: Omit<UxEvaluation, 'evaluator' | 'version'> = { judgments: [], overallConfidence: 0, limitations: ['Scripted mock only; no real AI provider or nuanced UX judgment.'] }) {}
  public evaluate(input: EvaluationInput, rubric: EducationRubric): Promise<UxEvaluation> { void input; void rubric; return Promise.resolve({ evaluator: this.name, version: this.version, ...this.scripted }); }
}

const percentile = (values: readonly number[], p: number): number | null => { if (!values.length) return null; const sorted = [...values].sort((a,b)=>a-b); return sorted[Math.max(0, Math.ceil(sorted.length * p) - 1)] ?? null; };
const median = (values: readonly number[]): number | null => percentile(values, .5);
const normalize = (text: string): string => text.toLocaleLowerCase('vi-VN').replace(/[^\p{L}\p{N}\s]/gu, '').replace(/\s+/g, ' ').trim();
export function calculateDeterministicMetrics(inputRaw: EvaluationInput) {
  const input=evaluationInputSchema.parse(inputRaw); const latencies=input.turns.filter((x)=>x.role==='tutor').flatMap((x)=>x.latencyMs===undefined?[]:[x.latencyMs]);
  let overlapCount=0,silenceCount=0; const ordered=[...input.turns].sort((a,b)=>a.timestampMs-b.timestampMs); for(let i=1;i<ordered.length;i++){const prev=ordered[i-1]!;const current=ordered[i]!;if(prev.durationMs!==undefined&&current.timestampMs<prev.timestampMs+prev.durationMs)overlapCount++;if(current.timestampMs-(prev.timestampMs+(prev.durationMs??0))>3000)silenceCount++;}
  const tutorPhrases=input.turns.filter((x)=>x.role==='tutor').map((x)=>normalize(x.text)).filter(Boolean); const frequencies=new Map<string,number>();for(const phrase of tutorPhrases)frequencies.set(phrase,(frequencies.get(phrase)??0)+1);const repeatedTutorPhraseCount=[...frequencies.values()].reduce((sum,count)=>sum+Math.max(0,count-1),0);
  const longTurnCount=input.turns.filter((x)=>(x.durationMs??0)>30_000||x.text.length>500).length; const boardDelays=input.whiteboardEvents.flatMap((event)=>{const tutor=input.turns.filter((x)=>x.role==='tutor'&&x.turn===event.turn).at(-1);return tutor?[{value:Math.max(0,event.timestampMs-tutor.timestampMs),measurement:event.measurement}]:[];});
  const blockerCount=input.deterministicBlockers.length+Number(input.observed.crashed)+Number(input.observed.sessionStuck)+Number(input.observed.flows<input.required.flows)+Number(input.observed.pages<input.required.pages)+Number(input.observed.lessons<input.required.lessons)+Number(input.turns.filter((x)=>x.role==='student').length<input.required.minimumTurns)+Number(input.required.transcript&&!input.observed.transcriptAvailable);
  return { responseLatencyMs:{p50:percentile(latencies,.5),p95:percentile(latencies,.95),median:median(latencies),measurement:latencies.length?'observed' as const:'unknown' as const},overlapCount,silenceCount,repeatedTutorPhraseCount,longTurnCount,whiteboardDelayMs:{median:median(boardDelays.map((x)=>x.value)),measurement:boardDelays.length?(boardDelays.every((x)=>x.measurement==='observed')?'observed' as const:'estimated' as const):'unknown' as const},blockerCount };
}

export const evaluationResultSchema=z.object({schemaVersion:z.literal(EVALUATION_RESULT_VERSION),status:z.enum(['PASS','PASS_WITH_RISKS','FAIL','BLOCKED','NEEDS_REVIEW']),score:z.number().min(0).max(100).nullable(),scoreAuthority:z.literal('NON_AUTHORITATIVE'),confidence:z.number().min(0).max(1),evidence:z.array(evidenceSchema),limitations:z.array(z.string()),metrics:z.object({responseLatencyMs:z.object({p50:z.number().nullable(),p95:z.number().nullable(),median:z.number().nullable(),measurement:z.enum(['observed','unknown'])}),overlapCount:z.number(),silenceCount:z.number(),repeatedTutorPhraseCount:z.number(),longTurnCount:z.number(),whiteboardDelayMs:z.object({median:z.number().nullable(),measurement:z.enum(['observed','estimated','unknown'])}),blockerCount:z.number()}),checks:z.record(z.string(),z.boolean()),rubric:z.object({id:z.string(),version:z.number(),weightedScore:z.number().nullable(),ruleCriteria:z.array(z.string()),aiCriteria:z.array(z.string()),humanCalibrationRequired:z.boolean(),humanCalibrationMarker:z.string()}),evaluator:z.object({name:z.string(),version:z.string(),promptVersion:z.string().nullable(),promptHash:z.string().nullable(),confidence:z.number(),disagreed:z.boolean()}),metadata:evaluationInputSchema.shape.metadata}).strict();
export type EvaluationResult=z.infer<typeof evaluationResultSchema>;

export async function evaluateEducation(inputRaw:EvaluationInput,rubric:EducationRubric,evaluator:UxEvaluator=new ScriptedUxEvaluator()):Promise<EvaluationResult>{
 const input=evaluationInputSchema.parse(inputRaw);const validRubric=educationRubricSchema.parse(rubric);const metrics=calculateDeterministicMetrics(input);const checks={requiredFlows:input.observed.flows>=input.required.flows,requiredPages:input.observed.pages>=input.required.pages,requiredLessons:input.observed.lessons>=input.required.lessons,minimumTurns:input.turns.filter((x)=>x.role==='student').length>=input.required.minimumTurns,transcript:!input.required.transcript||input.observed.transcriptAvailable,noCrash:!input.observed.crashed,sessionNotStuck:!input.observed.sessionStuck};const ux=await evaluator.evaluate(input,validRubric);const ruleCriteria=validRubric.criteria.filter((x)=>x.grader!=='ai').map((x)=>x.id);const aiCriteria=validRubric.criteria.filter((x)=>x.grader!=='rule').map((x)=>x.id);const judgments=new Map(ux.judgments.map((x)=>[x.criterionId,x]));const weighted=validRubric.criteria.every((x)=>judgments.has(x.id))?validRubric.criteria.reduce((sum,x)=>sum+(judgments.get(x.id)!.score*x.weight/100),0):null;const deterministicFail=metrics.blockerCount>0||Object.values(checks).some((x)=>!x);const missingIntegration=!input.observed.integrationAvailable;const aiSaysFail=ux.judgments.some((x)=>x.score<50&&x.confidence>=.7);const deterministicSaysHealthy=!deterministicFail&&metrics.overlapCount===0&&metrics.silenceCount===0;const disagreed=!missingIntegration&&!deterministicFail&&aiSaysFail&&deterministicSaysHealthy;const mildRisk=!deterministicFail&&(metrics.overlapCount>0||metrics.silenceCount>0||metrics.repeatedTutorPhraseCount>0||metrics.longTurnCount>0||(metrics.whiteboardDelayMs.median??0)>1500);const status:EvaluationStatus=deterministicFail?'FAIL':missingIntegration?'BLOCKED':disagreed?'NEEDS_REVIEW':mildRisk?'PASS_WITH_RISKS':'PASS';const evidence=[...input.deterministicBlockers.flatMap((x)=>x.evidence),...ux.judgments.flatMap((x)=>x.evidence)];const limitations=[...input.limitations,...ux.limitations,'Score is explicitly non-authoritative and cannot override deterministic blockers.',...(weighted===null?['Rubric score is unavailable because not all criteria were graded.']:[])];return evaluationResultSchema.parse({schemaVersion:1,status,score:weighted,scoreAuthority:'NON_AUTHORITATIVE',confidence:deterministicFail?1:Math.min(1,Math.max(0,ux.overallConfidence)),evidence,limitations,metrics,checks,rubric:{id:validRubric.id,version:validRubric.schemaVersion,weightedScore:weighted,ruleCriteria,aiCriteria,humanCalibrationRequired:validRubric.humanCalibration.required,humanCalibrationMarker:validRubric.humanCalibration.marker},evaluator:{name:ux.evaluator,version:ux.version,promptVersion:ux.promptVersion??null,promptHash:ux.promptHash??null,confidence:ux.overallConfidence,disagreed},metadata:input.metadata});}
export function hashPrompt(prompt:string):string{return createHash('sha256').update(prompt).digest('hex');}
