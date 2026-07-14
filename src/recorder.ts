import { spawn } from 'node:child_process';
import { access, mkdir, readdir, rm, stat, statfs, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Page } from 'playwright';
import { redactSecrets } from './redaction.js';

export type RecordingState = 'available' | 'unavailable' | 'blocked';
export type RecordingOutcome = 'PASS' | 'FAIL' | 'RELEASE' | 'PARTIAL';

export interface RecorderCheckpoint {
  readonly schemaVersion: 1;
  readonly sequence: number;
  readonly timestampMs: number;
  readonly name: string;
  readonly screenshot: string;
}

export interface RecordingSummary {
  readonly schemaVersion: 1;
  readonly enabled: boolean;
  readonly state: RecordingState;
  readonly adapter: string;
  readonly video: string | null;
  readonly checkpoints: string;
  readonly limitations: readonly string[];
  readonly retained: boolean;
}

export interface RecorderPrepareOptions {
  readonly artifactDirectory: string;
  readonly enabled: boolean;
  readonly release?: boolean;
  readonly deletePassVideo?: boolean;
  readonly minimumFreeBytes?: number;
}

export interface Recorder {
  readonly name: string;
  prepare(options: RecorderPrepareOptions): Promise<RecordingSummary>;
  start(page: Page): Promise<void>;
  checkpoint(name: string): Promise<RecorderCheckpoint>;
  stop(outcome: RecordingOutcome): Promise<RecordingSummary>;
  cleanup(outcome?: RecordingOutcome): Promise<void>;
  summary(): RecordingSummary;
}

export interface FfmpegCapability {
  readonly available: boolean;
  readonly command: string;
  readonly version?: string;
  readonly reason?: string;
}

type CommandResult = { readonly code: number | null; readonly stdout: string; readonly stderr: string };

function safeName(value: string): string {
  const safe = value.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);
  return safe || 'checkpoint';
}

function run(command: string, args: readonly string[]): Promise<CommandResult> {
  return new Promise((resolve) => {
    const child = spawn(command, [...args], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString(); });
    child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });
    child.on('error', (error) => resolve({ code: null, stdout, stderr: error.message }));
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

export async function probeFfmpeg(command = process.env.QA_FFMPEG_PATH?.trim() || 'ffmpeg'): Promise<FfmpegCapability> {
  const result = await run(command, ['-version']);
  if (result.code !== 0) return { available: false, command, reason: 'FFmpeg is not available; screenshots remain the recording fallback.' };
  return { available: true, command, version: (result.stdout.split(/\r?\n/)[0] || 'ffmpeg available').trim() };
}

export class PlaywrightFfmpegRecorder implements Recorder {
  public readonly name = 'playwright-ffmpeg';
  private options: RecorderPrepareOptions | undefined;
  private page: Page | undefined;
  private started = 0;
  private sequence = 0;
  private readonly checkpointItems: RecorderCheckpoint[] = [];
  private capability: FfmpegCapability | undefined;
  private stopped = false;
  private current: RecordingSummary = {
    schemaVersion: 1, enabled: false, state: 'unavailable', adapter: this.name, video: null,
    checkpoints: 'recording-checkpoints.jsonl', limitations: ['Recorder has not been prepared.'], retained: false,
  };

  public constructor(private readonly probe: () => Promise<FfmpegCapability> = () => probeFfmpeg()) {}

  public async prepare(options: RecorderPrepareOptions): Promise<RecordingSummary> {
    if (this.options) throw new Error('Recorder has already been prepared.');
    this.options = options;
    this.started = Date.now();
    await mkdir(path.join(options.artifactDirectory, 'screenshots'), { recursive: true });
    this.capability = await this.probe();
    const minimumFreeBytes = options.minimumFreeBytes ?? 100 * 1024 * 1024;
    const disk = await statfs(options.artifactDirectory);
    const freeBytes = disk.bavail * disk.bsize;
    const diskBlocked = options.enabled && freeBytes < minimumFreeBytes;
    const state: RecordingState = !options.enabled ? 'unavailable' : this.capability.available && !diskBlocked ? 'available' : 'blocked';
    const limitations = !options.enabled
      ? ['Recording disabled by safe default; set QA_ENABLE_RECORDING=true to opt in.']
      : diskBlocked
        ? [`Recording blocked: artifact volume has less than ${minimumFreeBytes} free bytes. Screenshot checkpoints remain available.`]
        : this.capability.available
          ? ['Browser video contains no audio; Phase 5 does not capture microphone, voice, or TTS.']
          : ['FFmpeg unavailable; session.mp4 cannot be produced. Screenshot timeline remains available.'];
    this.current = { schemaVersion: 1, enabled: options.enabled, state, adapter: this.name, video: null, checkpoints: 'recording-checkpoints.jsonl', limitations, retained: false };
    return this.current;
  }

