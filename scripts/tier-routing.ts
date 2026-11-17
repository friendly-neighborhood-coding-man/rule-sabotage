/**
 * How many new rules would still need a real Kane review with REFEREE_TIERS=on?
 * Engine only (no LLM, no Kane): bots play full games; before each placement goes on the board the
 * same buildTrial + selectTier the server uses is run, and the tier is counted.
 *   npm run tiers:routing -- [games=30]
 * This measures routing only. It says nothing about Kane's own latency or verdicts.
 */
import { init, applyPlacement, applyMove, endTurn, eligibleCells, type State, type Placement } from '../server/engine.ts';
import { planTurn, planMoves, CANDIDATE_EFFECTS } from '../server/ai.ts';
import { type Player } from '../server/rules.ts';
import { buildTrial } from '../server/trial.ts';
import { selectTier } from '../server/tiers.ts';

let r0 = 11; const rnd = () => { r0 = (r0 * 1103515245 + 12345) & 0x7fffffff; return r0 / 0x7fffffff; };
const count = { 1: 0, 2: 0, 3: 0 } as Record<number, number>, reasons3 = new Map<string, number>();
let trialMs = 0, tierMs = 0, n = 0, rejected = 0;
function judge(s: State, me: Player, pl: Placement) {
  const t0 = performance.now();
  const trial = buildTrial(s, me, pl, ++n);
  trialMs += performance.now() - t0;
  if (!trial.engineChecks.every(c => c.pass)) { rejected++; return false; }
  const t = selectTier(s, me, pl, trial);
  tierMs += t.ms; count[t.tier]++;
  if (t.tier === 3) for (const r of t.reasons) { const k = r.replace(/[A-G]\d/g, '#').replace(/\d+/g, 'N'); reasons3.set(k, (reasons3.get(k) ?? 0) + 1); }
  return true;
}
type Bot = (s: State, me: Player) => void;
const planner: Bot = (s, me) => { const p = planTurn(s, { me }).chosen; if (p.placement && judge(s, me, p.placement)) applyPlacement(s, me, p.placement); for (const m of planMoves(s, me).moves) applyMove(s, me, m); };
const casual: Bot = (s, me) => {
  if (rnd() < 0.5) {
    const el = eligibleCells(s, me).filter(k => !s.cells[k]);
    const e = CANDIDATE_EFFECTS[Math.floor(rnd() * CANDIDATE_EFFECTS.length)];
    const cells = [...el].sort(() => rnd() - 0.5).slice(0, 1 + Math.floor(rnd() * 3));
    const pl: Placement = { text: 'casual', effect: e, cells, interpretedBy: 'bot', ...(rnd() < 0.1 ? { approxNote: 'asked for more' } : {}) };
    if (cells.length && judge(s, me, pl)) applyPlacement(s, me, pl);
  }
  for (const m of planMoves(s, me, 1.5, rnd).moves) applyMove(s, me, m);
};
const N = Number(process.argv[2] ?? 30);
for (const [name, h, a] of [['planner vs planner', planner, planner], ['casual(human) vs planner(ai)', casual, planner], ['casual vs casual', casual, casual]] as [string, Bot, Bot][]) {
  for (const k of [1, 2, 3]) count[k] = 0; reasons3.clear(); trialMs = tierMs = 0; n = rejected = 0;
  for (let i = 0; i < N; i++) { const s = init(2000 + i); while (!s.winner) { (s.current === 'human' ? h : a)(s, s.current); if (!s.winner) endTurn(s); } }
  const total = count[1] + count[2] + count[3];
  const pct = (x: number) => `${x} (${Math.round(100 * x / Math.max(1, total))}%)`;
  console.log(`${name}: ${total} placements passed the engine checks (${rejected} failed them) | tier 1 ${pct(count[1])} | tier 2 ${pct(count[2])} | tier 3 = Kane ${pct(count[3])} | trial build avg ${(trialMs / Math.max(1, n)).toFixed(1)} ms, tier selection avg ${(tierMs / Math.max(1, total)).toFixed(1)} ms`);
  for (const [r, c] of [...reasons3].sort((a, b) => b[1] - a[1]).slice(0, 5)) console.log(`   tier-3 reason: ${r} ×${c}`);
}
