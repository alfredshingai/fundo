// Fundo sounds — tiny WebAudio synth, no audio files needed.
// Reward SFX + flashcard read-aloud via the browser SpeechSynthesis API.

let ctx = null;

function ac() {
  if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
  if (ctx.state === "suspended") ctx.resume();
  return ctx;
}

function tone(freq, start, dur, type = "sine", gain = 0.12) {
  const a = ac();
  const o = a.createOscillator();
  const g = a.createGain();
  o.type = type;
  o.frequency.value = freq;
  g.gain.setValueAtTime(0.0001, a.currentTime + start);
  g.gain.exponentialRampToValueAtTime(gain, a.currentTime + start + 0.015);
  g.gain.exponentialRampToValueAtTime(0.0001, a.currentTime + start + dur);
  o.connect(g).connect(a.destination);
  o.start(a.currentTime + start);
  o.stop(a.currentTime + start + dur + 0.05);
}

// Settings → "Reward sounds" toggle (default on). Every SFX goes through the
// gated wrapper below so the switch actually mutes the app.
function sfxEnabled() {
  try { return localStorage.getItem("sf-sfx") !== "off"; } catch { return true; }
}

const rawSfx = {
  correct() {
    tone(523.25, 0, .12, "sine", .10);   // C5
    tone(659.25, .08, .14, "sine", .10); // E5
    tone(783.99, .16, .22, "sine", .12); // G5
  },
  wrong() {
    tone(220, 0, .18, "sawtooth", .06);
    tone(174.61, .12, .25, "sawtooth", .06);
  },
  flip() {
    tone(440, 0, .05, "triangle", .05);
  },
  levelUp() {
    [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => tone(f, i * .09, .25, "triangle", .12));
    tone(1318.5, .4, .5, "sine", .10);
  },
  streak() {
    tone(880, 0, .1, "sine", .08);
    tone(1174.66, .1, .18, "sine", .08);
  },
  complete() {
    [392, 523.25, 659.25, 783.99].forEach((f, i) => tone(f, i * .1, .3, "sine", .11));
  },
  upload() {
    tone(660, 0, .08, "sine", .07);
    tone(880, .07, .1, "sine", .07);
  },
  click() {
    tone(600, 0, .03, "triangle", .04);
  },
};

export const sfx = Object.fromEntries(
  Object.entries(rawSfx).map(([name, fn]) => [
    name,
    (...args) => { if (sfxEnabled()) fn(...args); },
  ]),
);

// --- speech (reads flashcards aloud — reading only, never explanations) -----

let enabled = true;

export function setTtsEnabled(v) {
  enabled = v;
  if (!v) stopSpeaking();
}

export function ttsSupported() {
  return "speechSynthesis" in window;
}

export function speak(text, opts = {}) {
  stopSpeaking();
  if (!enabled || !ttsSupported()) { if (opts.onEnd) opts.onEnd(); return; }
  const u = new SpeechSynthesisUtterance(text);
  u.rate = opts.rate ?? 1;
  u.onend = () => { if (opts.onEnd) opts.onEnd(); };
  u.onerror = () => { if (opts.onEnd) opts.onEnd(); };
  speechSynthesis.speak(u);
}

export function stopSpeaking() {
  if (ttsSupported()) speechSynthesis.cancel();
}
