import { Layer, MLP } from "./nn.mjs";
import { Value, val } from "./engine.mjs";

const orig = Layer.prototype.forward;
Layer.prototype.forward = function (x) {
  if (x.some((v) => v === undefined || Number.isNaN(v)))
    console.log("BAD INPUT: nin =", this.neurons[0].w.length, "| x =", JSON.stringify(x));
  return orig.call(this, x);
};

const net = new MLP(1, [8]);
console.log("layer sizes:", net.layers.map((l) => l.neurons.length));
console.log("layer weight counts:", net.layers.map((l) => l.neurons[0].w.length));
const loss = net.loss([{ x: 0.5, y: 0.3 }]);
console.log("loss:", loss.data);