  public start(page: Page): Promise<void> {
    if (!this.options) throw new Error('Recorder must be prepared before start.');
    if (this.stopped) throw new Error('Recorder has already stopped.');
    this.page = page;
    return Promise.resolve();
  }

  public async checkpoint(name: string): Promise<RecorderCheckpoint> {
    if (!this.options || !this.page) throw new Error('Recorder must be started before checkpoint.');
    const sequence = ++this.sequence;
    const redactedName = safeName(String(redactSecrets(name)));
    const filename = `recording-${String(sequence).padStart(3, '0')}-${redactedName}.png`;
    const relative = path.posix.join('screenshots', filename);
    await this.page.screenshot({ path: path.join(this.options.artifactDirectory, ...relative.split('/')), fullPage: true });
    const item = { schemaVersion: 1 as const, sequence, timestampMs: Date.now() - this.started, name: redactedName, screenshot: relative };
    this.checkpointItems.push(item);
    return item;
  }

  public async stop(outcome: RecordingOutcome): Promise<RecordingSummary> {
    if (this.stopped) return this.current;
    if (!this.options) throw new Error('Recorder must be prepared before stop.');
    this.stopped = true;
    await this.writeCheckpoints();
    let video: string | null = null;
    const limitations = [...this.current.limitations];
    if (this.current.state === 'available') {
      const source = await findBrowserVideo(this.options.artifactDirectory);
      if (source && this.capability) {
        const target = path.join(this.options.artifactDirectory, 'session.mp4');
        const result = await run(this.capability.command, ['-y', '-i', source, '-an', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', target]);
        if (result.code === 0) {
          video = 'session.mp4';
          await rm(source, { force: true, maxRetries: 3, retryDelay: 100 });
        } else {
          limitations.push(`FFmpeg conversion failed (${result.code ?? 'spawn error'}); session.mp4 was not claimed.`);
        }
      } else {
        limitations.push('Browser context did not provide a video stream; screenshot timeline is authoritative fallback.');
      }
    }
    const deletePass = (this.options.deletePassVideo ?? true) && outcome === 'PASS' && !this.options.release;
    if (deletePass && video) {
      await rm(path.join(this.options.artifactDirectory, video), { force: true });
      video = null;
      limitations.push('PASS retention policy deleted video early; checkpoints retained.');
    }
    this.current = { ...this.current, video, retained: video !== null, limitations };
    return this.current;
  }

  public async cleanup(outcome: RecordingOutcome = 'PARTIAL'): Promise<void> {
    if (!this.stopped && this.options) {
      try { await this.stop(outcome); }
      catch { await this.writeCheckpoints().catch(() => undefined); }
    }
    this.page = undefined;
  }

  public summary(): RecordingSummary { return this.current; }

  private async writeCheckpoints(): Promise<void> {
    if (!this.options) return;
    const body = this.checkpointItems.length ? `${this.checkpointItems.map((item) => JSON.stringify(item)).join('\n')}\n` : '';
    await writeFile(path.join(this.options.artifactDirectory, this.current.checkpoints), body, { flag: 'wx' });
  }
}

export function recordingEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.QA_ENABLE_RECORDING?.trim().toLowerCase() === 'true';
}

export async function findBrowserVideo(directory: string): Promise<string | undefined> {
  for (const name of await readdir(directory, { recursive: true }).catch(() => [] as string[])) {
    const target = path.join(directory, name);
    if ((await stat(target).catch(() => undefined))?.isFile() && /\.webm$/i.test(name)) return target;
  }
  return undefined;
}

export async function assertVideoArtifact(directory: string, summary: RecordingSummary): Promise<void> {
  if (summary.state !== 'available') throw new Error(`BLOCKED: recording capability is ${summary.state}: ${summary.limitations.join('; ')}`);
  if (!summary.video) throw new Error(`BLOCKED: recording was available but session.mp4 was not produced: ${summary.limitations.join('; ')}`);
  await access(path.join(directory, summary.video));
}
