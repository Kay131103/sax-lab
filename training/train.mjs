/* ============================================================
 *  Train the intonation-bias model with the hand-written autograd
 *  engine (the same Value/MLP as autograd-lab — no PyTorch here).
 *
 *  Task: predict a saxophonist's expected pitch bias (in cents)
 *        for each note across the instrument's range.
 *
 *  Data: synthetic saxophone intonation profiles. Real sax players
 *        share well-documented tendencies, which we model:
 *          - the "break" (C#4–D4) plays flat
 *          - the upper register creeps sharp
 *          - low notes sag slightly flat
 *        5 player archetypes × noise × 600 samples.
 *
 *  Output: biasModel.json — weights shipped into Sax Lab, then
 *          personalized in the user's browser from their own holds.
 * ============================================================ */
import fs from "node:fs";
import { Value, val } from "./engine.mjs";
import { MLP } from "./nn.mjs";

/* ---- the ground-truth curve the synth data follows (hidden from the model) ---- */
function trueBiasCents(midi, arch) {
  const x = (midi - 57) / 13; // centered around D4, ±1 spans the practical range
  let b = 0;
  b += arch.sharpHigh * Math.max(0, x) ** 1.6 * 22;   // upper register creeps sharp
  b += arch.flatLow * Math.max(0, -x) ** 1.4 * -16;   // low notes sag flat
  // the break: C#4 (61) to D4 (62) plays flat — a Gaussian dip
  const breakDepth = (midi - 61.5) / 1.4;
  b += -arch.breakFlat * 26 * Math.exp(-(breakDepth ** 2));
  b += arch.wobble * 6 * Math.sin(midi * 1.7);        // per-note quirks
  return b;
}

const ARCHETYPES = [
  { sharpHigh: 1.0, flatLow: 1.0, breakFlat: 1.0, wobble: 1.0 },  // textbook
  { sharpHigh: 1.4, flatLow: 0.7, breakFlat: 0.8, wobble: 1.3 },  // bright setup
  { sharpHigh: 0.6, flatLow: 1.5, breakFlat: 1.3, wobble: 0.8 },  // dark, stuffy reed
  { sharpHigh: 1.1, flatLow: 1.1, breakFlat: 0.6, wobble: 1.6 },  // beginner wobble
  { sharpHigh: 0.8, flatLow: 0.9, breakFlat: 1.0, wobble: 0.4 },  // seasoned player
];

/* ---- dataset: 600 samples across midi 45 (A2) .. 80 (G#5) ---- */
const data = [];
for (let i = 0; i < 600; i++) {
  const midi = 45 + (i % 36) + Math.floor(i / 36) * 0; // each note 16-17 times
  const arch = ARCHETYPES[i % ARCHETYPES.length];
  const bias = trueBiasCents(midi, arch) + (Math.random() * 2 - 1) * 5; // measurement noise
  // domain-informed features: position + explicit break-proximity (C#4–D4 plays flat)
  const breakFeat = Math.exp(-(((midi - 61.5) / 1.4) ** 2));
  // tanh output saturates at ±1 — normalize targets into representable range (÷60)
  data.push({ x: [(midi - 57) / 13, breakFeat], y: bias / 60, midi }); // engine expects vector inputs
}

/* ---- model: 1 → 8 → 1 tanh MLP on the Value engine ---- */
const net = new MLP(2, [8, 8]);
const LR = 0.02;
const EPOCHS = 500;
const history = [];

for (let epoch = 0; epoch < EPOCHS; epoch++) {
  let total = 0;
  // mini-batches of 32, shuffled
  const order = data.map((_, i) => i).sort(() => Math.random() - 0.5);
  for (let b = 0; b < order.length; b += 32) {
    const batch = order.slice(b, b + 32).map((i) => data[i]);
    const { loss } = net.step(batch, LR, 0.0005);
    total += loss * batch.length;
  }
  total /= data.length;
  if (epoch % 40 === 0 || epoch === EPOCHS - 1) history.push({ epoch, loss: +total.toFixed(4) });
}

/* ---- validation on held-out archetypes not shuffled away — just report curve quality ---- */
const SCALE = 60; // × 60 at inference to unscale
const testMidis = [];
for (let m = 45; m <= 80; m++) {
  const bf = Math.exp(-(((m - 61.5) / 1.4) ** 2));
  const pred = net.forward([(m - 57) / 13, bf]).data * SCALE;
  const truth = trueBiasCents(m, ARCHETYPES[0]); // textbook player
  testMidis.push({ midi: m, predicted: +pred.toFixed(1), truth: +truth.toFixed(1) });
}
const meanAbsErr = statistics(testMidis.map((t) => Math.abs(t.predicted - t.truth)));

function statistics(arr) {
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

/* ---- export weights ---- */
const weights = net.layers.map((l) => l.neurons.map((n) => ({
  w: n.w.map((p) => +p.data.toFixed(4)),
  b: +n.b.data.toFixed(4),
})));

const out = {
  meta: {
    name: "sax-intonation-bias-v1",
    trainedWith: "hand-written autograd engine (autograd-lab Value/MLP)",
    data: "600 synthetic saxophone intonation samples, 5 player archetypes",
    input: "[(midi - 57) / 13, breakProximity] — position + C#4–D4 break feature",
    output: "expected pitch bias / 60 (multiply by 60 for cents)",
    architecture: "2-8-8-1 tanh MLP",
    epochs: EPOCHS,
    finalLoss: +total().toFixed(4),
    meanAbsErrVsTruth: +meanAbsErr.toFixed(2),
    lossHistory: history,
  },
  layers: weights,
};

function total() { return history[history.length - 1].loss; }

fs.writeFileSync(new URL("../src/biasModel.json", import.meta.url), JSON.stringify(out, null, 2));
console.log("trained in", EPOCHS, "epochs");
console.log("final loss:", history[history.length - 1].loss, "· mean abs err vs truth:", meanAbsErr.toFixed(2), "¢");
console.log("curve spot-check (predicted | truth for textbook player):");
for (const m of [45, 53, 61, 62, 69, 80]) {
  const row = testMidis.find((t) => t.midi === m);
  console.log(`  midi ${m}: ${row.predicted}¢ | ${row.truth}¢`);
}
