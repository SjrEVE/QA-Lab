import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { redactSecrets } from './redaction.js';

export const VOICE_SCHEMA_VERSION = 1 as const;

export interface VoiceRequest {
  readonly schemaVersion: 1;
  readonly turn: number;
  readonly text: string;
  readonly locale: string;
  readonly output: { readonly format: 'wav'; readonly sampleRateHz: number; readonly channels: 1 };
}

export interface VoiceArtifact {
  readonly schemaVersion: 1;
  readonly turn: number;
  readonly state: 'available' | 'unavailable';
  readonly provider: string;
  readonly mediaType: 'audio/wav' | null;
  readonly bytes: Uint8Array | null;
  readonly durationMs: number | null;
  readonly synthetic: boolean;
  readonly limitation: string | null;
}

export interface VoiceProvider {
  readonly name: string;
  synthesize(request: VoiceRequest): Promise<VoiceArtifact>;
}

/** Optional provider boundary. Implementations own secret retrieval and must never put keys in requests/artifacts. */
export interface ExternalTtsAdapter {
  readonly name: string;
  synthesizeWav(request: VoiceRequest): Promise<Uint8Array>;
}

function unavailable(request: VoiceRequest, provider: string, limitation: string): VoiceArtifact {
  return { schemaVersion: 1, turn: request.turn, state: 'unavailable', provider, mediaType: null, bytes: null, durationMs: null, synthetic: true, limitation };
}

export class MockSilentVoiceProvider implements VoiceProvider {
  public readonly name = 'mock-silent';
  public synthesize(request: VoiceRequest): Promise<VoiceArtifact> {
    return Promise.resolve(unavailable(request, this.name, 'Silent mock intentionally produces no audio; text fallback remains authoritative.'));
  }
}

export class TextOnlyVoiceProvider implements VoiceProvider {
  public readonly name = 'text-only';
  public synthesize(request: VoiceRequest): Promise<VoiceArtifact> {
    return Promise.resolve(unavailable(request, this.name, 'Text-only provider does not claim an audio artifact.'));
  }
}

function writeAscii(target: Uint8Array, offset: number, value: string): void {
  for (let index = 0; index < value.length; index += 1) target[offset + index] = value.charCodeAt(index);
}

export function createDeterministicWav(durationMs = 250, sampleRateHz = 16_000, frequencyHz = 440): Uint8Array {
  if (!Number.isInteger(durationMs) || durationMs <= 0 || !Number.isInteger(sampleRateHz) || sampleRateHz < 8_000) throw new Error('Invalid deterministic WAV parameters.');
  const samples = Math.round(durationMs * sampleRateHz / 1_000);
  const dataBytes = samples * 2;
  const bytes = new Uint8Array(44 + dataBytes);
  const view = new DataView(bytes.buffer);
  writeAscii(bytes, 0, 'RIFF'); view.setUint32(4, 36 + dataBytes, true); writeAscii(bytes, 8, 'WAVE');
  writeAscii(bytes, 12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, sampleRateHz, true); view.setUint32(28, sampleRateHz * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  writeAscii(bytes, 36, 'data'); view.setUint32(40, dataBytes, true);
  for (let index = 0; index < samples; index += 1) {
    const envelope = index < 32 || index > samples - 33 ? 0 : 1;
    const sample = Math.round(Math.sin(2 * Math.PI * frequencyHz * index / sampleRateHz) * 4_000 * envelope);
    view.setInt16(44 + index * 2, sample, true);
  }
  return bytes;
}

export interface WavInfo { readonly valid: boolean; readonly sampleRateHz: number; readonly channels: number; readonly durationMs: number; readonly dataBytes: number }
export function inspectWav(bytes: Uint8Array): WavInfo {
  if (bytes.byteLength < 44) return { valid: false, sampleRateHz: 0, channels: 0, durationMs: 0, dataBytes: 0 };
  const text = (start: number, length: number) => String.fromCharCode(...bytes.slice(start, start + length));
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const channels = view.getUint16(22, true); const sampleRateHz = view.getUint32(24, true); const bits = view.getUint16(34, true); const dataBytes = view.getUint32(40, true);
  const valid = text(0, 4) === 'RIFF' && text(8, 4) === 'WAVE' && text(12, 4) === 'fmt ' && text(36, 4) === 'data' && channels > 0 && sampleRateHz > 0 && bits === 16 && 44 + dataBytes <= bytes.byteLength;
  const durationMs = valid ? Math.round(dataBytes / (sampleRateHz * channels * bits / 8) * 1_000) : 0;
  return { valid, sampleRateHz, channels, durationMs, dataBytes };
}

export class DeterministicWavVoiceProvider implements VoiceProvider {
  public readonly name = 'deterministic-wav';
  public constructor(private readonly durationMs = 250) {}
  public synthesize(request: VoiceRequest): Promise<VoiceArtifact> {
    const bytes = createDeterministicWav(this.durationMs, request.output.sampleRateHz);
    return Promise.resolve({ schemaVersion: 1, turn: request.turn, state: 'available', provider: this.name, mediaType: 'audio/wav', bytes, durationMs: inspectWav(bytes).durationMs, synthetic: true, limitation: 'Deterministic tone fixture; not a physical microphone or human voice.' });
  }
}

export class WavFixtureVoiceProvider implements VoiceProvider {
  public readonly name = 'wav-fixture';
  public constructor(private readonly fixturePath: string, private readonly fixtureRoot: string) {}
  public async synthesize(request: VoiceRequest): Promise<VoiceArtifact> {
    const root = path.resolve(this.fixtureRoot); const target = path.resolve(root, this.fixturePath);
    if (!target.startsWith(`${root}${path.sep}`)) throw new Error('WAV fixture must remain inside the fixture root.');
    const bytes = new Uint8Array(await readFile(target)); const info = inspectWav(bytes);
    if (!info.valid) throw new Error('Invalid PCM WAV fixture.');
    return { schemaVersion: 1, turn: request.turn, state: 'available', provider: this.name, mediaType: 'audio/wav', bytes, durationMs: info.durationMs, synthetic: true, limitation: String(redactSecrets('Synthetic fixture audio; not a physical microphone.')) };
  }
}

export class ExternalTtsVoiceProvider implements VoiceProvider {
  public constructor(private readonly adapter: ExternalTtsAdapter) {}
  public get name(): string { return `external:${this.adapter.name}`; }
  public async synthesize(request: VoiceRequest): Promise<VoiceArtifact> {
    const bytes = await this.adapter.synthesizeWav(request); const info = inspectWav(bytes);
    if (!info.valid) throw new Error('External TTS adapter returned invalid WAV.');
    return { schemaVersion: 1, turn: request.turn, state: 'available', provider: this.name, mediaType: 'audio/wav', bytes, durationMs: info.durationMs, synthetic: true, limitation: 'External adapter output; provider credentials and policy are adapter-owned.' };
  }
}

export function voiceEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.QA_ENABLE_VOICE?.trim().toLowerCase() === 'true';
}
