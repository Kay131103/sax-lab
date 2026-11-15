import { autoCorrelate } from "./pitch.js";
import { analyze, noteName, midiToFreq, freqToMidi } from "./notes.js";

const $ = (id) => document.getElementById(id);

/* ---------------- state ---------------- */
let audioCtx = null;
let analyser = null;
let sourceNode = null;
let demoOsc = null, demoGain = null, demoLfo = null;
let running = false;
let mode = "tuner";

let freqSmoothed = 0;
let trail = [];            // {t, fineMidi} — the pitch line
const TRAIL_WINDOW = 8;    // seconds visible

let hold = null;           // {midi, startT, cents[]} — long-tone hold
let holdHistory = [];

/* ---------------- audio setup ---------------- */
async function enableMic() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
    stopSource();
    audioCtx = audioCtx || new AudioContext();
    sourceNode = audioCtx.createMediaStreamSource(stream);
    sourceNode.connect(analyserNode());
    running = true;
    $("micBtn").textContent = "🎤 mic live";
    $("micBtn").classList.add("on");
    $("demoBtn").classList.remove("on");
    $("demoBtn").textContent = "🔊 play test tone (A4)";
    stopDemo();
  } catch (err) {
    $("micBtn").textContent = "🎤 mic blocked — try the test tone";
  }
}

function analyserNode() {
  if (!analyser) {
    analyser = audioCtx.createAnalyser();
    analyser.fftSize = 2048;
  }
  return analyser;
}

/* demo tone: synthesized reed-ish sound with vibrato + slow drift */
function startDemo() {
  stopSource();
  audioCtx = audioCtx || new AudioContext();
  audioCtx.resume();
  const analyser = analyserNode();
  demoOsc = audioCtx.createOscillator();
  demoOsc.type = "sawtooth";
  demoGain = audioCtx.createGain();
  demoGain.gain.value = 0.12;
  demoOsc.frequency.value = midiToFreq(+$("demoNote").value);

  // vibrato: ±6 cents LFO on frequency
  demoLfo = audioCtx.createOscillator();
  const lfoGain = audioCtx.createGain();
  demoLfo.frequency.value = 5.2; // Hz
  lfoGain.gain.value = demoOsc.frequency.value * 0.0035;
  demoLfo.connect(lfoGain).connect(demoOsc.frequency);

  // slow drift: another LFO, 0.1 Hz, ±10 cents
  const drift = audioCtx.createOscillator();
  const driftGain = audioCtx.createGain();
  drift.frequency.value = 0.1;
  driftGain.gain.value = demoOsc.frequency.value * 0.0058;
  drift.connect(driftGain).connect(demoOsc.frequency);

  // soften the sawtooth with a lowpass
  const lp = audioCtx.createBiquadFilter();
  lp.type = "lowpass";
  lp.frequency.value = 1200;

  demoOsc.connect(lp).connect(demoGain).connect(analyser);
  demoOsc.start(); demoLfo.start(); drift.start();
  sourceNode = "demo";
  running = true;
  $("demoBtn").textContent = "⏹ stop test tone";
  $("demoBtn").classList.add("on");
  $("micBtn").classList.remove("on");
  $("toneControls").style.display = "block";
}

function stopDemo() {
  try { demoOsc?.stop(); demoLfo?.stop(); } catch {}
  demoOsc = demoLfo = null;
  $("toneControls").style.display = "none";
}

function stopSource() {
  stopDemo();
  if (sourceNode && sourceNode !== "demo") { try { sourceNode.disconnect(); } catch {} }
  sourceNode = null;
}

/* ---------------- analysis loop ---------------- */
const buf = new Float32Array(2048);
let lastDraw = 0;

