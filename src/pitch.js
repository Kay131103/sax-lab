/* ============================================================
 *  YIN pitch detection (de Cheveigné & Kawahara, 2002) — from
 *  scratch, no libraries. Significantly more robust than plain
 *  autocorrelation: the cumulative-mean-normalized difference
 *  function suppresses octave errors, and the absolute-threshold
 *  step picks the FIRST dip instead of the tallest peak, which is
 *  what makes it stable on wind instruments.
 * ============================================================ */

const ABS_THRESHOLD = 0.12;

export function detectPitch(buf, sampleRate) {
  const N = buf.length;

  /* RMS gate: silence = no pitch */
  let rms = 0;
  for (let i = 0; i < N; i++) rms += buf[i] * buf[i];
  rms = Math.sqrt(rms / N);
  if (rms < 0.008) return { freq: -1, clarity: 0, rms };

  const W = Math.floor(N / 2); // integration window
  const maxLag = Math.min(W, Math.floor(sampleRate / 70)); // down to ~70 Hz
  const minLag = Math.max(2, Math.floor(sampleRate / 1800)); // up to ~1.8 kHz

  /* step 1: squared difference function d(tau) */
  const d = new Float32Array(maxLag + 1);
  for (let tau = 0; tau <= maxLag; tau++) {
    let sum = 0;
    for (let j = 0; j < W; j++) {
      const diff = buf[j] - buf[j + tau];
      sum += diff * diff;
    }
    d[tau] = sum;
  }

  /* step 2: cumulative mean normalized difference d'(tau) */
  const dn = new Float32Array(maxLag + 1);
  dn[0] = 1;
  let running = 0;
  for (let tau = 1; tau <= maxLag; tau++) {
    running += d[tau];
    dn[tau] = d[tau] * tau / (running || 1);
  }

  /* step 3: absolute threshold — first tau where d' dips below the
     threshold, then the local minimum around it */
  let tauEst = -1;
  for (let tau = minLag; tau <= maxLag; tau++) {
    if (dn[tau] < ABS_THRESHOLD) {
      while (tau + 1 <= maxLag && dn[tau + 1] < dn[tau]) tau++;
      tauEst = tau;
      break;
    }
  }
  /* fallback: global minimum if nothing crossed the threshold */
  if (tauEst === -1) {
    let minVal = Infinity, minPos = -1;
    for (let tau = minLag; tau <= maxLag; tau++) {
      if (dn[tau] < minVal) { minVal = dn[tau]; minPos = tau; }
    }
    if (minVal > 0.9) return { freq: -1, clarity: 1 - Math.min(1, minVal), rms };
    tauEst = minPos;
  }

  /* step 4: parabolic interpolation around the dip */
  const x0 = dn[Math.max(tauEst - 1, 0)];
  const x1 = dn[tauEst];
  const x2 = dn[Math.min(tauEst + 1, maxLag)];
  let better = tauEst;
  const denom = 2 * (2 * x1 - x0 - x2);
  if (denom !== 0) better = tauEst + (x2 - x0) / denom;

  const freq = sampleRate / better;
  const clarity = 1 - Math.min(1, dn[tauEst]); // 1 = perfectly periodic
  if (freq < 60 || freq > 1800) return { freq: -1, clarity, rms };
  return { freq, clarity, rms };
}
