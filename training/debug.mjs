import { MLP } from "./nn.mjs";
import { Value, val } from "./engine.mjs";

const net = new MLP(1, [8]);
const pred = net.forward([0.5]);
console.log("pred:", pred.data, "| label:", pred.label, "| op:", pred._op, "| prev:", pred._prev.length);

const diff = pred.sub(val(0.3));
console.log("diff:", diff.data, "| op:", diff._op, "| prev:", diff._prev.map((p) => p.data));

const sq = diff.pow(2);
console.log("sq:", sq.data, "| op:", sq._op);

const loss = net.loss([{ x: 0.5, y: 0.3 }]);
console.log("net.loss:", loss.data, "| op:", loss._op, "| prev count:", loss._prev.length);

// walk the loss graph and find the first NaN node
const seen = new Set();
const walk = (v, depth) => {
  if (seen.has(v) || depth > 12) return;
  seen.add(v);
  if (!isFinite(v.data)) console.log("  NaN node: op =", v._op, "| label =", v.label, "| data =", v.data, "| prevs =", v._prev.map((p) => `${p._op}:${p.data}`));
  v._prev.forEach((p) => walk(p, depth + 1));
};
walk(loss, 0);
