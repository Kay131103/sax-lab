const NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const A4 = 440;

export function freqToMidi(freq) {
  return 69 + 12 * Math.log2(freq / A4);
}

export function midiToFreq(midi) {
  return A4 * Math.pow(2, (midi - 69) / 12);
}

export function noteName(midi) {
  const n = Math.round(midi);
  return NAMES[((n % 12) + 12) % 12] + (Math.floor(n / 12) - 1);
}

/* f0 → { note: "A4", cents: -12, midi: 69 } (cents = deviation from nearest note) */
export function analyze(freq, transpose = 0) {
  const midi = freqToMidi(freq) + transpose;
  const nearest = Math.round(midi);
  return {
    note: noteName(nearest),
    midi: nearest,
    cents: Math.round((midi - nearest) * 100),
    fineMidi: midi,
  };
}

export const midiFromName = (name) => {
  const m = name.match(/^([A-G]#?)(-?\d+)$/);
  if (!m) return 69;
  const idx = NAMES.indexOf(m[1]);
  return idx + (parseInt(m[2], 10) + 1) * 12;
};
