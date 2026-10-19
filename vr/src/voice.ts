import type { Backend } from './backend.js';

// Speaking replies and hearing questions. Replies use the web app's Polly voice when
// signed in, the browser's own voice otherwise. Questions use the browser's speech
// recognition where it exists; where it doesn't, the suggested questions are the way in.

type Recognition = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((event: { results: ArrayLike<{ 0: { transcript: string } }> }) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
};

let playing: HTMLAudioElement | null = null;

export async function say(backend: Backend, text: string): Promise<void> {
  stopSpeaking();
  try {
    const clip = await backend.speech(text);
    if (clip) {
      const url = URL.createObjectURL(clip);
      playing = new Audio(url);
      playing.onended = () => URL.revokeObjectURL(url);
      await playing.play();
      return;
    }
  } catch {
    // fall through to the browser's voice
  }
  if ('speechSynthesis' in window) {
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'en-IN';
    window.speechSynthesis.speak(utterance);
  }
}

export function stopSpeaking(): void {
  playing?.pause();
  playing = null;
  if ('speechSynthesis' in window) window.speechSynthesis.cancel();
}

export function canListen(): boolean {
  const w = window as unknown as { SpeechRecognition?: unknown; webkitSpeechRecognition?: unknown };
  return Boolean(w.SpeechRecognition ?? w.webkitSpeechRecognition);
}

/** One question, heard once. Resolves with what was said, or null. */
export function listen(): Promise<string | null> {
  const w = window as unknown as {
    SpeechRecognition?: new () => Recognition;
    webkitSpeechRecognition?: new () => Recognition;
  };
  const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
  if (!Ctor) return Promise.resolve(null);
  return new Promise((resolve) => {
    const r = new Ctor();
    r.lang = 'en-IN';
    r.interimResults = false;
    r.continuous = false;
    let heard: string | null = null;
    r.onresult = (event) => {
      heard = event.results[0]?.[0]?.transcript?.trim() || null;
    };
    r.onerror = () => resolve(null);
    r.onend = () => resolve(heard);
    r.start();
  });
}
