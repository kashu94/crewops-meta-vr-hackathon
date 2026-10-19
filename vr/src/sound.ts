// Small synthesised cues, so the desk can be worked without looking at every panel:
// a tick when a card is picked up, a rising chime for legal cover, a low knock for a
// rule that fails, and a bright arpeggio when a plan goes out. No audio files.

let ctx: AudioContext | null = null;

function audio(): AudioContext | null {
  if (typeof window === 'undefined' || !('AudioContext' in window)) return null;
  ctx ??= new AudioContext();
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
}

function tone(freq: number, start: number, length: number, gain: number, type: OscillatorType = 'sine') {
  const a = audio();
  if (!a) return;
  const t = a.currentTime + start;
  const osc = a.createOscillator();
  const env = a.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  env.gain.setValueAtTime(0.0001, t);
  env.gain.exponentialRampToValueAtTime(gain, t + 0.012);
  env.gain.exponentialRampToValueAtTime(0.0001, t + length);
  osc.connect(env).connect(a.destination);
  osc.start(t);
  osc.stop(t + length + 0.02);
}

export const cue = {
  pick: () => tone(1320, 0, 0.06, 0.05, 'triangle'),
  checking: () => tone(880, 0, 0.08, 0.035, 'sine'),
  legal: () => {
    tone(659.25, 0, 0.22, 0.08);
    tone(987.77, 0.09, 0.32, 0.07);
  },
  illegal: () => {
    tone(196, 0, 0.22, 0.12, 'triangle');
    tone(155.56, 0.08, 0.28, 0.1, 'triangle');
  },
  placed: () => {
    tone(523.25, 0, 0.18, 0.07);
    tone(783.99, 0.07, 0.22, 0.07);
    tone(1046.5, 0.14, 0.34, 0.06);
  },
  sent: () => [523.25, 659.25, 783.99, 1046.5, 1318.5].forEach((f, i) => tone(f, i * 0.07, 0.3, 0.06)),
  select: () => tone(740, 0, 0.09, 0.05, 'triangle'),
  alert: () => {
    tone(880, 0, 0.18, 0.08);
    tone(1174.66, 0.16, 0.18, 0.08);
    tone(880, 0.32, 0.18, 0.08);
    tone(1174.66, 0.48, 0.3, 0.08);
  },
};
