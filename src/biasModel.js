/* ============================================================
 *  The trained intonation-bias model — running on-device.
 *
 *  Warm-started: weights trained OFFLINE with the hand-written
 *  autograd engine (training/train.mjs) on 600 synthetic
 *  saxophone intonation profiles (5 player archetypes).
 *
 *  Personalized: after every graded hold, one SGD step pulls the
 *  model toward YOUR observed drift — the tutor learns your
 *  intonation fingerprint. Weights persist in localStorage;
 *  nothing leaves the browser.
 * ============================================================ */
import baseWeights from "./biasModel.json";

const LS_KEY = "saxlab:biasmodel";
const L = (() => {
  try { return JSON.parse(localStorage.getItem(LS_KEY)) || baseWeights.layers; }
  catch { return baseWeights.layers; }
})();
export const samplesUsed = () => updateCount;
let updateCount = (() => { try { return JSON.parse(localStorage.getItem(LS_KEY + ":n")) || 0; } catch { return 0; } })();

const persist = () => {
  try { localStorage.setItem(LS_KEY, JSON.stringify(L)); localStorage.setItem(LS_KEY + ":n", JSON.stringify(updateCount)); } catch {}
};

const forward = (x) => {
  const acts = [x];
  for (const layer of L) {
    acts.push(layer.map((n) => Math.tanh(n.w.reduce((s, w, i) => s + w * acts[acts.length - 1][i], n.b))));
  }
  return acts;
};

export function predictBias(midi) {
  const bf = Math.exp(-(((midi - 61.5) / 1.4) ** 2)); // C#4–D4 break feature
  const acts = forward([(midi - 57) / 13, bf]);
  return acts[acts.length - 1][0] * 60; // unscale → cents
}

/* one SGD step toward the player's observed drift (single-sample backprop) */
export function updateOnline(midi, observedCents, lr = 0.03) {
  const bf = Math.exp(-(((midi - 61.5) / 1.4) ** 2));
  const x = [(midi - 57) / 13, bf];
  const y = Math.max(-0.9, Math.min(0.9, observedCents / 60)); // normalized target

  const acts = [x];
  for (const layer of L) {
    acts.push(layer.map((n) => Math.tanh(n.w.reduce((s, w, i) => s + w * acts[acts.length - 1][i], n.b))));
  }
  const pred = acts[acts.length - 1][0];
  const predictedBefore = pred * 60;

  let grad = [2 * (pred - y)];
  for (let li = L.length - 1; li >= 0; li--) {
    const input = acts[li];
    const next = new Array(input.length).fill(0);
    L[li].forEach((n, ni) => {
      const dTan = 1 - acts[li + 1][ni] ** 2;
      const dAct = grad[ni] * dTan;
      n.w.forEach((w, pi) => {
        next[pi] += dAct * w;
        L[li][ni].w[pi] -= lr * dAct * input[pi];
      });
      L[li][ni].b -= lr * dAct;
    });
    grad = next;
  }
  updateCount++;
  persist();
  return predictedBefore;
}

export const modelMeta = baseWeights.meta;
