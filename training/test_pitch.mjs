/* offline accuracy test for the YIN pitch detector.
   synthesizes sax-like tones (harmonics + vibrato + noise), slides the
   analysis window across the tone, and compares each detection against
   the TRUE average frequency of that exact window (computed from the
   phase ramp) — the musically meaningful quantity. */
import { detectPitch } from "../src/pitch.js";

const SR = 44100;

function saxTone(freq, seconds, { vibratoCents = 0, vibratoHz = 5, noise = 0.003 } = {}) {
  const n = Math.floor(SR * seconds);
  const t = new Float32Array(n);
  const phase = new Float64Array(n);
  for (let i = 1; i < n; i++) {
    const f = freq * Math.pow(2, (vibratoCents / 1200) * Math.sin(2 * Math.PI * vibratoHz * (i / SR)));
    phase[i] = phase[i - 1] + (2 * Math.PI * f) / SR;
  }
  for (let i = 0; i < n; i++) {
    let s = Math.sin(phase[i]) + 0.5 * Math.sin(2 * phase[i]) + 0.3 * Math.sin(3 * phase[i])
          + 0.2 * Math.sin(4 * phase[i]) + 0.1 * Math.sin(5 * phase[i]);
    s += noise * (Math.random() * 2 - 1);
    t[i] = s * 0.25;
  }
  return { t, phase };
}

/* the exact average frequency of samples [start, start+2048) */
function windowMeanFreq(phase, start) {
  return (phase[start + 2047] - phase[start]) / (2 * Math.PI) * SR / 2047;
}

const results = { clean: [], vibrato: [], noisy: [] };
let octaveErrors = 0, missed = 0;

const testNotes = [];
for (let midi = 45; midi <= 84; midi += 3) {
  testNotes.push({ midi, f0: 440 * Math.pow(2, (midi - 69) / 12) });
}

for (const { midi, f0 } of testNotes) {
  const scenarios = [
    { key: "clean", vibratoCents: 0, noise: 0.002 },
    { key: "vibrato", vibratoCents: 25, noise: 0.003 },
    { key: "noisy", vibratoCents: 10, noise: 0.01 },
  ];
  for (const sc of scenarios) {
    const { t, phase } = saxTone(f0, 1.2, sc);
    // slide the window across a full vibrato period, keep the median error
    const errs = [];
    const step = Math.floor(SR / 20); // 50 ms hops
    for (let start = 0; start + 2048 < phase.length; start += step) {
      const trueMean = windowMeanFreq(phase, start);
      const r = detectPitch(t.slice(start, start + 2048), SR);
      if (r.freq <= 0) continue;
      const cents = 1200 * Math.log2(r.freq / trueMean);
      if (Math.abs(cents) > 600) { octaveErrors++; continue; }
      errs.push(cents);
    }
    if (!errs.length) { missed++; continue; }
    const med = errs.map(Math.abs).sort((a, b) => a - b)[Math.floor(errs.length / 2)];
    results[sc.key].push({ midi, med });
  }
}

function report(key) {
  const rows = results[key];
  const mae = rows.map((r) => r.med).reduce((a, b) => a + b, 0) / rows.length;
  const worst = [...rows].sort((a, b) => b.med - a.med)[0];
  return `${mae.toFixed(1)}¢ median · worst ${worst.med.toFixed(1)}¢ (midi ${worst.midi})`;
}

console.log(`clean  : ${report("clean")}`);
console.log(`vibrato: ${report("vibrato")}`);
console.log(`noisy  : ${report("noisy")}`);
console.log(`octave jumps: ${octaveErrors} · missed windows: ${missed}`);
const overall = [results.clean, results.vibrato, results.noisy].flat().map((r) => r.med);
const mae = overall.reduce((a, b) => a + b, 0) / overall.length;
if (mae < 8 && octaveErrors === 0) console.log(`PASS ✓ (overall median |error| ${mae.toFixed(1)}¢)`);
else console.log(`NEEDS TUNING ✗ (${mae.toFixed(1)}¢)`);
