import { spawn } from 'node:child_process';
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';

export const DEFAULT_EDGE_TTS_VOICE = 'vi-VN-HoaiMyNeural';

export type EdgeTtsResult = {
  readonly bytes: Uint8Array;
  readonly mediaType: 'audio/mpeg';
  readonly voice: string;
  readonly attempts: number;
  readonly latencyMs: number;
};

export type EdgeTtsOptions = {
  readonly command?: string;
  readonly commandArgs?: readonly string[];
  readonly voice?: string;
  readonly retries?: number;
  readonly timeoutMs?: number;
  readonly temporaryDirectory?: string;
  readonly cacheDirectory?: string;
};

type CommandResult = { readonly code: number | null; readonly stderr: string };

function run(command: string, args: readonly string[], timeoutMs: number): Promise<CommandResult> {
  return new Promise((resolve) => {
    const child = spawn(command, [...args], { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });
    let stderr = '';
    let settled = false;
    const finish = (result: CommandResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    const timer = setTimeout(() => {
      child.kill();
      finish({ code: null, stderr: 'Edge TTS timed out.' });
    }, timeoutMs);
    child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });
    child.on('error', (error) => finish({ code: null, stderr: error.message }));
    child.on('close', (code) => finish({ code, stderr }));
  });
}

function defaultCommand(cwd: string): string {
  return process.platform === 'win32'
    ? path.join(cwd, '.qa-private', 'tts-venv', 'Scripts', 'edge-tts.exe')
    : path.join(cwd, '.qa-private', 'tts-venv', 'bin', 'edge-tts');
}

export class EdgeTtsClient {
  readonly #command: string;
  readonly #voice: string;
  readonly #commandArgs: readonly string[];
  readonly #retries: number;
  readonly #timeoutMs: number;
  readonly #temporaryDirectory: string;
  readonly #cacheDirectory: string | undefined;

  public constructor(options: EdgeTtsOptions = {}, cwd = process.cwd()) {
    this.#command = options.command ?? defaultCommand(cwd);
    this.#commandArgs = options.commandArgs ?? [];
    this.#voice = options.voice ?? DEFAULT_EDGE_TTS_VOICE;
    this.#retries = Math.max(1, Math.min(5, options.retries ?? 3));
    this.#timeoutMs = Math.max(3_000, Math.min(60_000, options.timeoutMs ?? 25_000));
    this.#temporaryDirectory = options.temporaryDirectory ?? path.join(os.tmpdir(), 'qa-lab-edge-tts');
    this.#cacheDirectory = options.cacheDirectory;
  }

  public async synthesize(text: string): Promise<EdgeTtsResult> {
    const bounded = text.trim();
    if (!bounded || bounded.length > 500) throw new Error('Edge TTS text must contain 1-500 characters.');
    await mkdir(this.#temporaryDirectory, { recursive: true });
    const startedAt = Date.now();
    const cacheTarget = this.#cacheDirectory
      ? path.join(this.#cacheDirectory, `${createHash('sha256').update(`${this.#voice}\0${bounded}`).digest('hex')}.mp3`)
      : undefined;
    if (cacheTarget) {
      const cachedSize = (await stat(cacheTarget).catch(() => undefined))?.size ?? 0;
      if (cachedSize >= 1_024) {
        return { bytes: new Uint8Array(await readFile(cacheTarget)), mediaType: 'audio/mpeg', voice: this.#voice, attempts: 0, latencyMs: Date.now() - startedAt };
      }
    }
    let lastReason = 'no audio received';
    for (let attempt = 1; attempt <= this.#retries; attempt += 1) {
      const target = path.join(this.#temporaryDirectory, `${randomUUID()}.mp3`);
      try {
        const result = await run(this.#command, [...this.#commandArgs, '--voice', this.#voice, '--rate=-5%', '--text', bounded, '--write-media', target], this.#timeoutMs);
        const size = (await stat(target).catch(() => undefined))?.size ?? 0;
        if (result.code === 0 && size >= 1_024) {
          const bytes = new Uint8Array(await readFile(target));
          if (cacheTarget) {
            await mkdir(path.dirname(cacheTarget), { recursive: true });
            await writeFile(cacheTarget, bytes, { flag: 'wx' }).catch(() => undefined);
          }
          return { bytes, mediaType: 'audio/mpeg', voice: this.#voice, attempts: attempt, latencyMs: Date.now() - startedAt };
        }
        lastReason = result.code === null ? 'provider process failed' : `provider returned ${result.code}; ${size} bytes`;
      } finally {
        await rm(target, { force: true, maxRetries: 2, retryDelay: 50 }).catch(() => undefined);
      }
      if (attempt < this.#retries) await new Promise((resolve) => setTimeout(resolve, attempt * 250));
    }
    throw new Error(`Edge TTS did not return valid audio after ${this.#retries} attempts (${lastReason}).`);
  }
}
