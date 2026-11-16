/* ============================================================
 *  Train the intonation-bias model — rigorous run.
 *  Same hand-written autograd engine (Value/MLP). Improvements
 *  over v1:
 *    - 10 player archetypes (seeded, reproducible)
 *    - 900 samples · 85/15 train/validation split
 *    - model selection: 3 architectures compared on VALIDATION
 *      MAE (the winner ships, not the lowest training loss)
 *    - full training report saved alongside the weights
 * ============================================================ */
import fs from "node:fs";
import { MLP } from "./nn.mjs";

/* seeded RNG so the run is reproducible */
let seed = 20261116;
const rand = () => {
  seed = (seed * 1664525 + 1013904223) % 4294967296;
  return seed / 4294967296;
};
const randN = () => (rand() + rand() + rand()) / 1.5 - 1; // approx gaussian

/* ---- 10 archetypes sampled from realistic parameter ranges ---- */
const ARCHETYPES = Array.from({ length: 10 }, () => ({
  sharpHigh: 0.6 + rand() * 0.9,   // 0.6–1.5
  flatLow: 0.6 + rand() * 0.9,
  breakFlat: 0.6 + rand() * 0.8,   // 0.6–1.4
  wobble: 0.3 + rand() * 1.5,      // 0.3–1.8
}));

function trueBiasCents(midi, arch) {
  const x = (midi - 57) / 13;
  let b = 0;
  b += arch.sharpHigh * Math.max(0, x) ** 1.6 * 22;
  b += arch.flatLow * Math.max(0, -x) ** 1.4 * -16;
  const breakDepth = (midi - 61.5) / 1.4;
  b += -arch.breakFlat * 26 * Math.exp(-(breakDepth ** 2));
  b += arch.wobble * 6 * Math.sin(midi * 1.7);
  return b;
}

/* ---- dataset: 900 samples over midi 45..80 (25 per note) ---- */
const NOTES = [];
for (let m = 45; m <= 84; m++) NOTES.push(m);
const all = [];
NOTES.forEach((midi, ni) => {
  for (let k = 0; k < 25; k++) {
    const arch = ARCHETYPES[(ni * 7 + k) % ARCHETYPES.length];
    const bias = trueBiasCents(midi, arch) + randN() * 5;
    const breakFeat = Math.exp(-(((midi - 61.5) / 1.4) ** 2));
    all.push({ x: [(midi - 57) / 13, breakFeat], y: bias / 60, midi }); // ÷60: tanh-safe targets
  }
});

/* ---- 85/15 split, stratified per note (keeps every note in both sets) ---- */
const train = [], val = [];
NOTES.forEach((midi, ni) => {
  const rows = all.filter((r) => r.midi === midi);
  rows.forEach((r, k) => (k < 21 ? train : val).push(r));
});

const SCALE = 60; // × 60 at inference

/* ---- architectures to compare ---- */
const CONFIGS = [
  { name: "2-8-8-1", hidden: [8, 8], lr: 0.02, epochs: 600 },
  { name: "2-12-8-1", hidden: [12, 8], lr: 0.02, epochs: 600 },
  { name: "2-16-12-1", hidden: [16, 12], lr: 0.015, epochs: 800 },
];

function fit(config) {
  const net = new MLP(2, config.hidden);
  const losses = [];
  for (let epoch = 0; epoch < config.epochs; epoch++) {
    const order = train.map((_, i) => i).sort(() => rand() - 0.5);
    let total = 0, count = 0;
    for (let b = 0; b < order.length; b += 32) {
      const batch = order.slice(b, b + 32).map((i) => train[i]);
      const { loss } = net.step(batch, config.lr, 0.0005);
      total += loss * batch.length; count += batch.length;
    }
    losses.push(+((total / count) * SCALE).toFixed(2)); // report in cents
  }
  const valMAE = statistics(val.map((r) => Math.abs(net.forward(r.x).data * SCALE - r.y * SCALE)));
  const trainMAE = statistics(train.map((r) => Math.abs(net.forward(r.x).data * SCALE - r.y * SCALE)));
  return { net, name: config.name, losses, trainMAE, valMAE };
}

function statistics(arr) { return arr.reduce((a, b) => a + b, 0) / arr.length; }

/* ---- compare, pick the winner on validation ---- */
const runs = CONFIGS.map(fit);
for (const r of runs) console.log(`${r.name}: train ${r.trainMAE.toFixed(1)}¢ · val ${r.valMAE.toFixed(1)}¢`);
const best = runs.reduce((a, b) => (a.valMAE <= b.valMAE ? a : b));
console.log(`winner: ${best.name} (val MAE ${best.valMAE.toFixed(1)}¢)`);

/* ---- curve spot-check for the winner (textbook archetype) ---- */
const ARCH0 = { sharpHigh: 1.0, flatLow: 1.0, breakFlat: 1.0, wobble: 1.0 };
const spot = [45, 53, 61, 62, 69, 76, 80].map((m) => {
  const bf = Math.exp(-(((m - 61.5) / 1.4) ** 2));
  return {
    midi: m,
    predicted: +(best.net.forward([(m - 57) / 13, bf]).data * SCALE).toFixed(1),
    truth: +trueBiasCents(m, ARCH0).toFixed(1),
  };
});
spot.forEach((s) => console.log(`  midi ${s.midi}: ${s.predicted}¢ | truth ${s.truth}¢`));

/* ---- ship the winner ---- */
const weights = best.net.layers.map((l) => l.neurons.map((n) => ({
  w: n.w.map((p) => +p.data.toFixed(4)),
  b: +n.b.data.toFixed(4),
})));

const out = {
  meta: {
    name: "sax-intonation-bias-v2",
    trainedWith: "hand-written autograd engine (autograd-lab Value/MLP)",
    data: "900 synthetic saxophone intonation samples · 10 archetypes · 85/15 split",
    input: "[(midi - 57) / 13, breakProximity] — position + C#4–D4 break feature",
    output: "expected pitch bias / 60 (multiply by 60 for cents)",
    architecture: best.name,
    selected: "lowest validation MAE among 3 architectures",
    trainMAE: +best.trainMAE.toFixed(2),
    valMAE: +best.valMAE.toFixed(2),
    lossHistory: best.losses,
  },
  layers: weights,
};

fs.writeFileSync(new URL("../src/biasModel.json", import.meta.url), JSON.stringify(out, null, 2));
fs.writeFileSync(new URL("./run_report.json", import.meta.url), JSON.stringify({
  when: new Date().toISOString(),
  runs: runs.map((r) => ({ name: r.name, trainMAE: +r.trainMAE.toFixed(2), valMAE: +r.valMAE.toFixed(2) })),
  winner: best.name,
  spot,
}, null, 2));
console.log("weights + run report written");
