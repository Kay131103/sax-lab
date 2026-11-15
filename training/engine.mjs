/* ============================================================
 *  Value — reverse-mode automatic differentiation, from scratch.
 *
 *  Every scalar in the network is a Value. Arithmetic operations
 *  build a computation graph; calling .backward() walks it in
 *  reverse topological order and applies the chain rule:
 *
 *      d L / d a  =  (d L / d out) * (d out / d a)
 *
 *  No libraries. No frameworks. ~120 lines.
 * ============================================================ */

export class Value {
  constructor(data, { _prev = [], _op = "", label = "" } = {}) {
    this.data = data;          // the scalar itself
    this.grad = 0;             // dL/d(self), filled by backward()
    this._backward = () => {}; // closure that propagates grad to _prev
    this._prev = _prev;        // parent nodes (children in the graph)
    this._op = _op;            // the operation that produced this node
    this.label = label;
  }

  /* --- arithmetic ------------------------------------------------ */
  add(other) {
    const out = new Value(this.data + other.data, { _prev: [this, other], _op: "+" });
    out._backward = () => {
      // d(a+b)/da = 1, d(a+b)/db = 1 — pass the upstream grad straight through
      this.grad += out.grad;
      other.grad += out.grad;
    };
    return out;
  }

  mul(other) {
    const out = new Value(this.data * other.data, { _prev: [this, other], _op: "*" });
    out._backward = () => {
      // d(ab)/da = b, d(ab)/db = a
      this.grad += other.data * out.grad;
      other.grad += this.data * out.grad;
    };
    return out;
  }

  sub(other) { return this.add(other.mul(new Value(-1))); }
  div(other) { return this.mul(other.pow(-1)); }
  neg() { return this.mul(new Value(-1)); }

  pow(k) {
    const out = new Value(this.data ** k, { _prev: [this], _op: `**${k}` });
    out._backward = () => {
      // d(a^k)/da = k * a^(k-1)
      this.grad += k * this.data ** (k - 1) * out.grad;
    };
    return out;
  }

  exp() {
    const out = new Value(Math.exp(this.data), { _prev: [this], _op: "exp" });
    out._backward = () => {
      // d(e^x)/dx = e^x
      this.grad += out.data * out.grad;
    };
    return out;
  }

  log() {
    const out = new Value(Math.log(this.data), { _prev: [this], _op: "log" });
    out._backward = () => { this.grad += (1 / this.data) * out.grad; };
    return out;
  }

  tanh() {
    const out = new Value(Math.tanh(this.data), { _prev: [this], _op: "tanh" });
    out._backward = () => {
      // d(tanh x)/dx = 1 - tanh^2 x
      this.grad += (1 - out.data ** 2) * out.grad;
    };
    return out;
  }

  relu() {
    const out = new Value(this.data > 0 ? this.data : 0, { _prev: [this], _op: "relu" });
    out._backward = () => { if (this.data > 0) this.grad += out.grad; };
    return out;
  }

  /* --- backward pass --------------------------------------------- */
  backward() {
    // 1. topological order (children before parents)
    const topo = [];
    const visited = new Set();
    const build = (v) => {
      if (visited.has(v)) return;
      visited.add(v);
      for (const child of v._prev) build(child);
      topo.push(v);
    };
    build(this);

    // 2. seed the output node: dL/dL = 1
    this.grad = 1;
    // 3. walk the graph in reverse, applying each node's chain rule
    for (let i = topo.length - 1; i >= 0; i--) topo[i]._backward();
  }

  zeroGrad() { this.grad = 0; }
}

/* convenience: mix numbers and Values */
export const val = (x) => (x instanceof Value ? x : new Value(x));
export const add = (a, b) => val(a).add(val(b));
export const mul = (a, b) => val(a).mul(val(b));
