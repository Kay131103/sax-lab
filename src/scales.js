/* ============================================================
 *  Carnatic music scales — the 16-swara system mapped to the
 *  12 swara sthanas (positions 2/3 and 9/10 carry two names each:
 *  R2=G1, R3=G2, D2=N1, D3=N2). Practice follows the classic
 *  first-lesson structure (sarali varisai): ascend S → S' and
 *  descend, in the melakarta of your choice.
 * ============================================================ */

/* the 12 swara sthanas in Carnatic naming (standard choice) */
export const CARNATIC_STHANAS = ["S", "R1", "R2", "R3", "G3", "M1", "M2", "P", "D1", "D2", "D3", "N3"];

/* degree syllables for practice */
export const SWARAS = ["S", "R", "G", "M", "P", "D", "N"];

export const SCALES = {
  mayamalavagowla: { name: "Mayamalavagowla (first lesson)", steps: [0, 1, 4, 5, 7, 8, 11] },
  shankarabharanam: { name: "Shankarabharanam", steps: [0, 2, 4, 5, 7, 9, 11] },
  kharaharapriya: { name: "Kharaharapriya", steps: [0, 2, 3, 5, 7, 8, 10] },
  harikambhoji: { name: "Harikambhoji", steps: [0, 2, 4, 5, 7, 9, 10] },
  natabhairavi: { name: "Natabhairavi", steps: [0, 2, 3, 5, 7, 8, 10] },
  todi: { name: "Todi", steps: [0, 1, 3, 5, 7, 8, 10] },
  chromatic: { name: "All 12 swara sthanas", steps: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] },
};

/* full practice sequence (sarali varisai): madhya sthayi up to taara,
   the whole taara sthayi octave, then back down to the base S.
   Every note carries: its swara in the chosen melakarta, its western
   note name, and its sthayi (base = madhya, higher = taara). */
export function sargamSequence(scaleKey, saMidi = 45) {
  const steps = SCALES[scaleKey].steps;
  const chromatic = scaleKey === "chromatic";

  const NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
  const noteName = (midi) => {
    const n = Math.round(midi);
    return NAMES[((n % 12) + 12) % 12] + (Math.floor(n / 12) - 1);
  };

  const mk = (o, phase) => {
    const pc = ((o % 12) + 12) % 12;
    const note = noteName(saMidi + o);
    const sthana = CARNATIC_STHANAS[pc];
    const degreeIdx = chromatic ? pc : steps.indexOf(pc);
    const degreeSyl = SWARAS[degreeIdx === -1 ? 0 : degreeIdx] + (o >= 12 ? "'" : "");
    const oct = Math.floor(o / 12);
    const sthayi = oct === 0 ? "base" : "higher (taara)";
    const arrow = oct === 0 ? "" : "↑".repeat(oct);
    const syl = chromatic ? sthana : degreeSyl;
    return {
      offset: o, syl, note: noteName(saMidi + o), oct,
      swara: sthana,
      label: `${syl} · ${sthana} · ${note} · ${sthayi}`,
      chip: `${syl === sthana ? sthana : `${syl}·${sthana}`}${arrow}`;
    };
  };

  const up = [];
  for (let o = 0; o <= 36; o++) if (steps.includes(o % 12)) up.push(mk(o, "up"));
  const down = [];
  for (let o = 35; o >= 0; o--) if (steps.includes(o % 12)) down.push(mk(o, "down"));
  return [...up, ...down];
}