function loop() {
  if (!running || !analyser) return;
  analyser.getFloatTimeDomainData(buf);
  const r = autoCorrelate(buf, audioCtx.sampleRate);
  const now = performance.now() / 1000;

  if (r.freq > 0) {
    const info = analyze(r.freq);
    freqSmoothed = freqSmoothed ? freqSmoothed * 0.6 + r.freq * 0.4 : r.freq;
    trail.push({ t: now, fineMidi: freqToMidi(r.freq) });
    while (trail.length && trail[0].t < now - TRAIL_WINDOW) trail.shift();

    // readouts
    $("noteDisplay").textContent = info.note;
    const cents = info.cents;
    const cd = $("centsDisplay");
    cd.textContent = `${cents > 0 ? "+" : ""}${cents} cents ${Math.abs(cents) < 8 ? "✓ in tune" : cents > 0 ? "sharp" : "flat"}`;
    cd.style.color = Math.abs(cents) < 8 ? "var(--sage)" : Math.abs(cents) < 25 ? "var(--butter-dark)" : "var(--coral)";
    $("needle").style.left = `${50 + Math.max(-50, Math.min(50, cents))}%`;
    $("freqVal").textContent = r.freq.toFixed(1);
    $("clarityVal").textContent = r.clarity.toFixed(2);

    if (mode === "tones") trackHold(info, now);
  } else if (mode === "tones") {
    endHold(now); // silence ends the hold
  }
  drawStave(now);
}

/* ---------------- long-tone tracking ---------------- */
function trackHold(info, now) {
  if (!hold) {
    hold = { midi: info.midi, startT: now, cents: [info.cents], lastT: now };
  } else if (Math.abs(info.midi - hold.midi) <= 0.5) {
    hold.cents.push(info.cents);
    hold.lastT = now;
    updateHoldStats(hold);
  } else if (now - hold.lastT > 0.25) {
    finishHold();
    hold = { midi: info.midi, startT: now, cents: [info.cents], lastT: now };
  }
}

function updateHoldStats(h) {
  const dur = h.lastT - h.startT;
  $("holdDur").textContent = dur.toFixed(1) + "s";
  if (h.cents.length > 3) {
    const sorted = [...h.cents].sort((a, b) => a - b);
    const med = sorted[Math.floor(sorted.length / 2)];
    const centered = h.cents.map((c) => c - med);
    const sd = Math.sqrt(centered.reduce((s, c) => s + c * c, 0) / centered.length);
    $("holdDrift").textContent = (med > 0 ? "+" : "") + med.toFixed(0) + "¢";
    $("holdStab").textContent = sd.toFixed(0) + "¢";
  }
}

function finishHold() {
  if (!hold) return;
  const dur = hold.lastT - hold.startT;
  if (dur < 1.2 || hold.cents.length < 8) { hold = null; return; }
  const sorted = [...hold.cents].sort((a, b) => a - b);
  const med = sorted[Math.floor(sorted.length / 2)];
  const centered = hold.cents.map((c) => c - med);
  const sd = Math.sqrt(centered.reduce((s, c) => s + c * c, 0) / centered.length);
  const avgAbs = centered.reduce((s, c) => s + Math.abs(c), 0) / centered.length;
  let grade, cls;
  if (dur >= 5 && Math.abs(med) < 10 && sd < 20) { grade = "GOLD 🥇"; cls = "gold"; }
  else if (dur >= 3 && Math.abs(med) < 20 && sd < 35) { grade = "SILVER 🥈"; cls = "silver"; }
  else if (dur >= 2) { grade = "BRONZE 🥉"; cls = "bronze"; }
  else { grade = "TRY AGAIN"; cls = "try"; }
  $("holdGrade").textContent = grade;
  const row = document.createElement("div");
  row.className = "hold";
  row.innerHTML = `<span>${noteName(hold.midi)} · ${dur.toFixed(1)}s · drift ${med > 0 ? "+" : ""}${med.toFixed(0)}¢ · σ ${sd.toFixed(0)}¢ · avg|¢| ${avgAbs.toFixed(0)}</span><span class="grade ${cls}">${grade}</span>`;
  const list = $("holdList");
  list.prepend(row);
  while (list.children.length > 6) list.lastChild.remove();
  hold = null;
}

const endHold = (now) => { if (hold && now - (hold.lastT || hold.startT) > 0.25) finishHold(); };

/* ---------------- stave drawing ---------------- */
const stave = $("stave");
const sctx = stave.getContext("2d");

