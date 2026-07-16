import { spawn } from 'node:child_process';
import { access, mkdir, mkdtemp, readdir, rm, stat, statfs, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Page } from 'playwright';
import { redactSecrets } from './redaction.js';
import { startTabAudioCapture, stopTabAudioCapture, type CapturedTabAudio } from './tab-audio-capture.js';

export type RecordingState = 'available' | 'unavailable' | 'blocked';
export type RecordingOutcome = 'PASS' | 'FAIL' | 'RELEASE' | 'PARTIAL';

export interface RecorderCheckpoint {
  readonly schemaVersion: 1;
  readonly sequence: number;
  readonly timestampMs: number;
  readonly name: string;
  readonly screenshot: string;
}

export interface RecordingAudioArtifact {
  readonly role: 'student' | 'tutor';
  readonly state: RecordingState;
  readonly file: string | null;
  readonly source: string;
  readonly limitation: string | null;
}

export interface RecordingSummary {
  readonly schemaVersion: 1;
  readonly enabled: boolean;
  readonly state: RecordingState;
  readonly adapter: string;
  readonly video: string | null;
  readonly checkpoints: string;
  readonly audio?: readonly RecordingAudioArtifact[];
  readonly limitations: readonly string[];
  readonly retained: boolean;
}

export interface RecorderPrepareOptions {
  readonly artifactDirectory: string;
  readonly enabled: boolean;
  readonly release?: boolean;
  readonly deletePassVideo?: boolean;
  readonly minimumFreeBytes?: number;
  readonly captureTabAudio?: boolean;
  readonly requireAudio?: boolean;
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

export interface VideoArtifactValidationOptions {
  readonly expectedWidth?: number;
  readonly expectedHeight?: number;
  readonly minimumDurationMs?: number;
  readonly maximumDurationMs?: number;
  readonly minimumAudioCoverageRatio?: number;
  readonly maximumAudioCoverageRatio?: number;
  readonly requireAudio?: boolean;
  readonly ffmpegCommand?: string;
  readonly ffprobeCommand?: string;
}

export interface VideoArtifactInspection {
  readonly width: number;
  readonly height: number;
  readonly durationMs: number;
  readonly videoCodec: string;
  readonly audioCodec: string | null;
  readonly audioDurationMs: number | null;
  readonly audioCoverageRatio: number | null;
  readonly inspector: 'ffprobe+ffmpeg' | 'ffmpeg';
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

function finiteNumber(value: unknown): number | undefined {
  const number = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : Number.NaN;
  return Number.isFinite(number) && number >= 0 ? number : undefined;
}

function durationFromTimeBase(duration: unknown, timeBase: unknown): number | undefined {
  const ticks = finiteNumber(duration);
  if (ticks === undefined || typeof timeBase !== 'string') return undefined;
  const match = /^(\d+)\/(\d+)$/.exec(timeBase);
  if (!match) return undefined;
  const numerator = Number(match[1]);
  const denominator = Number(match[2]);
  return denominator > 0 ? ticks * numerator / denominator : undefined;
}

function secondsFromClock(value: string): number | undefined {
  const match = /^(\d+):(\d{2}):(\d{2}(?:\.\d+)?)$/.exec(value.trim());
  if (!match) return undefined;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  const seconds = Number(match[3]);
  return Number.isFinite(hours + minutes + seconds) ? hours * 3600 + minutes * 60 + seconds : undefined;
}

function lastFfmpegTime(output: string): number | undefined {
  const values = [...output.matchAll(/time=(\d+:\d{2}:\d{2}(?:\.\d+)?)/g)]
    .map((match) => secondsFromClock(match[1] ?? ''))
    .filter((value): value is number => value !== undefined);
  return values.at(-1);
}

type ProbeStream = {
  readonly codec_type?: unknown;
  readonly codec_name?: unknown;
  readonly width?: unknown;
  readonly height?: unknown;
  readonly duration?: unknown;
  readonly duration_ts?: unknown;
  readonly time_base?: unknown;
};

type ProbePayload = {
  readonly streams?: readonly ProbeStream[];
  readonly format?: { readonly duration?: unknown };
};

type PartialMediaInspection = {
  readonly width: number;
  readonly height: number;
  readonly durationSeconds: number;
  readonly videoCodec: string;
  readonly audioCodec: string | null;
  readonly audioDurationSeconds: number | null;
};

function parseFfprobePayload(payload: ProbePayload): PartialMediaInspection | undefined {
  const streams: readonly ProbeStream[] = payload.streams ?? [];
  const video = streams.find((stream) => stream.codec_type === 'video');
  if (!video) return undefined;
  const width = finiteNumber(video.width);
  const height = finiteNumber(video.height);
  const formatDuration = finiteNumber(payload.format?.duration);
  const videoDuration = finiteNumber(video.duration) ?? durationFromTimeBase(video.duration_ts, video.time_base) ?? formatDuration;
  if (width === undefined || height === undefined || videoDuration === undefined || videoDuration <= 0) return undefined;
  const audio = streams.find((stream) => stream.codec_type === 'audio');
  const audioDuration = audio
    ? finiteNumber(audio.duration) ?? durationFromTimeBase(audio.duration_ts, audio.time_base) ?? null
    : null;
  return {
    width: Math.round(width),
    height: Math.round(height),
    durationSeconds: videoDuration,
    videoCodec: typeof video.codec_name === 'string' ? video.codec_name : 'unknown',
    audioCodec: audio && typeof audio.codec_name === 'string' ? audio.codec_name : null,
    audioDurationSeconds: audioDuration,
  };
}

function parseFfmpegMetadata(output: string): PartialMediaInspection | undefined {
  const durationMatch = /Duration:\s*(\d+:\d{2}:\d{2}(?:\.\d+)?)/.exec(output);
  const videoLine = output.split(/\r?\n/).find((line) => /Stream #.*Video:/.test(line));
  if (!durationMatch || !videoLine) return undefined;
  const dimensions = /(?:^|[,\s])(\d{2,5})x(\d{2,5})(?:[,\s]|$)/.exec(videoLine);
  const durationSeconds = secondsFromClock(durationMatch[1] ?? '');
  if (!dimensions || durationSeconds === undefined || durationSeconds <= 0) return undefined;
  const videoCodec = /Video:\s*([^,\s]+)/.exec(videoLine)?.[1] ?? 'unknown';
  const audioLine = output.split(/\r?\n/).find((line) => /Stream #.*Audio:/.test(line));
  return {
    width: Number(dimensions[1]),
    height: Number(dimensions[2]),
    durationSeconds,
    videoCodec,
    audioCodec: audioLine ? /Audio:\s*([^,\s]+)/.exec(audioLine)?.[1] ?? 'unknown' : null,
    audioDurationSeconds: null,
  };
}

function ffprobeFor(ffmpegCommand: string): string {
  const configured = process.env.QA_FFPROBE_PATH?.trim();
  if (configured) return configured;
  const extension = path.extname(ffmpegCommand);
  const directory = path.dirname(ffmpegCommand);
  return directory === '.' ? 'ffprobe' : path.join(directory, `ffprobe${extension}`);
}

export function buildTabAudioMixFilter(offsetsMs: readonly number[]): string {
  if (offsetsMs.length === 0) throw new Error('At least one tab audio capture is required.');
  const inputs = offsetsMs.map((offset, index) => {
    const safeOffset = Math.max(0, Math.round(offset));
    return `[${index}:a]aresample=async=1:first_pts=0,adelay=${safeOffset}:all=1[a${index}]`;
  });
  const output = offsetsMs.length === 1
    ? '[a0]alimiter=limit=0.95[aout]'
    : `${offsetsMs.map((_, index) => `[a${index}]`).join('')}amix=inputs=${offsetsMs.length}:duration=longest:dropout_transition=0:normalize=0,alimiter=limit=0.95[aout]`;
  return `${inputs.join(';')};${output}`;
}

async function mixTabAudioCaptures(command: string, artifactDirectory: string, captures: readonly CapturedTabAudio[]): Promise<string | null> {
  const usable = captures
    .filter((capture) => capture.bytes.byteLength >= 256)
    .sort((left, right) => left.offsetMs - right.offsetMs);
  if (usable.length === 0) return null;
  const root = path.resolve(artifactDirectory);
  const staging = await mkdtemp(path.join(root, '.tab-audio-mix-'));
  if (!staging.startsWith(`${root}${path.sep}`)) throw new Error('Unsafe tab audio staging directory.');
  const target = path.join(root, 'tab-audio.m4a');
  try {
    const inputArgs: string[] = [];
    for (const [index, capture] of usable.entries()) {
      const source = path.join(staging, `source-${String(index).padStart(3, '0')}.webm`);
      await writeFile(source, capture.bytes, { flag: 'wx' });
      inputArgs.push('-i', source);
    }
    const filter = buildTabAudioMixFilter(usable.map((capture) => capture.offsetMs));
    const result = await run(command, ['-nostdin', '-n', ...inputArgs, '-filter_complex', filter, '-map', '[aout]', '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', target]);
    if (result.code !== 0) {
      await rm(target, { force: true });
      return null;
    }
    await access(target);
    return path.basename(target);
  } finally {
    await rm(staging, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  }
}

export async function inspectVideoArtifact(target: string, options: Pick<VideoArtifactValidationOptions, 'ffmpegCommand' | 'ffprobeCommand'> = {}): Promise<VideoArtifactInspection> {
  const ffmpegCommand = options.ffmpegCommand?.trim() || process.env.QA_FFMPEG_PATH?.trim() || 'ffmpeg';
  const ffprobeCommand = options.ffprobeCommand?.trim() || ffprobeFor(ffmpegCommand);
  const packetScan = await run(ffmpegCommand, [
    '-nostdin', '-hide_banner', '-xerror', '-i', target,
    '-map', '0:v:0', '-map', '0:a:0?', '-c', 'copy', '-f', 'null', '-',
  ]);
  if (packetScan.code !== 0) throw new Error(`BLOCKED: FFmpeg could not read the complete video artifact (${packetScan.code ?? 'spawn error'}).`);

  const ffmpegMetadata = parseFfmpegMetadata(packetScan.stderr);
  const probe = await run(ffprobeCommand, [
    '-v', 'error', '-show_entries',
    'format=duration:stream=codec_type,codec_name,width,height,duration,duration_ts,time_base',
    '-of', 'json', target,
  ]);
  let ffprobeMetadata: PartialMediaInspection | undefined;
  if (probe.code === 0) {
    try { ffprobeMetadata = parseFfprobePayload(JSON.parse(probe.stdout) as ProbePayload); }
    catch { ffprobeMetadata = undefined; }
  }
  const metadata = ffprobeMetadata ?? ffmpegMetadata;
  if (!metadata) throw new Error('BLOCKED: media metadata could not prove a readable video stream and positive duration.');

  let audioDurationSeconds = metadata.audioDurationSeconds;
  if (metadata.audioCodec) {
    const audioScan = await run(ffmpegCommand, [
      '-nostdin', '-hide_banner', '-xerror', '-i', target,
      '-map', '0:a:0', '-vn', '-f', 'null', '-',
    ]);
    if (audioScan.code !== 0) throw new Error(`BLOCKED: FFmpeg could not decode the complete audio stream (${audioScan.code ?? 'spawn error'}).`);
    audioDurationSeconds ??= lastFfmpegTime(audioScan.stderr) ?? null;
  }
  const audioCoverageRatio = audioDurationSeconds === null ? null : audioDurationSeconds / metadata.durationSeconds;
  return {
    width: metadata.width,
    height: metadata.height,
    durationMs: Math.round(metadata.durationSeconds * 1_000),
    videoCodec: metadata.videoCodec,
    audioCodec: metadata.audioCodec,
    audioDurationMs: audioDurationSeconds === null ? null : Math.round(audioDurationSeconds * 1_000),
    audioCoverageRatio,
    inspector: ffprobeMetadata ? 'ffprobe+ffmpeg' : 'ffmpeg',
  };
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
    checkpoints: 'recording-checkpoints.jsonl', audio: audioArtifactMetadata(false), limitations: ['Recorder has not been prepared.'], retained: false,
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
        : this.capability.available && options.captureTabAudio
          ? ['Full-HD browser video and in-tab Web Audio capture are armed; final audio is accepted only after artifact verification.']
          : this.capability.available
            ? ['Browser video contains no audio because in-tab audio capture was not requested.']
          : ['FFmpeg unavailable; session.mp4 cannot be produced. Screenshot timeline remains available.'];
    this.current = { schemaVersion: 1, enabled: options.enabled, state, adapter: this.name, video: null, checkpoints: 'recording-checkpoints.jsonl', audio: audioArtifactMetadata(false), limitations, retained: false };
    return this.current;
  }

  public async start(page: Page): Promise<void> {
    if (!this.options) throw new Error('Recorder must be prepared before start.');
    if (this.stopped) throw new Error('Recorder has already stopped.');
    this.page = page;
    if (this.current.state === 'available' && this.options.captureTabAudio) await startTabAudioCapture(page);
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
    let audioFile: string | null = null;
    let audioContextCount = 0;
    if (this.current.state === 'available' && this.options.captureTabAudio && this.page) {
      const captures = await stopTabAudioCapture(this.page).catch(() => []);
      audioContextCount = captures.filter((capture) => capture.bytes.byteLength >= 256).length;
      if (this.capability?.available) audioFile = await mixTabAudioCaptures(this.capability.command, this.options.artifactDirectory, captures).catch(() => null);
      if (!audioFile) limitations.push('In-tab Web Audio capture could not produce a valid combined audio artifact.');
    }
    // Persistent Playwright profiles finalize video when their browser context
    // closes. Closing only the final page can leave the recorder pipe alive on
    // Windows, so drain audio first and then close the dedicated QA context.
    if (this.current.state === 'available' && this.page && !this.page.isClosed()) await this.page.context().close();
    if (this.current.state === 'available') {
      const source = await findBrowserVideo(this.options.artifactDirectory);
      if (source && this.capability) {
        const target = path.join(this.options.artifactDirectory, 'session.mp4');
        const audioArgs = audioFile
          ? ['-i', path.join(this.options.artifactDirectory, audioFile), '-map', '0:v:0', '-map', '1:a:0', '-c:a', 'aac', '-b:a', '96k']
          : ['-an'];
        const inputArgs = ['-y', '-i', source, ...audioArgs];
        let result = await run(this.capability.command, [...inputArgs, '-c:v', 'h264_qsv', '-preset', 'veryfast', '-global_quality', '24', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', target]);
        if (result.code !== 0) {
          await rm(target, { force: true });
          result = await run(this.capability.command, [...inputArgs, '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '24', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', target]);
        }
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
    if (this.options.requireAudio && !audioFile) {
      if (video) await rm(path.join(this.options.artifactDirectory, video), { force: true });
      video = null;
      limitations.push('Required two-sided session audio was not captured; video acceptance is blocked.');
    }
    const deletePass = (this.options.deletePassVideo ?? true) && outcome === 'PASS' && !this.options.release;
    if (deletePass && video) {
      await rm(path.join(this.options.artifactDirectory, video), { force: true });
      video = null;
      limitations.push('PASS retention policy deleted video early; checkpoints retained.');
    }
    const audio = audioFile
      ? [
          { role: 'student' as const, state: 'available' as const, file: audioFile, source: `tab-web-audio-mix:${audioContextCount}-contexts`, limitation: 'Mixed tab track; role separation is verified from synchronized turn events.' },
          { role: 'tutor' as const, state: 'available' as const, file: audioFile, source: `tab-web-audio-mix:${audioContextCount}-contexts`, limitation: 'Mixed tab track; role separation is verified from synchronized turn events.' },
        ]
      : audioArtifactMetadata(false);
    this.current = { ...this.current, video, audio, retained: video !== null, limitations };
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

export function audioArtifactMetadata(available: boolean, studentFile: string | null = null, tutorFile: string | null = null): readonly RecordingAudioArtifact[] {
  return [
    { role: 'student', state: available && studentFile ? 'available' : 'unavailable', file: available ? studentFile : null, source: 'student_audio.monitor', limitation: available && studentFile ? null : 'Student audio was not captured; no audio artifact is claimed.' },
    { role: 'tutor', state: available && tutorFile ? 'available' : 'unavailable', file: available ? tutorFile : null, source: 'tutor_audio.monitor', limitation: available && tutorFile ? null : 'Tutor audio was not captured; no audio artifact is claimed.' },
  ];
}

export function recordingEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.QA_ENABLE_RECORDING?.trim().toLowerCase() === 'true';
}

export async function findBrowserVideo(directory: string): Promise<string | undefined> {
  for (const name of await readdir(directory, { recursive: true }).catch(() => [] as string[])) {
    const target = path.join(directory, name);
    if ((await stat(target).catch(() => undefined))?.isFile() && /\.webm$/i.test(name) && !/tab-audio/i.test(name)) return target;
  }
  return undefined;
}

export async function assertVideoArtifact(directory: string, summary: RecordingSummary, options: VideoArtifactValidationOptions = {}): Promise<VideoArtifactInspection> {
  if (summary.state !== 'available') throw new Error(`BLOCKED: recording capability is ${summary.state}: ${summary.limitations.join('; ')}`);
  if (!summary.video) throw new Error(`BLOCKED: recording was available but session.mp4 was not produced: ${summary.limitations.join('; ')}`);
  const target = path.join(directory, summary.video);
  await access(target);
  const expectedWidth = options.expectedWidth ?? 1_920;
  const expectedHeight = options.expectedHeight ?? 1_080;
  const minimumDurationMs = options.minimumDurationMs ?? 500;
  const maximumDurationMs = options.maximumDurationMs ?? Number.POSITIVE_INFINITY;
  const minimumAudioCoverageRatio = options.minimumAudioCoverageRatio ?? 0.8;
  const maximumAudioCoverageRatio = options.maximumAudioCoverageRatio ?? 1.1;
  const requireAudio = options.requireAudio ?? true;
  if (expectedWidth <= 0 || expectedHeight <= 0 || minimumDurationMs < 0 || maximumDurationMs < minimumDurationMs) {
    throw new Error('Invalid video artifact geometry or duration validation bounds.');
  }
  if (minimumAudioCoverageRatio < 0 || maximumAudioCoverageRatio < minimumAudioCoverageRatio) {
    throw new Error('Invalid video artifact audio coverage validation bounds.');
  }
  const inspection = await inspectVideoArtifact(target, options);
  if (inspection.width !== expectedWidth || inspection.height !== expectedHeight) {
    throw new Error(`BLOCKED: expected ${expectedWidth}x${expectedHeight}, received ${inspection.width}x${inspection.height}.`);
  }
  if (inspection.durationMs < minimumDurationMs || inspection.durationMs > maximumDurationMs) {
    throw new Error(`BLOCKED: video duration ${inspection.durationMs}ms is outside ${minimumDurationMs}-${maximumDurationMs}ms.`);
  }
  if (requireAudio && (!inspection.audioCodec || inspection.audioDurationMs === null || inspection.audioCoverageRatio === null)) {
    throw new Error('BLOCKED: the video artifact does not contain a readable audio stream with measurable duration.');
  }
  if (inspection.audioCoverageRatio !== null && (inspection.audioCoverageRatio < minimumAudioCoverageRatio || inspection.audioCoverageRatio > maximumAudioCoverageRatio)) {
    throw new Error(`BLOCKED: audio coverage ${inspection.audioCoverageRatio.toFixed(3)} is outside ${minimumAudioCoverageRatio}-${maximumAudioCoverageRatio}.`);
  }
  return inspection;
}
