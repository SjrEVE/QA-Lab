import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('visible Brain session keeps every Vietnamese utterance alive until playback ends', async () => {
  const speech = await readFile('src/browser-speech.ts', 'utf8');
  assert.match(speech, /__qaActiveUtterances/);
  assert.match(speech, /utterance\.onstart/);
  assert.match(speech, /utterance\.onend/);
  assert.match(speech, /synth\.resume\(\)/);
  assert.doesNotMatch(speech, /\.cancel\(\)/);
  assert.match(speech, /startsWith\('vi'\)/);
});

test('visible Live acceptance fails when the product interrupts its own tutor audio', async () => {
  const session = await readFile('scripts/visible-live-session.ts', 'utf8');
  assert.match(session, /provider_output_interruptions/);
  assert.match(session, /stop_output_audio\\s\+\(\?:quick_tutor_message\|gemini_interrupted\)/);
  assert.match(session, /latencyMs\.provider_output_interruptions === 0/);
});
