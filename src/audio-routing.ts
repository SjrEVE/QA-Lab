import { spawn } from 'node:child_process';

export const STUDENT_SINK = 'student_audio' as const;
export const TUTOR_SINK = 'tutor_audio' as const;
export const STUDENT_MIC_SOURCE = 'student_audio.monitor' as const;

export interface AudioRoutePlan {
  readonly schemaVersion: 1;
  readonly backend: 'pulseaudio' | 'pipewire-pulse';
  readonly studentSink: typeof STUDENT_SINK;
  readonly tutorSink: typeof TUTOR_SINK;
  readonly chromiumMicrophoneSource: typeof STUDENT_MIC_SOURCE;
  readonly tutorCaptureSource: 'tutor_audio.monitor';
  readonly links: readonly [{ readonly from: 'voice-provider'; readonly to: typeof STUDENT_SINK }, { readonly from: 'chromium-output'; readonly to: typeof TUTOR_SINK }];
  readonly forbiddenLinks: readonly ['tutor_audio.monitor->student_audio', 'student_audio.monitor->tutor_audio'];
}

export interface AudioRoutingCapability {
  readonly platform: NodeJS.Platform;
  readonly available: boolean;
  readonly backend: AudioRoutePlan['backend'] | null;
  readonly pactlAvailable: boolean;
  readonly sinksReady: boolean;
  readonly studentMonitorReady: boolean;
  readonly tutorMonitorReady: boolean;
  readonly echoIsolated: boolean;
  readonly reason: string;
  readonly evidence: readonly string[];
}

type CommandResult = { readonly code: number | null; readonly stdout: string; readonly stderr: string };
export type AudioCommandRunner = (command: string, args: readonly string[]) => Promise<CommandResult>;

const defaultRunner: AudioCommandRunner = (command, args) => new Promise((resolve) => {
  const child = spawn(command, [...args], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true }); let stdout = ''; let stderr = '';
  child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString(); }); child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });
  child.on('error', (error) => resolve({ code: null, stdout, stderr: error.message })); child.on('close', (code) => resolve({ code, stdout, stderr }));
});

export function createAudioRoutePlan(backend: AudioRoutePlan['backend'] = 'pulseaudio'): AudioRoutePlan {
  return { schemaVersion: 1, backend, studentSink: STUDENT_SINK, tutorSink: TUTOR_SINK, chromiumMicrophoneSource: STUDENT_MIC_SOURCE, tutorCaptureSource: 'tutor_audio.monitor', links: [{ from: 'voice-provider', to: STUDENT_SINK }, { from: 'chromium-output', to: TUTOR_SINK }], forbiddenLinks: ['tutor_audio.monitor->student_audio', 'student_audio.monitor->tutor_audio'] };
}

export function validateAudioRoutePlan(plan: AudioRoutePlan): void {
  if (String(plan.studentSink) === String(plan.tutorSink)) throw new Error('Student and tutor sinks must be isolated.');
  const links = plan.links.map((link) => `${link.from}->${link.to}`);
  if (links.some((link) => plan.forbiddenLinks.includes(link as AudioRoutePlan['forbiddenLinks'][number]))) throw new Error('Audio plan contains an echo loop.');
  if (plan.chromiumMicrophoneSource !== `${plan.studentSink}.monitor`) throw new Error('Chromium microphone must use only the student sink monitor.');
}

export async function probeAudioRouting(runner: AudioCommandRunner = defaultRunner, platform: NodeJS.Platform = process.platform): Promise<AudioRoutingCapability> {
  if (platform !== 'linux') return { platform, available: false, backend: null, pactlAvailable: false, sinksReady: false, studentMonitorReady: false, tutorMonitorReady: false, echoIsolated: false, reason: 'Native virtual audio routing requires Linux PulseAudio or PipeWire Pulse compatibility.', evidence: [`platform=${platform}`, 'pactl=not-probed'] };
  const info = await runner('pactl', ['info']);
  if (info.code !== 0) return { platform, available: false, backend: null, pactlAvailable: false, sinksReady: false, studentMonitorReady: false, tutorMonitorReady: false, echoIsolated: false, reason: 'pactl is unavailable or no Pulse-compatible server is running.', evidence: ['platform=linux', 'pactl=unavailable'] };
  const backend: AudioRoutePlan['backend'] = /pipewire/i.test(info.stdout) ? 'pipewire-pulse' : 'pulseaudio';
  const sinks = await runner('pactl', ['list', 'short', 'sinks']); const sources = await runner('pactl', ['list', 'short', 'sources']); const modules = await runner('pactl', ['list', 'short', 'modules']);
  const studentSink = new RegExp(`\\b${STUDENT_SINK}\\b`).test(sinks.stdout); const tutorSink = new RegExp(`\\b${TUTOR_SINK}\\b`).test(sinks.stdout);
  const studentMonitor = sources.stdout.includes(STUDENT_MIC_SOURCE); const tutorMonitor = sources.stdout.includes('tutor_audio.monitor');
  const suspiciousLoop = /module-loopback.*(?:tutor_audio\.monitor.*student_audio|student_audio\.monitor.*tutor_audio)/i.test(modules.stdout);
  const ready = sinks.code === 0 && sources.code === 0 && studentSink && tutorSink && studentMonitor && tutorMonitor && !suspiciousLoop;
  return { platform, available: ready, backend, pactlAvailable: true, sinksReady: studentSink && tutorSink, studentMonitorReady: studentMonitor, tutorMonitorReady: tutorMonitor, echoIsolated: !suspiciousLoop, reason: ready ? 'Two isolated virtual sinks and monitor sources are ready.' : 'Pulse-compatible server found, but isolated sink setup is incomplete or unsafe.', evidence: [`backend=${backend}`, `student_sink=${studentSink}`, `tutor_sink=${tutorSink}`, `student_monitor=${studentMonitor}`, `tutor_monitor=${tutorMonitor}`, `echo_isolated=${!suspiciousLoop}`] };
}

export interface ChromiumVoiceOptions { readonly permissions: readonly ['microphone']; readonly args: readonly string[]; readonly microphoneSource: typeof STUDENT_MIC_SOURCE; readonly syntheticFixture: boolean }
export function chromiumVoiceOptions(enabled: boolean, syntheticWavPath?: string): ChromiumVoiceOptions | undefined {
  if (!enabled) return undefined;
  const args = ['--use-fake-ui-for-media-stream'];
  if (syntheticWavPath) args.push('--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${syntheticWavPath}`);
  return { permissions: ['microphone'], args, microphoneSource: STUDENT_MIC_SOURCE, syntheticFixture: syntheticWavPath !== undefined };
}
