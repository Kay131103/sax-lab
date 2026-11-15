import { Value, val } from "./engine.mjs";

/* ============================================================
 *  A neural net built entirely on top of the Value autodiff engine.
 *  Neuron → Layer → MLP. Weights/biases are Values, so the whole
 *  network is one big computation graph and MLP.loss().backward()
 *  differentiates the entire thing.
 * ============================================================ */

export class Neuron {
  constructor(nin, label = "") {
    this.w = Array.from({ length: nin }, (_, i) =>
      new Value(Math.random() * 2 - 1, { label: `${label}w${i}` }));
    this.b = new Value(Math.random() * 2 - 1, { label: `${label}b` });
  }

  /* tanh activation (classic micrograd choice — smooth, keeps numbers tame) */
  forward(x) {
    const act = this.w.reduce((acc, wi, i) => acc.add(wi.mul(val(x[i]))), this.b);
    return act.tanh();
  }
}

export class Layer {
  constructor(nin, nout, label = "") {
    this.neurons = Array.from({ length: nout }, (_, i) => new Neuron(nin, `${label}n${i}.`));
  }
  forward(x) { return this.neurons.map((n) => n.forward(x)); }
}

export class MLP {
  constructor(nin, hidden, label = "") {
    const sizes = [nin, ...hidden, 1];
    this.layers = [];
    for (let i = 0; i < sizes.length - 1; i++) {
      this.layers.push(new Layer(sizes[i], sizes[i + 1], `L${i}.`));
    }
  }

  forward(x) {
    let out = x;
    for (const layer of this.layers) out = layer.forward(out);
    return out[0]; // single output for binary classification
  }

  parameters() {
    return this.layers.flatMap((l) => l.neurons.flatMap((n) => [...n.w, n.b]));
  }

  zeroGrad() {
    for (const p of this.parameters()) p.grad = 0;
  }

  /* MSE loss over a batch: mean((pred - target)^2) */
  loss(batch) {
    const losses = batch.map(({ x, y }) => this.forward(x).sub(val(y)).pow(2));
    let sum = losses[0];
    for (let i = 1; i < losses.length; i++) sum = sum.add(losses[i]);
    return sum.div(val(losses.length));
  }

  accuracy(batch) {
    let correct = 0;
    for (const { x, y } of batch) {
      const pred = this.forward(x).data >= 0 ? 1 : -1;
      if (pred === y) correct++;
    }
    return correct / batch.length;
  }

  /* one SGD step: forward → backward → update */
  step(batch, lr, l2 = 0) {
    const loss = this.loss(batch);
    this.zeroGrad();
    loss.backward();
    for (const p of this.parameters()) {
      p.data -= lr * (p.grad + l2 * p.data); // gradient + L2 regularisation
    }
    return { loss: loss.data, gradNorm: Math.sqrt(this.parameters().reduce((s, p) => s + p.grad ** 2, 0)) };
  }
}
