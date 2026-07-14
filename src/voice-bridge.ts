import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { redactSecrets } from './redaction.js';
import type { AudioRoutingCapability } from './audio-routing.js';
import type { VoiceArtifact, VoiceProvider, VoiceRequest } from './voice-provider.js';

export interface VoiceTurnInput { readonly turn: number; readonly text: string }
export interface VoiceTurnResult { readonly turn: number; readonly mode: 'voice' | 'text-fallback'; readonly artifact: Omit<VoiceArtifact, 'bytes'>; readonly text: string }
export interface VoiceBridgeOptions { readonly enabled: boolean; readonly provider: VoiceProvider; readonly routing: AudioRoutingCapability; readonly artifactDirectory?: string; readonly allowDeterministicFixture?: boolean }

export class VoiceBridge {
  public constructor(private readonly options: VoiceBridgeOptions) {}

  public async runTurn(input: VoiceTurnInput): Promise<VoiceTurnResult> {
    const text = String(redactSecrets(input.text));
    const base = { schemaVersion: 1 as const, turn: input.turn, text, locale: 'vi-VN', output: { format: 'wav' as const, sampleRateHz: 16_000, channels: 1 as const } } satisfies VoiceRequest;
    if (!this.options.enabled) return this.fallback(base, 'Voice disabled by safe default.');
    if (!this.options.routing.available && !this.options.allowDeterministicFixture) return this.fallback(base, this.options.routing.reason);
    try {
      const artifact = await this.options.provider.synthesize(base);
      if (artifact.state !== 'available' || !artifact.bytes) return this.result(base, artifact, 'text-fallback');
      if (this.options.artifactDirectory) {
        const audioDirectory = path.join(this.options.artifactDirectory, 'audio'); await mkdir(audioDirectory, { recursive: true });
        const filename = `student-turn-${String(input.turn).padStart(2, '0')}.wav`;
        await writeFile(path.join(audioDirectory, filename), artifact.bytes, { flag: 'wx' });
        await writeFile(path.join(audioDirectory, `${filename}.json`), `${JSON.stringify({ schemaVersion: 1, role: 'student', turn: input.turn, file: filename, durationMs: artifact.durationMs, provider: artifact.provider, synthetic: artifact.synthetic, limitation: artifact.limitation }, null, 2)}\n`, { flag: 'wx' });
      }
      return this.result(base, artifact, 'voice');
    } catch (error) {
      return this.fallback(base, `Voice provider failed; text mode preserved: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  public async runTurns(inputs: readonly VoiceTurnInput[]): Promise<readonly VoiceTurnResult[]> {
    const results: VoiceTurnResult[] = [];
    for (const input of inputs) results.push(await this.runTurn(input));
    return results;
  }

  private fallback(request: VoiceRequest, limitation: string): VoiceTurnResult {
    return this.result(request, { schemaVersion: 1, turn: request.turn, state: 'unavailable', provider: this.options.provider.name, mediaType: null, bytes: null, durationMs: null, synthetic: true, limitation }, 'text-fallback');
  }

  private result(request: VoiceRequest, artifact: VoiceArtifact, mode: VoiceTurnResult['mode']): VoiceTurnResult {
    const { bytes: _bytes, ...metadata } = artifact; void _bytes;
    return { turn: request.turn, mode, artifact: metadata, text: request.text };
  }
}