function drawStave(now) {
  if (now - lastDraw < 1 / 30) return;
  lastDraw = now;
  const dpr = window.devicePixelRatio || 1;
  const w = stave.clientWidth;
  const h = +stave.getAttribute("height");
  stave.width = w * dpr; stave.height = h * dpr;
  sctx.scale(dpr, dpr);
  sctx.clearRect(0, 0, w, h);

  // vertical center: the note currently (or last) played
  const center = trail.length ? Math.round(trail[trail.length - 1].fineMidi) : 57;
  const RANGE = 6; // semitones visible above/below center
  const midiToY = (m) => h / 2 - (m - center) * (h / (RANGE * 2 + 1));

  // note lanes
  for (let m = center - RANGE; m <= center + RANGE; m++) {
    const y = midiToY(m);
    const isC = noteName(m).startsWith("C");
    sctx.fillStyle = isC ? "var(--sand-soft)" : "#f7f2ea";
    sctx.strokeStyle = "#d8d2c8";
    sctx.lineWidth = 1;
    sctx.fillRect(70, y - (h / (RANGE * 2 + 1)) / 2 + 1, w - 74, h / (RANGE * 2 + 1) - 2);
    sctx.strokeRect(70, y - (h / (RANGE * 2 + 1)) / 2 + 1, w - 74, h / (RANGE * 2 + 1) - 2);
    sctx.fillStyle = "#8a8a8a";
    sctx.font = "11px 'JetBrains Mono'";
    sctx.fillText(noteName(m), 12, y + 4);
  }

  // nearest-note lane highlight (butter)
  if (trail.length) {
    const m = Math.round(trail[trail.length - 1].fineMidi);
    const y = midiToY(m);
    sctx.fillStyle = "rgba(250,204,21,0.25)";
    sctx.fillRect(70, y - (h / (RANGE * 2 + 1)) / 2, w - 74, h / (RANGE * 2 + 1));
  }

  // the pitch trail
  if (trail.length > 1) {
    sctx.lineWidth = 3;
    sctx.lineCap = "round";
    sctx.strokeStyle = "#2563eb";
    sctx.beginPath();
    let pen = false;
    for (let i = 0; i < trail.length; i++) {
      const p = trail[i];
      const x = w - ((now - p.t) / TRAIL_WINDOW) * (w - 70) - 4;
      if (x < 74) break;
      const y = midiToY(p.fineMidi);
      if (!pen) { sctx.moveTo(x, y); pen = true; } else sctx.lineTo(x, y);
    }
    sctx.stroke();
    // head dot
    const last = trail[trail.length - 1];
    const hx = w - 4, hy = midiToY(last.fineMidi);
    sctx.beginPath(); sctx.arc(hx, hy, 5, 0, Math.PI * 2);
    sctx.fillStyle = "#2563eb"; sctx.fill();
    sctx.strokeStyle = "#fff"; sctx.lineWidth = 1.5; sctx.stroke();
  }

  // frame
  sctx.strokeStyle = "#1a1a1a"; sctx.lineWidth = 2;
  sctx.strokeRect(1, 1, w - 2, h - 2);
}

/* ---------------- wiring ---------------- */
let loopId = null;
function startLoop() {
  if (loopId) return;
  loopId = setInterval(() => loop(), 16);
}

$("micBtn").addEventListener("click", () => { enableMic(); startLoop(); });
$("demoBtn").addEventListener("click", () => {
  if ($("demoBtn").textContent.includes("stop")) { stopSource(); running = false; $("demoBtn").textContent = "🔊 play test tone (A4)"; $("demoBtn").classList.remove("on"); }
  else { startDemo(); startLoop(); }
});
$("demoNote").addEventListener("input", (e) => {
  const midi = +e.target.value;
  const f = midiToFreq(midi);
  if (demoOsc) demoOsc.frequency.value = f;
  if (demoLfo) demoLfo.frequency.value = 5.2;
  $("demoNoteLabel").textContent = `${noteName(midi)} · ${f.toFixed(0)} Hz — vibrato + drift included`;
});
$("modeTuner").addEventListener("click", () => {
  mode = "tuner";
  $("modeTuner").classList.add("active"); $("modeTones").classList.remove("active");
  $("tonesPanel").style.display = "none";
  endHold(performance.now() / 1000);
});
$("modeTones").addEventListener("click", () => {
  mode = "tones";
  $("modeTones").classList.add("active"); $("modeTuner").classList.remove("active");
  $("tonesPanel").style.display = "block";
});

window.addEventListener("resize", () => drawStave(performance.now() / 1000));
startLoop();
