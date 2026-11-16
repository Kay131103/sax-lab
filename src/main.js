import { autoCorrelate } from "./pitch.js";
import { analyze, noteName, midiToFreq, freqToMidi } from "./notes.js";
import { SCALES, sargamSequence } from "./scales.js";
import { predictBias, updateOnline, modelMeta, samplesUsed } from "./biasModel.js";

const $ = (id) => document.getElementById(id);

/* ---------------- state ---------------- */
let audioCtx = null;
let analyser = null;
let sourceNode = null;
let demoOsc = null, demoGain = null, demoLfo = null;
let running = false;
let mode = "tuner";

/* ---------------- sargam engine ---------------- */
const sg = { active: false, sa: 58, scale: "mayamalavagowla", seq: [], idx: 0, holdFrames: 0, noteCents: [], results: [] };

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
  demoOsc.frequency.value = midiToFreq(+$("demoNote").value - transpose);

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
    if (mode === "sargam") sargamTick(info, now);
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
  const modelSaid = predictBias(hold.midi);   // what the trained model expects from you here
  updateOnline(hold.midi, med);               // one SGD step toward your reality
  let grade, cls;
  if (dur >= 5 && Math.abs(med) < 10 && sd < 20) { grade = "GOLD 🥇"; cls = "gold"; }
  else if (dur >= 3 && Math.abs(med) < 20 && sd < 35) { grade = "SILVER 🥈"; cls = "silver"; }
  else if (dur >= 2) { grade = "BRONZE 🥉"; cls = "bronze"; }
  else { grade = "TRY AGAIN"; cls = "try"; }
  $("holdGrade").textContent = grade;
  recordFingerprintPoint(hold.midi, med);
  $("fpMeta").textContent = `warm-started on 600 synthetic saxophone profiles · personalized with ${samplesUsed()} of your holds · model expected ${modelSaid > 0 ? "+" : ""}${modelSaid.toFixed(0)}¢ here, you played ${med > 0 ? "+" : ""}${med.toFixed(0)}¢`;
  drawFingerprint();
  const row = document.createElement("div");
  row.className = "hold";
  row.innerHTML = `<span>${noteName(hold.midi)} · ${dur.toFixed(1)}s · drift ${med > 0 ? "+" : ""}${med.toFixed(0)}¢ · σ ${sd.toFixed(0)}¢ · avg|¢| ${avgAbs.toFixed(0)}</span><span class="grade ${cls}">${grade}</span>`;
  const list = $("holdList");
  list.prepend(row);
  while (list.children.length > 6) list.lastChild.remove();
  hold = null;
}

const endHold = (now) => { if (hold && now - (hold.lastT || hold.startT) > 0.25) finishHold(); };

/* ---------------- fingerprint drawing ---------------- */
const fp = $("fingerprint");
const fctx = fp.getContext("2d");

