/**
 * Self-play balance + board-crowding measurement (engine only, no LLM, no Kane).
 *   npm run selfplay -- [games=20]
 * Bots: "planner" (the AI's simulation planner), "casual" (walks the cheapest path,
 * sometimes drops a random effect on random cells), "mover" (planner that never places).
 */
import { init, applyPlacement, applyMove, endTurn, legalMoves, eligibleCells, activeEffects, type State, type Placement } from '../server/engine.ts';
import { planTurn, planMoves, CANDIDATE_EFFECTS } from '../server/ai.ts';
import { type Player } from '../server/rules.ts';

type Bot = (s: State, me: Player) => void;
let r0 = 7; const rnd = () => { r0 = (r0 * 1103515245 + 12345) & 0x7fffffff; return r0 / 0x7fffffff; };
const planner: Bot = (s, me) => { const p = planTurn(s, { me }).chosen; if (p.placement) applyPlacement(s, me, p.placement); for (const m of planMoves(s, me).moves) applyMove(s, me, m); };
const mover: Bot = (s, me) => { for (const m of planMoves(s, me).moves) applyMove(s, me, m); };
const casual: Bot = (s, me) => {
  if (rnd() < 0.5) {
    const el = eligibleCells(s, me).filter(k => !s.cells[k]);
    const e = CANDIDATE_EFFECTS[Math.floor(rnd() * CANDIDATE_EFFECTS.length)];
    const cells = [...el].sort(() => rnd() - 0.5).slice(0, 1 + Math.floor(rnd() * 3));
    const pl: Placement = { text: 'casual', effect: e, cells, interpretedBy: 'bot' };
    if (cells.length) applyPlacement(s, me, pl);
  }
  for (const m of planMoves(s, me, 1.5, rnd).moves) applyMove(s, me, m);
};
function play(seed: number, human: Bot, ai: Bot) {
  const s = init(seed);
  let triggers = 0, self = 0, captures = 0, places = 0, cellsPlaced = 0, chains = 0, maxActive = 0;
  while (!s.winner) {
    const before = s.log.length;
    (s.current === 'human' ? human : ai)(s, s.current);
    void before;
    if (!s.winner) endTurn(s);
    maxActive = Math.max(maxActive, activeEffects(s));
  }
  // events are not stored in s.log by the bots; recount from rules
  for (const r of s.rules) { triggers += r.hits.human + r.hits.ai; self += r.hits[r.owner]; places++; cellsPlaced += r.placed; }
  void captures; void chains; void legalMoves;
  const act = s.stats.activePerTurn;
  return { winner: s.winner, turns: s.turn, triggers, self, places, cellsPlaced, maxActive, avgActive: act.reduce((a, b) => a + b, 0) / Math.max(1, act.length), lateActive: act.slice(-6).reduce((a, b) => a + b, 0) / Math.max(1, Math.min(6, act.length)), first: s.firstPlayer };
}
const N = Number(process.argv[2] ?? 20);
const matchups: [string, Bot, Bot][] = [['planner vs planner', planner, planner], ['casual(human) vs planner(ai)', casual, planner], ['casual vs casual', casual, casual], ['mover(human) vs planner(ai)', mover, planner], ['planner(human) vs mover(ai)', planner, mover]];
for (const [name, h, a] of matchups) {
  const t0 = performance.now();
  const res = Array.from({ length: N }, (_, i) => play(2000 + i, h, a));
  const w: Record<string, number> = { human: 0, ai: 0, draw: 0 }; res.forEach(r => w[r.winner!]++);
  const firstWins = res.filter(r => r.winner === r.first).length;
  const avg = (f: (r: typeof res[0]) => number) => (res.reduce((x, r) => x + f(r), 0) / N).toFixed(1);
  console.log(`${name}: n=${N} wins human=${w.human} ai=${w.ai} draw=${w.draw} first-player-wins=${firstWins} | turns ${avg(r => r.turns)} | rules placed ${avg(r => r.places)} (${avg(r => r.cellsPlaced)} cells) | triggers ${avg(r => r.triggers)} (self ${avg(r => r.self)}) | active effects avg ${avg(r => r.avgActive)} last6 ${avg(r => r.lateActive)} max ${Math.max(...res.map(r => r.maxActive))} | ${((performance.now() - t0) / N / 1000).toFixed(2)}s/game`);
}
