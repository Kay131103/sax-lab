/* ============================================================
 *  A compact raga library for free-play detection.
 *  Each raga = the set of swara sthanas (0-11 relative to Sa)
 *  heard in its arohanam/avarohanam. Set-based matching keeps
 *  the detector honest: we say WHICH swaras you played and which
 *  ragas they fit — never more than the evidence supports.
 * ============================================================ */

export const RAGAS = [
  { name: "Mohanam", swaras: [0, 2, 4, 7, 9] },
  { name: "Hamsadhwani", swaras: [0, 2, 4, 7, 11] },
  { name: "Shuddha Saveri", swaras: [0, 2, 5, 7, 9] },
  { name: "Madhyamavati", swaras: [0, 2, 5, 7, 10] },
  { name: "Hindolam", swaras: [0, 3, 5, 8, 10] },
  { name: "Abheri", swaras: [0, 2, 3, 7, 10] },
  { name: "Bilahari", swaras: [0, 2, 4, 7, 9, 11] },
  { name: "Kambhoji", swaras: [0, 2, 4, 5, 7, 9, 10] },
  { name: "Charukesi", swaras: [0, 2, 3, 5, 7, 9, 10] },
  { name: "Shankarabharanam", swaras: [0, 2, 4, 5, 7, 9, 11] },
  { name: "Kalyani", swaras: [0, 2, 4, 5, 7, 9, 11] },
  { name: "Kedar", swaras: [0, 2, 4, 6, 7, 9, 11] },
  { name: "Mayamalavagowla", swaras: [0, 1, 4, 5, 7, 8, 11] },
  { name: "Pantuvarali", swaras: [0, 1, 4, 6, 7, 8, 11] },
  { name: "Todi", swaras: [0, 1, 3, 5, 7, 8, 10] },
  { name: "Sindhu Bhairavi", swaras: [0, 1, 3, 5, 7, 9, 10] },
  { name: "Kharaharapriya", swaras: [0, 2, 3, 5, 7, 8, 10] },
  { name: "Natabhairavi", swaras: [0, 2, 3, 5, 7, 8, 10] },
];

/* score how well the heard swaras fit a raga:
   purity    = fraction of played time inside the raga's swaras
   coverage  = fraction of the raga's swaras actually heard
   score     = purity × (0.5 + 0.5 × coverage)                       */
export function rankRagas(heard) {
  // heard: Map pc -> ms played
  let totalMs = 0;
  for (const ms of heard.values()) totalMs += ms;
  if (totalMs === 0) return [];

  return RAGAS.map((r) => {
    const set = new Set(r.swaras);
    let inside = 0, outside = 0, covered = 0;
    for (const [pc, ms] of heard) {
      if (set.has(pc)) { inside += ms; covered++; }
      else outside += ms;
    }
    const purity = inside / totalMs;
    const coverage = covered / r.swaras.length;
    return {
      name: r.name,
      purity, coverage, score: purity * (0.5 + 0.5 * coverage),
      missing: r.swaras.filter((pc) => !heard.has(pc)).map((pc) => r.swaras[pc] !== undefined ? pc : pc),
    };
  }).sort((a, b) => b.score - a.score);
}