function drawFingerprint() {
  const dpr = window.devicePixelRatio || 1;
  const w = fp.clientWidth, h = +fp.getAttribute("height");
  fp.width = w * dpr; fp.height = h * dpr;
  fctx.scale(dpr, dpr);
  fctx.clearRect(0, 0, w, h);

  const midis = [];
  for (let m = 45; m <= 84; m++) midis.push(m);
  const preds = midis.map((m) => predictBias(m));
  const maxAbs = Math.max(25, ...preds.map((p) => Math.abs(p)));
  const toX = (m) => 40 + ((m - 45) / 39) * (w - 56);
  const toY = (c) => h / 2 - (c / maxAbs) * (h / 2 - 16);

  // zero line
  fctx.strokeStyle = "#d8d2c8"; fctx.lineWidth = 1;
  fctx.beginPath(); fctx.moveTo(40, h / 2); fctx.lineTo(w - 16, h / 2); fctx.stroke();
  // the learned curve
  fctx.beginPath();
  midis.forEach((m, i) => { const x = toX(m), y = toY(preds[i]); i === 0 ? fctx.moveTo(x, y) : fctx.lineTo(x, y); });
  fctx.strokeStyle = "#2563eb"; fctx.lineWidth = 2.4; fctx.stroke();
  // break zone (C#4–D4)
  fctx.fillStyle = "rgba(248,113,113,0.12)";
  fctx.fillRect(toX(61) - 6, 10, toX(63) - toX(61) + 12, h - 20);
  fctx.fillStyle = "#8a8a8a"; fctx.font = "10px 'JetBrains Mono'";
  fctx.fillText("the break →", toX(61), h - 8);
  // user's real data points (from holds this device has graded)
  const holdsSeen = JSON.parse(localStorage.getItem("saxlab:fingerprintPoints") || "[]");
  holdsSeen.forEach((p) => {
    fctx.beginPath(); fctx.arc(toX(p.midi), toY(Math.max(-maxAbs, Math.min(maxAbs, p.cents))), 4.5, 0, Math.PI * 2);
    fctx.fillStyle = "var(--coral)"; fctx.fillStyle = "#f87171";
    fctx.fill(); fctx.strokeStyle = "#1a1a1a"; fctx.lineWidth = 1.2; fctx.stroke();
  });
  // frame + labels
  fctx.strokeStyle = "#1a1a1a"; fctx.lineWidth = 2; fctx.strokeRect(1, 1, w - 2, h - 2);
  fctx.fillStyle = "#8a8a8a"; fctx.font = "10px 'JetBrains Mono'";
  fctx.fillText("A2", 40, h - 8); fctx.fillText("G#5", w - 34, h - 8);
}

