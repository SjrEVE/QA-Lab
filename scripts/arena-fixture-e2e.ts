import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { evaluateArena, loadArenaConfig, writeArenaReport, type ArenaObservation } from '../src/model-arena.js';
import { cohortManifest, loadCohortConfig, toStudentPersona } from '../src/synthetic-cohorts.js';
import { ScriptedStudentBrain } from '../src/student-brain.js';

if (!process.argv.includes('--fixture-mode')) throw new Error('Arena fixture requires explicit --fixture-mode.');
const root=path.resolve('runs','phase9-arena-cohort-fixture-evidence');await rm(root,{recursive:true,force:true});await mkdir(root,{recursive:true});
const arena=await loadArenaConfig('config/arena-fixture.yaml');const golden=cohortManifest(await loadCohortConfig('config/cohort-golden.yaml'));const exploratory=cohortManifest(await loadCohortConfig('config/cohort-exploratory.yaml'));
for(const persona of golden.personas) { const brain=new ScriptedStudentBrain(); void brain; toStudentPersona(persona); }
const observations:ArenaObservation[]=arena.configurations.flatMap((configuration,index)=>Array.from({length:arena.repeats},(_,repeat)=>({configurationId:configuration.id,repeat,seed:arena.seed,qualityScore:(index===0?78:88)+repeat,hardBlockers:0,reliability:index===0?.97:.99,latencyMs:{value:index===0?95:110,measurement:'observed'},cost:{value:null,measurement:'unknown'},evidenceVersion:'education-eval-v1'})));
const report=evaluateArena(arena,observations);await writeArenaReport(root,report);await writeFile(path.join(root,'cohort-manifest.json'),`${JSON.stringify({schemaVersion:1,golden,exploratory,studentQaIntegration:{interface:'toStudentPersona + StudentBrain',providerCalls:0}},null,2)}\n`,{flag:'wx'});
process.stdout.write(`${JSON.stringify({status:'PASSED',root,providerCalls:0,arenaEntries:report.entries.length,golden:golden.personaCount,exploratory:exploratory.personaCount},null,2)}\n`);
