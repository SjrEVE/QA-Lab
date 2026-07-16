import type { Page } from 'playwright';

export type CapturedTabAudio = {
  readonly mediaType: 'audio/webm';
  readonly bytes: Uint8Array;
  readonly offsetMs: number;
  readonly durationMs: number;
};

export const TAB_AUDIO_CAPTURE_INIT_SCRIPT = String.raw`(() => {
  if (globalThis.__qaAudioCapture) return;
  const NativeAudioContext = globalThis.AudioContext || globalThis.webkitAudioContext;
  if (!NativeAudioContext || !globalThis.MediaRecorder) return;
  const nativeConnect = globalThis.AudioNode.prototype.connect;
  const contexts = [];
  const byContext = new WeakMap();
  let captureStartedAt = 0;
  let enabled = false;
  let qaPlaybackEntry = null;

  const toBase64 = (bytes) => {
    let result = '';
    const chunk = 0x8000;
    for (let index = 0; index < bytes.length; index += chunk) result += String.fromCharCode(...bytes.subarray(index, index + chunk));
    return btoa(result);
  };

  const startRecorder = (entry) => {
    if (!enabled || entry.recorder.state !== 'inactive') return;
    entry.offsetMs = Math.max(0, Math.round(performance.now() - captureStartedAt));
    entry.startedAt = performance.now();
    entry.recorder.start(1000);
  };

  const register = (context) => {
    if (byContext.has(context)) return byContext.get(context);
    const destination = context.createMediaStreamDestination();
    const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : 'audio/webm';
    const recorder = new MediaRecorder(destination.stream, { mimeType, audioBitsPerSecond: 32000 });
    const entry = { context, destination, recorder, chunks: [], connected: new WeakSet(), offsetMs: 0, startedAt: 0 };
    recorder.ondataavailable = (event) => { if (event.data && event.data.size > 0) entry.chunks.push(event.data); };
    byContext.set(context, entry);
    contexts.push(entry);
    startRecorder(entry);
    return entry;
  };

  class QaCapturedAudioContext extends NativeAudioContext {
    constructor(...args) {
      super(...args);
      register(this);
    }
  }
  Object.defineProperty(QaCapturedAudioContext, 'name', { value: 'AudioContext' });
  globalThis.AudioContext = QaCapturedAudioContext;
  if (globalThis.webkitAudioContext) globalThis.webkitAudioContext = QaCapturedAudioContext;

  globalThis.AudioNode.prototype.connect = function(destination, ...rest) {
    const result = nativeConnect.call(this, destination, ...rest);
    const entry = byContext.get(this.context);
    if (entry && destination === this.context.destination && this !== entry.destination && !entry.connected.has(this)) {
      entry.connected.add(this);
      nativeConnect.call(this, entry.destination);
    }
    return result;
  };

  globalThis.__qaAudioCapture = {
    start() {
      if (enabled) return;
      enabled = true;
      captureStartedAt = performance.now();
      contexts.forEach(startRecorder);
    },
    async play(base64, mediaType) {
      if (!qaPlaybackEntry || qaPlaybackEntry.context.state === 'closed') qaPlaybackEntry = register(new globalThis.AudioContext());
      const entry = qaPlaybackEntry;
      if (entry.context.state === 'suspended') await entry.context.resume();
      const binary = atob(base64);
      const bytes = new Uint8Array(binary.length);
      for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
      const buffer = await entry.context.decodeAudioData(bytes.buffer.slice(0));
      const source = entry.context.createBufferSource();
      source.buffer = buffer;
      source.connect(entry.context.destination);
      const startedAt = performance.now();
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Encoded QA speech timed out.')), Math.max(15000, buffer.duration * 3000));
        source.onended = () => { clearTimeout(timer); resolve(); };
        source.start();
      });
      return { durationMs: Math.round(performance.now() - startedAt), decodedDurationMs: Math.round(buffer.duration * 1000), mediaType };
    },
    async schedule(base64, mediaType) {
      if (!qaPlaybackEntry || qaPlaybackEntry.context.state === 'closed') qaPlaybackEntry = register(new globalThis.AudioContext());
      const entry = qaPlaybackEntry;
      if (entry.context.state === 'suspended') await entry.context.resume();
      const binary = atob(base64);
      const bytes = new Uint8Array(binary.length);
      for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
      const buffer = await entry.context.decodeAudioData(bytes.buffer.slice(0));
      const source = entry.context.createBufferSource();
      source.buffer = buffer;
      source.connect(entry.context.destination);
      source.start();
      return { durationMs: 0, decodedDurationMs: Math.round(buffer.duration * 1000), mediaType };
    },
    async stop() {
      enabled = false;
      const results = await Promise.all(contexts.map(async (entry) => {
        if (entry.recorder.state !== 'inactive') {
          await new Promise((resolve) => {
            let settled = false;
            const finish = () => {
              if (settled) return;
              settled = true;
              clearTimeout(timer);
              resolve();
            };
            const timer = setTimeout(finish, 5000);
            entry.recorder.addEventListener('stop', finish, { once: true });
            try { entry.recorder.stop(); } catch { finish(); }
          });
        }
        const blob = new Blob(entry.chunks, { type: 'audio/webm' });
        const bytes = new Uint8Array(await blob.arrayBuffer());
        return { mediaType: 'audio/webm', base64: toBase64(bytes), offsetMs: entry.offsetMs, durationMs: Math.max(0, Math.round(performance.now() - entry.startedAt)) };
      }));
      return results.filter((item) => item.base64.length > 0).sort((left, right) => left.offsetMs - right.offsetMs);
    }
  };
})();`;

