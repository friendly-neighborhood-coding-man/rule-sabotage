/**
 * Descriptive summary of recorded playtest sessions (playtest-data/, consent-gated). Prints two SEPARATE sections:
 * factual telemetry and subjective answers. It computes counts and medians only: a small pilot is exploratory, so no
 * p-values, no preference ranking and no enjoyment inferred from win rates. Pilot games and free-play games are reported
 * apart. Writes nothing.
 */
import { readAll, DATA_DIR } from '../server/playtest/telemetry.ts';

type Tel = any; type Fb = any;
const tel = readAll('telemetry') as Tel[], fb = readAll('feedback') as Fb[];
const med = (xs: number[]) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const by = <T,>(xs: T[], k: (x: T) => string) => xs.reduce((a, x) => ((a[k(x)] ??= []).push(x), a), {} as Record<string, T[]>);
console.log(`Playtest data: ${DATA_DIR}\n${tel.length} game records, ${fb.length} questionnaires. EXPLORATORY: descriptive only, no statistical claims.\n`);

console.log('== FACTUAL GAMEPLAY TELEMETRY ==');
for (const [mode, games] of Object.entries(by(tel, g => (g.pilot ? 'pilot' : 'free play')))) {
  console.log(`\n-- ${mode} --`);
  for (const [opp, gs] of Object.entries(by(games, g => g.opponent.id))) {
    const done = gs.filter(g => !g.result.abandoned), dec = done.filter(g => g.result.winner && g.result.winner !== 'draw');
    const openings = by(gs.filter(g => g.openings.ai), g => g.openings.ai);
    const lat = gs.flatMap(g => g.turns.filter((t: any) => t.ai).map((t: any) => t.ai.wallMs));
    console.log(`${opp} (${gs[0].opponent.version}, code ${gs[0].opponent.implementation.all}): ${gs.length} games, ${gs.length - done.length} unfinished`);
    console.log(`  human won ${done.filter(g => g.result.humanWon).length}/${dec.length} decided; first mover won ${dec.filter(g => g.result.firstMoverWon).length}/${dec.length}; turn-limit endings ${done.filter(g => g.result.turnLimit).length}/${done.length}; median length ${med(done.map(g => g.result.turns))} turns`);
    console.log(`  opponent answer time: median ${med(lat)} ms, max ${lat.length ? Math.max(...lat) : null} ms, >10 s ${lat.filter(x => x > 10000).length}, budget reached ${gs.reduce((a, g) => a + g.aiLatencyMs.budgetHits, 0)}`);
    console.log(`  opponent first-turn openings: ${Object.keys(openings).length} distinct in ${gs.filter(g => g.openings.ai).length} games (most common used ${Math.max(0, ...Object.values(openings).map(x => x.length))}×)`);
    console.log(`  per game: lead changes median ${med(gs.map(g => g.reversals.leadChanges))}; effects triggered median ${med(gs.map(g => g.interactions.triggers))}; own-effect hits ${gs.reduce((a, g) => a + g.interactions.selfTriggers, 0)}; opponent effects not placed by the referee ${gs.reduce((a, g) => a + g.interactions.notPlaced.ai, 0)}; human ${gs.reduce((a, g) => a + g.interactions.notPlaced.human, 0)}`);
  }
}

console.log('\n== SUBJECTIVE ANSWERS (participants\' own ratings, 1–5; not derived from outcomes) ==');
const oppOf = new Map(tel.map(g => [g.gameId, g.opponent.id]));
const ITEMS = ['enjoyment', 'challenge', 'predictability', 'strategicChoice', 'playAgain'];
for (const [opp, fs] of Object.entries(by(fb, f => oppOf.get(f.gameId) ?? 'unknown game'))) {
  const ans = fs.filter(f => !f.skipped);
  console.log(`\n${opp}: ${ans.length} answered, ${fs.length - ans.length} skipped`);
  for (const k of ITEMS) { const v = ans.map(f => f.ratings?.[k]).filter((x: unknown) => typeof x === 'number'); console.log(`  ${k.padEnd(16)} n=${v.length} median=${med(v)} values=[${v.join(',')}]`); }
  const tags = ans.flatMap(f => f.tags); console.log(`  tags: ${['repetitive', 'unfair', 'confusing', 'satisfying'].map(t => `${t} ${tags.filter((x: string) => x === t).length}`).join(', ')}`);
  for (const f of ans.filter(f => f.comment)) console.log(`  “${f.comment.replace(/\s+/g, ' ').slice(0, 200)}”`);
}
