/**
 * Analyzer: balance analysis from the AI-vs-AI playtests (engine statistics computed by GameWatch, NOT a Kane result).
 * Per build: first-mover wins over all games and in matched seed pairs (same seed, first mover swapped) with an exact
 * two-sided sign test; actions granted minus own pieces on board per seat (rule R3 predicts 0 at turn start).
 *   node gamewatch/skillbook/steps/balance.ts <bundle.json> <out.json>
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { GWBundle } from '../../evidence.ts';

const [bf, outF] = process.argv.slice(2);
const b = JSON.parse(readFileSync(bf, 'utf8')) as GWBundle;
const binom = (k: number, n: number) => { let c = 1, p = 0; const probs: number[] = []; for (let i = 0; i <= n; i++) { probs.push(c / 2 ** n); c = c * (n - i) / (i + 1); } const pk = probs[k]; for (const q of probs) if (q <= pk + 1e-12) p += q; return Math.min(1, p); };
const out: Record<string, unknown> = {};
for (const build of b.builds.map(x => x.label)) {
  const ms = b.matches.filter(m => m.build === build);
  const seeds = [...new Set(ms.map(m => m.seed))];
  let pairsFirstBoth = 0, pairsSecondBoth = 0, split = 0;
  for (const s of seeds) {
    const g = ms.filter(m => m.seed === s);
    if (g.length !== 2) continue;
    const fw = g.filter(m => m.winner === m.firstMover).length;
    if (fw === 2) pairsFirstBoth++; else if (fw === 0) pairsSecondBoth++; else split++;
  }
  const fmw = ms.filter(m => m.winner === m.firstMover).length, decided = ms.filter(m => m.winner !== 'draw').length;
  const seat = (first: boolean) => { const rs = ms.flatMap(m => m.rows.filter(r => (r.side === m.firstMover) === first)); return { turns: rs.length, meanExtraActions: Math.round(1000 * rs.reduce((a, r) => a + r.actionsGranted - r.piecesOnBoard, 0) / Math.max(1, rs.length)) / 1000, turnsWithExtra: rs.filter(r => r.actionsGranted !== r.piecesOnBoard).length }; };
  out[build] = {
    games: ms.length, firstMoverWins: fmw, decided, signTestP: Math.round(binom(fmw, decided) * 1000) / 1000,
    matchedPairs: { pairs: seeds.length, firstMoverWonBoth: pairsFirstBoth, secondMoverWonBoth: pairsSecondBoth, split, signTestP: Math.round(binom(pairsFirstBoth, pairsFirstBoth + pairsSecondBoth) * 1000) / 1000 },
    actionsMinusPieces: { firstMover: seat(true), secondMover: seat(false) },
    medianTurns: [...ms.map(m => m.turns)].sort((x, y) => x - y)[Math.floor(ms.length / 2)],
  };
}
mkdirSync(dirname(outF), { recursive: true });
writeFileSync(outF, JSON.stringify({ note: 'Engine statistics from real AI-vs-AI playtests, computed by GameWatch. Not a Kane result. Small samples: read p-values as indicators only.', builds: out }, null, 1) + '\n');
console.log(JSON.stringify(out, null, 1));