export async function startTabAudioCapture(page: Page): Promise<void> {
  await page.evaluate(() => {
    const capture = (globalThis as typeof globalThis & { __qaAudioCapture?: { start(): void } }).__qaAudioCapture;
    if (!capture) throw new Error('Tab audio capture was not installed before navigation.');
    capture.start();
  });
}

export async function playEncodedAudioAudibly(page: Page, bytes: Uint8Array, mediaType: 'audio/mpeg'): Promise<{ readonly durationMs: number; readonly decodedDurationMs: number }> {
  const base64 = Buffer.from(bytes).toString('base64');
  return page.evaluate(async ({ audio, type }) => {
    const capture = (globalThis as typeof globalThis & { __qaAudioCapture?: { play(value: string, mediaType: string): Promise<{ durationMs: number; decodedDurationMs: number }> } }).__qaAudioCapture;
    if (!capture) throw new Error('Tab audio capture was not installed before navigation.');
    return capture.play(audio, type);
  }, { audio: base64, type: mediaType });
}

export async function scheduleEncodedAudioAudibly(page: Page, bytes: Uint8Array, mediaType: 'audio/mpeg'): Promise<{ readonly durationMs: number; readonly decodedDurationMs: number }> {
  const base64 = Buffer.from(bytes).toString('base64');
  return page.evaluate(async ({ audio, type }) => {
    const capture = (globalThis as typeof globalThis & { __qaAudioCapture?: { schedule(value: string, mediaType: string): Promise<{ durationMs: number; decodedDurationMs: number }> } }).__qaAudioCapture;
    if (!capture) throw new Error('Tab audio capture was not installed before navigation.');
    return capture.schedule(audio, type);
  }, { audio: base64, type: mediaType });
}

export async function stopTabAudioCapture(page: Page): Promise<readonly CapturedTabAudio[]> {
  const capture = page.evaluate(async () => {
    const capture = (globalThis as typeof globalThis & { __qaAudioCapture?: { stop(): Promise<Array<{ mediaType: 'audio/webm'; base64: string; offsetMs: number; durationMs: number }>> } }).__qaAudioCapture;
    if (!capture) throw new Error('Tab audio capture was not installed before navigation.');
    return capture.stop();
  });
  const timeout = new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Tab audio capture stop timed out.')), 12_000));
  const results = await Promise.race([capture, timeout]);
  return results.map((item) => ({ mediaType: item.mediaType, bytes: new Uint8Array(Buffer.from(item.base64, 'base64')), offsetMs: item.offsetMs, durationMs: item.durationMs }));
}
