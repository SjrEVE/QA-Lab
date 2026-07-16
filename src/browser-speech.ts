import type { Page } from 'playwright';

export type BrowserSpeechResult = {
  readonly durationMs: number;
  readonly locale: string;
};

export async function speakVietnameseAudibly(page: Page, text: string): Promise<BrowserSpeechResult> {
  return page.evaluate(async (speechText) => {
    if (!('speechSynthesis' in window)) throw new Error('Browser speech synthesis is unavailable.');
    const synth = window.speechSynthesis;
    if (synth.paused) synth.resume();
    let voices = synth.getVoices();
    if (voices.length === 0) {
      await new Promise<void>((resolve) => {
        const timeout = window.setTimeout(resolve, 1_500);
        synth.addEventListener('voiceschanged', () => {
          window.clearTimeout(timeout);
          resolve();
        }, { once: true });
      });
      voices = synth.getVoices();
    }
    const voice = voices.find((candidate) => candidate.lang.toLowerCase().startsWith('vi')) ?? voices[0];
    const retained = window as typeof window & { __qaActiveUtterances?: Set<SpeechSynthesisUtterance> };
    retained.__qaActiveUtterances ??= new Set<SpeechSynthesisUtterance>();
    return new Promise<BrowserSpeechResult>((resolve, reject) => {
      const utterance = new SpeechSynthesisUtterance(speechText);
      if (voice) utterance.voice = voice;
      utterance.lang = voice?.lang ?? 'vi-VN';
      utterance.rate = 0.95;
      utterance.pitch = 1.05;
      retained.__qaActiveUtterances!.add(utterance);
      let started = 0;
      const timeout = window.setTimeout(() => {
        retained.__qaActiveUtterances!.delete(utterance);
        reject(new Error('Browser speech synthesis timed out.'));
      }, 20_000);
      utterance.onstart = () => {
        started = performance.now();
        console.info('[qa-brain] speech_start', utterance.lang);
      };
      utterance.onend = () => {
        window.clearTimeout(timeout);
        retained.__qaActiveUtterances!.delete(utterance);
        const durationMs = Math.round(performance.now() - (started || performance.now()));
        console.info('[qa-brain] speech_end', durationMs);
        resolve({ durationMs, locale: utterance.lang });
      };
      utterance.onerror = (event) => {
        window.clearTimeout(timeout);
        retained.__qaActiveUtterances!.delete(utterance);
        reject(new Error(`Browser speech synthesis failed (${event.error}).`));
      };
      synth.speak(utterance);
    });
  }, text);
}