function recordFingerprintPoint(midi, cents) {
  const pts = JSON.parse(localStorage.getItem("saxlab:fingerprintPoints") || "[]");
  pts.push({ midi, cents });
  while (pts.length > 60) pts.shift();
  localStorage.setItem("saxlab:fingerprintPoints", JSON.stringify(pts));
}

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

  // vertical center: expected note during sargam, else last played
  const center = (mode === "sargam" && sg.active && sg.seq.length)
    ? sg.sa + sg.seq[sg.idx].offset
    : (trail.length ? Math.round(trail[trail.length - 1].fineMidi) : 57);
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

  // lane highlight: expected note (sargam) else nearest note (butter)
  if (mode === "sargam" && sg.active && sg.seq.length) {
    const m = sg.sa + sg.seq[sg.idx].offset;
    const y = midiToY(m);
    sctx.fillStyle = "rgba(37,99,235,0.22)";
    sctx.fillRect(70, y - (h / (RANGE * 2 + 1)) / 2, w - 74, h / (RANGE * 2 + 1));
  } else if (trail.length) {
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

/* ---------------- sargam engine ---------------- */
function rebuildSargam() {
  sg.seq = sargamSequence(sg.scale, sg.sa);
  sg.idx = 0; sg.holdFrames = 0; sg.noteCents = []; sg.results = [];
  renderSargamChips();
  $("sgFeedback").innerHTML = sg.active
    ? `waiting for <b>${sg.seq[sg.idx].label}</b>…`
    : "set your Sa, choose a scale, hit start.";
}

function renderSargamChips() {
  const el = $("sgChips");
  el.innerHTML = "";
  sg.seq.forEach((n, i) => {
    const chip = document.createElement("span");
    chip.className = "chip" + (i === sg.idx && sg.active ? " chip-blue" : i < sg.idx ? " chip-sage" : "");
    chip.textContent = n.chip;
    chip.title = n.note;
    el.appendChild(chip);
  });
}

function sargamTick(info, now) {
  if (!sg.active || !sg.seq.length) return;
  const n = sg.seq[sg.idx];
  const expected = sg.sa + n.offset;
  const fine = info.fineMidi ?? freqToMidi(info.note ? midiToFreq(info.note) : 0);
  const dev = (fine - expected) * 100;

  if (Math.abs(dev) <= 35) {
    sg.holdFrames++;
    sg.noteCents.push(dev);
    $("sgFeedback").innerHTML = `listening to <b>${n.syl}</b>… ${dev > 0 ? "+" : ""}${dev.toFixed(0)}¢`;
  } else {
    sg.holdFrames = 0;
    const targetName = noteName(expected);
    if (Math.abs(dev) > 100) {
      $("sgFeedback").innerHTML = `that's <b>${info.note}</b> — I'm waiting for <b>${n.syl} (${targetName})</b>`;
    }
  }

  // sustained → note passed
  if (sg.holdFrames >= 12) {
    const avg = sg.noteCents.reduce((s, c) => s + c, 0) / sg.noteCents.length;
    sg.results.push({ syl: n.syl, avgDev: avg });
    sg.holdFrames = 0; sg.noteCents = [];
    sg.idx++;
    if (sg.idx >= sg.seq.length) {
      finishSargam();
    } else {
      renderSargamChips();
      $("sgFeedback").innerHTML = `✓ <b>${n.label}</b> done (${avg > 0 ? "+" : ""}${avg.toFixed(0)}¢ avg) — next: <b>${sg.seq[sg.idx].label}</b>`;
    }
  }
}

function finishSargam() {
  sg.active = false;
  renderSargamChips();
  const avg = sg.results.length
    ? sg.results.reduce((s, r) => s + Math.abs(r.avgDev), 0) / sg.results.length
    : 0;
  $("sgFeedback").innerHTML = `🎉 sargam complete! average deviation <b>${avg.toFixed(0)}¢</b> across ${sg.results.length} notes.`;
  const sum = document.createElement("div");
  sum.className = "holds";
  sum.innerHTML = sg.results.map((r) =>
    `<div class="hold"><span>${r.syl}</span><span class="grade ${Math.abs(r.avgDev) < 15 ? "gold" : "silver"}">${r.avgDev > 0 ? "+" : ""}${r.avgDev.toFixed(0)}¢</span></div>`).join("");
  $("sgSummary").innerHTML = "";
  $("sgSummary").appendChild(sum);
}

/* ---------------- sargam wiring ---------------- */
$("scaleSel").innerHTML = Object.entries(SCALES).map(([k, v]) => `<option value="${k}">${v.name}</option>`).join("");
$("saSel").innerHTML = ["C","C#","D","D#","E","F","F#","G","G#","A","A#","B"].map((n, i) => {
  const midi = i + 48; // C3..B3
  return `<option value="${midi}">${n} (${midiToFreq(midi).toFixed(0)} Hz)</option>`;
}).join("");
$("saSel").addEventListener("change", (e) => {
  sg.sa = +e.target.value;
  $("saLabel").textContent = `Sa: ${noteName(sg.sa)} (${midiToFreq(sg.sa).toFixed(0)} Hz)`;
  rebuildSargam();
});
$("scaleSel").addEventListener("change", (e) => { sg.scale = e.target.value; rebuildSargam(); });

$("setSaBtn").addEventListener("click", () => {
  // capture ~1.2s of pitch, take the median as Sa
  const samples = [];
  $("setSaBtn").textContent = "🎯 listening… play Sa";
  const iv = setInterval(() => {
    analyserNode().getFloatTimeDomainData(buf);
    const r = autoCorrelate(buf, audioCtx.sampleRate);
    if (r.freq > 0) samples.push(freqToMidi(r.freq) + transpose);
  }, 60);
  setTimeout(() => {
    clearInterval(iv);
    if (samples.length) {
      samples.sort((a, b) => a - b);
      sg.sa = Math.round(samples[Math.floor(samples.length / 2)]);
      $("saLabel").textContent = `Sa: ${noteName(sg.sa)} (${midiToFreq(sg.sa).toFixed(0)} Hz)`;
      if ($("saSel").querySelector(`option[value="${sg.sa}"]`)) $("saSel").value = String(sg.sa);
    } else {
      $("saLabel").textContent = "no pitch detected — try again";
    }
    $("setSaBtn").textContent = "🎯 play your Sa — set it";
    rebuildSargam();
  }, 1400);
});

$("sgStart").addEventListener("click", () => {
  sg.active = !sg.active;
  $("sgStart").textContent = sg.active ? "⏹ stop" : "▶ start";
  rebuildSargam();
  if (sg.active) $("sgFeedback").innerHTML = `waiting for <b>${sg.seq[0].syl}</b>…`;
});

$("sgDemo").addEventListener("click", () => {
  // the OS plays its own sargam — the tutor grades it in real time
  if (!sg.active) { $("sgStart").click(); }
  rebuildSargam();
  stopSource();
  audioCtx = audioCtx || new AudioContext();
  audioCtx.resume();
  startDemo();
  $("sgDemo").textContent = "⏹ stop sargam playback";
  let i = 0;
  if (window.__sgDemoIv) clearInterval(window.__sgDemoIv);
  window.__sgDemoIv = setInterval(() => {
    if (!sg.active || i >= sg.seq.length) {
      clearInterval(window.__sgDemoIv);
      window.__sgDemoIv = null;
      $("sgDemo").textContent = "🔊 play the sargam";
      setTimeout(() => { if (mode === "sargam" && !sg.active) {} }, 100);
      return;
    }
    const f = midiToFreq(sg.sa + sg.seq[i].offset);
    if (demoOsc) demoOsc.frequency.value = f;
    i++;
  }, 900);
});

/* ---------------- wiring ---------------- */
let loopId = null;
function startLoop() {
  if (loopId) return;
  loopId = setInterval(() => loop(), 16);
}

$("micBtn").addEventListener("click", () => { enableMic(); startLoop(); });
$("demoBtn").addEventListener("click", () => {
  if ($("demoBtn").textContent.includes("stop")) {
    if (mode === "tones" && hold) finishHold();  // grade the hold before the loop stops
    stopSource(); running = false;
    $("demoBtn").textContent = "🔊 play test tone (A4)"; $("demoBtn").classList.remove("on");
  } else { startDemo(); startLoop(); }
});
$("demoNote").addEventListener("input", (e) => {
  const midi = +e.target.value;
  const f = midiToFreq(midi - transpose);
  if (demoOsc) demoOsc.frequency.value = f;
  if (demoLfo) demoLfo.frequency.value = 5.2;
  $("demoNoteLabel").textContent = `${noteName(midi)} · ${f.toFixed(0)} Hz (concert) — vibrato + drift included`;
});
$("instrumentSel").addEventListener("change", (e) => {
  transpose = +e.target.value;
  try { localStorage.setItem("saxlab:instrument", JSON.stringify(transpose)); } catch {}
  $("saLabel").textContent = `Sa: ${noteName(sg.sa)} — re-set Sa if needed`;
});

$("modeTuner").addEventListener("click", () => {
  mode = "tuner";
  $("modeTuner").classList.add("active"); $("modeTones").classList.remove("active"); $("modeSargam").classList.remove("active");
  $("tonesPanel").style.display = "none"; $("sargamPanel").style.display = "none";
  sg.active = false;
  endHold(performance.now() / 1000);
});
$("modeTones").addEventListener("click", () => {
  mode = "tones";
  $("modeTones").classList.add("active"); $("modeTuner").classList.remove("active"); $("modeSargam").classList.remove("active");
  $("tonesPanel").style.display = "block"; $("sargamPanel").style.display = "none";
  sg.active = false;
});
$("modeSargam").addEventListener("click", () => {
  mode = "sargam";
  $("modeSargam").classList.add("active"); $("modeTuner").classList.remove("active"); $("modeTones").classList.remove("active");
  $("sargamPanel").style.display = "block"; $("tonesPanel").style.display = "none";
  rebuildSargam();
});

window.addEventListener("resize", () => drawStave(performance.now() / 1000));
startLoop();
