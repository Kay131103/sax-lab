/* ============================================================
 *  Pitch detection by autocorrelation (ACF2+), from scratch.
 *  No libraries: the raw PCM buffer comes from a Web Audio
 *  AnalyserNode; we correlate the signal against itself at every
 *  lag — the first strong peak after the direct signal is the
 *  period. Parabolic interpolation sharpens the estimate.
 * ============================================================ */

export function autoCorrelate(buf, sampleRate) {
  const SIZE = buf.length;

  // RMS gate: silence = no pitch
  let rms = 0;
  for (let i = 0; i < SIZE; i++) rms += buf[i] * buf[i];
  rms = Math.sqrt(rms / SIZE);
  if (rms < 0.008) return { freq: -1, clarity: 0, rms };

  // trim low-amplitude edges
  let r1 = 0, r2 = SIZE - 1;
  const thres = 0.2;
  for (let i = 0; i < SIZE / 2; i++) if (Math.abs(buf[i]) < thres) { r1 = i; break; }
  for (let i = 1; i < SIZE / 2; i++) if (Math.abs(buf[SIZE - i]) < thres) { r2 = SIZE - i; break; }
  const trimmed = buf.slice(r1, r2);
  const N = trimmed.length;
  if (N < 256) return { freq: -1, clarity: 0, rms };

  // autocorrelation: c[lag] = Σ buf[j] * buf[j+lag]
  const c = new Float32Array(N);
  for (let lag = 0; lag < N; lag++) {
    let sum = 0;
    for (let j = 0; j < N - lag; j++) sum += trimmed[j] * trimmed[j + lag];
    c[lag] = sum;
  }

  // skip past the direct signal (descending slope near lag 0)
  let d = 0;
  while (d < N - 1 && c[d] > c[d + 1]) d++;

  // first strong peak after the slope = the fundamental period
  let maxval = -1, maxpos = -1;
  for (let i = d; i < N; i++) {
    if (c[i] > maxval) { maxval = c[i]; maxpos = i; }
  }
  if (maxpos <= 0) return { freq: -1, clarity: 0, rms };

  // parabolic interpolation around the peak for sub-sample precision
  const x1 = c[maxpos - 1], x2 = c[maxpos], x3 = c[Math.min(maxpos + 1, N - 1)];
  const a = (x1 + x3 - 2 * x2) / 2, b = (x3 - x1) / 2;
  let T0 = maxpos;
  if (a) T0 = T0 - b / (2 * a);

  const freq = sampleRate / T0;
  const clarity = maxval / (c[0] || 1);
  if (freq < 60 || freq > 2000 || clarity < 0.25) return { freq: -1, clarity, rms };
  return { freq, clarity, rms };
}
