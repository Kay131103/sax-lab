/* Indian classical scales + sargam syllables.
   steps = semitone offsets from Sa. */

export const SCALES = {
  bilawal: { name: "Bilawal (major)", steps: [0, 2, 4, 5, 7, 9, 11] },
  kafi: { name: "Kafi (minor-like)", steps: [0, 2, 3, 5, 7, 9, 10] },
  bhupali: { name: "Bhupali (pentatonic)", steps: [0, 2, 4, 7, 9] },
  yaman: { name: "Yaman (lydian)", steps: [0, 2, 4, 6, 7, 9, 11] },
};

export const SARGAM = ["Sa", "Re", "Ga", "Ma", "Pa", "Dha", "Ni"];

/* full practice sequence: ascent Sa → Sa', then descent Sa' → Sa */
export function sargamSequence(scaleKey) {
  const steps = SCALES[scaleKey].steps;
  const deg = (offset) => {
    if (offset === 12) return 7;                       // Sa'
    const i = steps.indexOf(offset);
    return i === -1 ? 7 : i;
  };
  const syll = (i) => (i === 7 ? "Sa'" : SARGAM[i]);
  const up = steps.map((o, i) => ({ offset: o, syl: syll(i) }));
  up.push({ offset: 12, syl: syll(7) });
  const down = [12, ...steps.slice(0, -1).reverse(), 0].map((o) => ({
    offset: o, syl: syll(deg(o)),
  }));
  return [...up, ...down];
}
