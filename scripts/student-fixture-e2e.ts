import { rm } from 'node:fs/promises';
import path from 'node:path';
import { ScriptedStudentBrain } from '../src/student-brain.js';
import { findStudentPersona, findStudentScenario } from '../src/student-contracts.js';
import { ManualResetAdapter, runStudentQa } from '../src/student-qa.js';
import { startFixtureSite } from '../test/fixture-site.js';

if (!process.argv.includes('--fixture-mode')) throw new Error('Fixture execution requires explicit --fixture-mode.');
const site=await startFixtureSite();const root=path.resolve('runs');const runId='phase4-student-fixture-evidence';await rm(path.join(root,runId),{recursive:true,force:true});
try { const result=await runStudentQa({scenario:await findStudentScenario('weak-fractions-lesson'),persona:await findStudentPersona('weak-fractions-grade-4'),brain:new ScriptedStudentBrain(),reset:new ManualResetAdapter(true),baseUrl:site.origin,artifactRoot:root,runId,policy:{allowedHosts:['unused.invalid'],fixtureMode:true,fixturePort:site.port}});console.log(JSON.stringify(result,null,2));if(result.status!=='PASSED')process.exitCode=1;} finally {await site.close();}
