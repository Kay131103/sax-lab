p = "src/main.js"
s = open(p).read()

s = s.replace('import { SCALES, sargamSequence } from "./scales.js";',
'import { SCALES, sargamSequence, CARNATIC_STHANAS } from "./scales.js";\nimport { rankRagas } from "./ragas.js";')

sg_old = 'const sg = { active: false, sa: 58, scale: "mayamalavagowla", seq: [], idx: 0, holdFrames: 0, noteCents: [], results: [] };'
sg_new = sg_old + '''

/* ---------------- free-play raga detection ---------------- */
const free = { pc: null, startT: 0, lastT: 0, heard: new Map(), stream: [], updateTimer: null };
function freeplayTick(info, now) {
  const pc = ((Math.round(info.fineMidi) - sg.sa) % 12 + 12) % 12;
  if (free.pc === null) { free.pc = pc; free.startT = now; free.lastT = now; return; }
  if (pc === free.pc) { free.lastT = now; return; }
  commitSwara(free.pc, free.lastT - free.startT);
  free.pc = pc; free.startT = now; free.lastT = now;
}

function commitSwara(pc, durMs) {
  if (durMs < 220) return;
  const prev = free.heard.get(pc) || 0;
  free.heard.set(pc, prev + durMs);
  free.stream.push({ pc, ms: durMs });
  if (free.stream.length > 14) free.stream.shift();
  renderFreeplay();
}

function renderFreeplay() {
  const el = (id) => document.getElementById(id);
  el("ragaStream").innerHTML = free.stream
    .map((e) => '<span class="chip ' + (e.ms > 800 ? "chip-blue" : "") + '">' + CARNATIC_STHANAS[e.pc] + (e.ms > 800 ? " · " + (e.ms / 1000).toFixed(1) + "s" : "") + "</span>")
    .join("");
  const entries = [...free.heard.entries()].sort((a, b) => b[1] - a[1]);
  const total = entries.reduce((s, e) => s + e[1], 0) || 1;
  el("ragaHistogram").innerHTML = entries
    .map(([pc, ms]) => '<div style="display:flex;align-items:center;gap:8px;">'
      + '<span style="font-family:JetBrains Mono,monospace;font-size:11px;width:26px;flex-shrink:0;">' + CARNATIC_STHANAS[pc] + '</span>'
      + '<div style="flex:1;height:12px;border:1.5px solid var(--ink);border-radius:4px;background:var(--sand-soft);overflow:hidden;">'
      + '<div style="height:100%;width:' + (ms / total) * 100 + '%;background:var(--elec);"></div></div>'
      + '<span style="font-family:JetBrains Mono,monospace;font-size:10px;color:var(--faint);width:38px;text-align:right;">' + (ms / 1000).toFixed(1) + 's</span></div>')
    .join("");
  const ranked = rankRagas(free.heard).slice(0, 5);
  const distinct = free.heard.size;
  el("ragaMatches").innerHTML = distinct < 3
    ? '<div class="mono-sub">keep playing — I need at least 3 different swaras before guessing a raga.</div>'
    : ranked.map((r, i) => '<div style="display:flex;align-items:center;gap:8px;border:1.5px solid '
      + (i === 0 && r.score > 0.85 ? "var(--elec)" : "var(--ink)")
      + ';border-radius:9px;padding:6px 10px;margin-bottom:6px;background:'
      + (i === 0 && r.score > 0.85 ? "var(--elec-soft)" : "var(--paper)") + ';">'
      + '<span style="font-family:JetBrains Mono,monospace;font-size:11px;width:22px;color:var(--faint);">' + (i + 1) + '</span>'
      + '<b style="font-size:13px;flex-shrink:0;">' + r.name + '</b>'
      + '<div style="flex:1;height:10px;border:1.5px solid var(--ink);border-radius:4px;background:var(--sand-soft);overflow:hidden;">'
      + '<div style="height:100%;width:' + r.score * 100 + '%;background:' + (i === 0 ? "var(--elec)" : "var(--sage)") + ';"></div></div>'
      + '<span style="font-family:JetBrains Mono,monospace;font-size:10.5px;width:64px;text-align:right;color:var(--faint);">' + (r.score * 100).toFixed(0) + '% fit</span></div>').join("");
}

function freeplayReadout(info) {
  const pc = ((Math.round(info.fineMidi) - sg.sa) % 12 + 12) % 12;
  const sthana = CARNATIC_STHANAS[pc];
  document.getElementById("fp2Note").textContent = info.note;
  document.getElementById("fp2Swara").innerHTML = "swara: <b>" + sthana + "</b> (" + (info.cents > 0 ? "+" : "") + info.cents + "¢ vs the sthana)";
}'''
assert sg_old in s
s = s.replace(sg_old, sg_new, 1)

hook_old = '    if (mode === "sargam") sargamTick({ ...info, fineMidi: shownMidi(freqToMidi(r.freq)) }, now);'
hook_new = hook_old + '''
    if (mode === "raga") {
      const fi = { ...info, fineMidi: shownMidi(freqToMidi(r.freq)) };
      freeplayTick(fi, now);
      freeplayReadout(fi);
    }'''
assert hook_old in s
s = s.replace(hook_old, hook_new, 1)

mode_old = '''$("modeSargam").addEventListener("click", () => {
  mode = "sargam";
  $("modeSargam").classList.add("active"); $("modeTuner").classList.remove("active"); $("modeTones").classList.remove("active");
  $("sargamPanel").style.display = "block"; $("tonesPanel").style.display = "none";
  rebuildSargam();
});'''
mode_new = '''$("modeSargam").addEventListener("click", () => {
  mode = "sargam";
  $("modeSargam").classList.add("active"); $("modeTuner").classList.remove("active"); $("modeTones").classList.remove("active"); $("modeRaga").classList.remove("active");
  $("sargamPanel").style.display = "block"; $("tonesPanel").style.display = "none"; $("ragaPanel").style.display = "none";
  rebuildSargam();
});
$("modeRaga").addEventListener("click", () => {
  mode = "raga";
  $("modeRaga").classList.add("active"); $("modeTuner").classList.remove("active"); $("modeTones").classList.remove("active"); $("modeSargam").classList.remove("active");
  $("ragaPanel").style.display = "block"; $("tonesPanel").style.display = "none"; $("sargamPanel").style.display = "none";
  document.getElementById("fp2Swara").innerHTML = "playing relative to <b>Sa = " + noteName(sg.sa) + "</b> — set it in the sargam tab if needed";
});'''
assert mode_old in s
s = s.replace(mode_old, mode_new, 1)
open(p, "w").write(s)
print("main.js: raga detection wired")
