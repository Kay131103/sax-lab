import fs from "node:fs";
import { MLP } from "./nn.mjs";

const model = JSON.parse(fs.readFileSync(new URL("../src/biasModel.json", import.meta.url)));
console.log("meta loss:", model.meta.finalLoss, "| arch:", model.meta.architecture);
console.log("weight counts:", model.layers.map((l) => l[0].w.length));

const net = new MLP(2, [8, 8]);
net.layers.forEach((l, li) => l.neurons.forEach((n, ni) => {
  const saved = model.layers[li][ni];
  n.w.forEach((p, pi) => (p.data = saved.w[pi]));
  n.b.data = saved.b;
}));

for (const m of [45, 61, 69, 80]) {
  const bf = Math.exp(-(((m - 61.5) / 1.4) ** 2));
  const out = net.forward([(m - 57) / 13, bf]);
  console.log(`forward(${m}):`, out.data, "×60 =", (out.data * 60).toFixed(1));
}
const maxW = Math.max(...net.parameters().map((p) => Math.abs(p.data)));
console.log("max |w|:", maxW);
