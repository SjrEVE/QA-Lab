import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { EdgeTtsClient } from '../src/edge-tts.js';

test('Edge TTS adapter retries an empty artifact and accepts bounded encoded audio', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'qa-edge-tts-'));
  const command = path.join(root, 'fixture.mjs');
  const counter = path.join(root, 'counter.txt');
  await writeFile(command, `import { existsSync, writeFileSync } from 'node:fs';\nconst target = process.argv.at(-1);\nif (!existsSync(${JSON.stringify(counter)})) { writeFileSync(${JSON.stringify(counter)}, '1'); writeFileSync(target, Buffer.alloc(0)); process.exit(1); }\nwriteFileSync(target, Buffer.alloc(2048));\n`);
  const result = await new EdgeTtsClient({ command: process.execPath, commandArgs: [command], retries: 2, temporaryDirectory: root }).synthesize('Con cần một gợi ý.');
  assert.equal(result.attempts, 2);
  assert.equal(result.bytes.byteLength, 2_048);
  assert.equal(result.mediaType, 'audio/mpeg');
  assert.equal(result.voice, 'vi-VN-HoaiMyNeural');
});

test('Edge TTS adapter rejects empty and oversized input before spawning', async () => {
  const client = new EdgeTtsClient({ command: 'missing-edge-tts' });
  await assert.rejects(client.synthesize('  '), /1-500/);
  await assert.rejects(client.synthesize('x'.repeat(501)), /1-500/);
});

test('Edge TTS adapter reuses a private hash-addressed cache without spawning twice', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'qa-edge-tts-cache-'));
  const command = path.join(root, 'fixture.mjs');
  const counter = path.join(root, 'counter.txt');
  await writeFile(command, `import { readFileSync, writeFileSync } from 'node:fs';\nconst target = process.argv.at(-1);\nlet count=0; try { count=Number(readFileSync(${JSON.stringify(counter)}, 'utf8')); } catch {}\nwriteFileSync(${JSON.stringify(counter)}, String(count + 1)); writeFileSync(target, Buffer.alloc(2048));\n`);
  const client = new EdgeTtsClient({ command: process.execPath, commandArgs: [command], retries: 1, temporaryDirectory: root, cacheDirectory: path.join(root, 'cache') });
  const first = await client.synthesize('Con muốn xem lại bước này.');
  const second = await client.synthesize('Con muốn xem lại bước này.');
  assert.equal(first.attempts, 1);
  assert.equal(second.attempts, 0);
  assert.deepEqual(second.bytes, first.bytes);
  assert.equal((await readFile(counter, 'utf8')).trim(), '1');
});
