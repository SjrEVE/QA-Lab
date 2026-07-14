import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { probeAudioRouting } from '../src/audio-routing.js';
import { VoiceBridge } from '../src/voice-bridge.js';
import { DeterministicWavVoiceProvider } from '../src/voice-provider.js';

if (!process.argv.includes('--fixture-mode')) throw new Error('Voice fixture requires explicit --fixture-mode.');
const directory = path.resolve('runs/phase6-voice-fixture-evidence'); await rm(directory, { recursive: true, force: true }); await mkdir(directory, { recursive: false });
const native = await probeAudioRouting();
const bridge = new VoiceBridge({ enabled: true, provider: new DeterministicWavVoiceProvider(250), routing: native, allowDeterministicFixture: true, artifactDirectory: directory });
const oneTurn = await bridge.runTurn({ turn: 1, text: 'Con chọn một phần hai.' });
const multiTurn = await bridge.runTurns([{ turn: 2, text: 'Vì hai phần bằng nhau.' }, { turn: 3, text: 'Con hiểu rồi.' }]);
const evidence = { schemaVersion: 1, mode: 'deterministic-fixture', status: oneTurn.mode === 'voice' && multiTurn.every((turn) => turn.mode === 'voice') ? 'PASSED' : 'FAILED', nativeCapability: native, claims: { physicalMicrophone: false, nativeVoiceE2e: native.available, syntheticChromiumMediaEligible: true }, oneTurn, multiTurn };
await writeFile(path.join(directory, 'voice-capability.json'), `${JSON.stringify(evidence, null, 2)}\n`, { flag: 'wx' });
console.log(JSON.stringify({ status: evidence.status, evidence: path.join(directory, 'voice-capability.json'), nativeVoiceE2e: native.available }, null, 2));
if (evidence.status !== 'PASSED') process.exitCode = 1;
