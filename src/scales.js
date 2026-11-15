/* Indian classical scales + sargam syllables.
   steps = semitone offsets from Sa. */

export const SCALES = {
  bilawal: { name: "Bilawal (major)", steps: [0, 2, 4, 5, 7, 9, 11] },
  kafi: { name: "Kafi (minor-like)", steps: [0, 2, 3, 5, 7, 9, 10] },
  bhupali: { name: "Bhupali (pentatonic)", steps: [0, 2, 4, 7, 9] },
  yaman: { name: "Yaman (lydian)", steps: [0, 2, 4, 6, 7, 9, 11] },
  chromatic: { name: "Chromatic (all 12 notes)", steps: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] },
};

export const SARGAM = ["Sa", "Re", "Ga", "Ma", "Pa", "Dha", "Ni"];

/* full practice sequence: ascent Sa → Sa', then descent Sa' → Sa.
   Every entry carries its western note name for the chosen Sa. */
export function sargamSequence(scaleKey, saMidi = 45) {
  const steps = SCALES[scaleKey].steps;
  const chromatic = scaleKey === "chromatic";
  const deg = (offset) => {
    if (offset === 12) return 7;
    const i = steps.indexOf(offset);
    return i === -1 ? 7 : i;
  };
  const syll = (i, offset) => {
    if (chromatic) return noteNameLocal(saMidi + offset); // chromatic = note names as syllables
    return i === 7 ? "Sa'" : SARGAM[i];
  };
  const mk = (o, i) => {
    const note = noteNameLocal(saMidi + o);
    const s = syll(i, o);
    const oct = o >= 12 ? "pitch higher" : "base";
    const arrow = o >= 12 ? " ↑" : "";
    return {
      offset: o, syl: s, note, oct,
      label: `${s} · ${note} · ${oct}`,
      chip: `${s === note ? note : `${s}·${note}`}${arrow}`,
    };
  };
  const up = steps.map((o, i) => mk(o, i));
  up.push(mk(12, 7));
  // descent skips the duplicated Sa' and ends on the opening Sa — each pitch once
  const down = [...steps.slice(0, -1).reverse(), 0].map((o, i) => {
    const e = mk(o, deg(o));
    if (i === 0) e.oct = "pitch higher"; // coming down from Sa'
    return e;
  });
  return [...up, ...down];
}

/* local note-name helper (no circular import) */
const NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
function noteNameLocal(midi) {
  const n = Math.round(midi);
  return NAMES[((n % 12) + 12) % 12] + (Math.floor(n / 12) - 1);
}
