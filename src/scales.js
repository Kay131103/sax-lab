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

/* full practice sequence: base octave up to Sa', the WHOLE higher octave
   (Re' Ga' Ma' Pa' Dha' Ni' Sa''), then back down to base Sa. Every pitch once,
   except the starting/ending Sa. Every note tagged: base / pitch higher / ×2. */
export function sargamSequence(scaleKey, saMidi = 45) {
  const steps = SCALES[scaleKey].steps;
  const chromatic = scaleKey === "chromatic";
  const deg = (offset) => {
    const i = steps.indexOf(offset % 12 === 0 && offset !== 0 ? 0 : offset % 12);
    return i === -1 ? 7 : i;
  };
  const octaveTag = (offset) => {
    const oct = Math.floor(offset / 12);
    if (oct === 0) return "base";
    if (oct === 1) return "pitch higher";
    return `pitch higher ×${oct}`;
  };
  const mk = (o) => {
    const note = noteNameLocal(saMidi + o);
    const s = chromatic ? note : (o % 12 === 0 && o !== 0 ? "Sa" + "'".repeat(o / 12) : (() => {
      const i = steps.indexOf(o % 12);
      return i === -1 ? note : SARGAM[i];
    })());
    const oct = octaveTag(o);
    const arrow = oct === "base" ? "" : "↑".repeat(oct);
    return {
      offset: o, syl: s, note, oct,
      label: `${s} · ${note} · ${oct}`,
      chip: `${s === note ? note : `${s}·${note}`}${arrow}`,
    };
  };
  const up = [];
  for (let o = 0; o <= 36; o++) if (steps.includes(o % 12)) up.push(mk(o));
  const down = [];
  for (let o = 35; o >= 0; o--) if (steps.includes(o % 12)) down.push(mk(o));
  return [...up, ...down];
}

/* local note-name helper (no circular import) */
const NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
function noteNameLocal(midi) {
  const n = Math.round(midi);
  return NAMES[((n % 12) + 12) % 12] + (Math.floor(n / 12) - 1);
}
