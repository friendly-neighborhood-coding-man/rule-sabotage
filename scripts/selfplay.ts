/** Self-play balance check: planner vs planner (and planner vs move-only bot). Prints real measured stats. */
import { init, resolveRound, type Action, type State } from '../server/engine.ts';
import { planAI } from '../server/ai.ts';
type Bot = (s: State, me: 'human' | 'ai') => Action;
const planner: Bot = (s, me) => planAI(s, { me }).chosen.action;
const moveOnly: Bot = (s, me) => { const a = planAI(s, { me, temperature: 0 }); const m = a.ranked.find(c => c.action.rule.op === 'none'); return m ? m.action : { rule: { op: 'none' }, move: 'hold' }; };
import { eligibleCells, validateAction } from '../server/engine.ts';
import { pathCost } from '../server/ai.ts';
import { normalizeEffect, maxCells } from '../server/rules.ts';
let r0 = 7; const rnd = () => { r0 = (r0 * 1103515245 + 12345) & 0x7fffffff; return r0 / 0x7fffffff; };
/** A casual human: walks the cheapest-looking path, sometimes drops a random trap on random squares. */
const casual: Bot = (s, me) => {
  if (s.status[me].skip) return { rule: { op: 'none' }, move: 'hold' };
  let best: Action = { rule: { op: 'none' }, move: 'hold' }, bc = Infinity;
  for (const m of ['left', 'right', 'up', 'down', 'hold'] as const) {
    const a: Action = { rule: { op: 'none' }, move: m }; if (!validateAction(s, me, a).ok) continue;
    const n = resolveRound(s, me === 'human' ? { human: a, ai: { rule: { op: 'none' }, move: 'hold' } } : { ai: a, human: { rule: { op: 'none' }, move: 'hold' } }).state;
    const c = n.winner === me ? -9 : pathCost(n, me) + rnd() * 0.3; if (c < bc) { bc = c; best = a; }
  }
  const el = eligibleCells(s);
  if (rnd() < 0.45 && el.length && s.rules[me].length < s.slots) {
    const kinds = [normalizeEffect('push', 2), normalizeEffect('skip'), normalizeEffect('push', 1), normalizeEffect('reverse'), normalizeEffect('swap'), normalizeEffect('teleport')];
    const e = kinds[Math.floor(rnd() * kinds.length)];
    const cells = [...el].sort(() => rnd() - 0.5).slice(0, maxCells(e));
    const a: Action = { rule: { op: 'place', text: 'casual', effect: e, cells, interpretedBy: 'bot' }, move: best.move };
    if (validateAction(s, me, a).ok) return a;
  }
  return best;
};
function play(seed: number, human: Bot, ai: Bot) {
  let s = init(seed); let traps = 0, places = 0, self = 0; let ms = 0;
  while (!s.winner) {
    const t = performance.now();
    const acts = { human: human(s, 'human'), ai: ai(s, 'ai') };
    ms = Math.max(ms, performance.now() - t);
    const r = resolveRound(s, acts); s = r.state;
    for (const e of r.events) { if (e.t === 'trigger') { traps++; if (e.self) self++; } if (e.t === 'place') places++; }
  }
  return { winner: s.winner, rounds: s.round - 1, traps, places, self, ms };
}
const N = Number(process.argv[2] ?? 30);
for (const [name, h, a] of [['casual human vs planner ai', casual, planner], ['casual human vs casual ai', casual, casual], ['planner vs planner', planner, planner], ['move-only(human) vs planner(ai)', moveOnly, planner], ['planner(human) vs move-only(ai)', planner, moveOnly]] as const) {
  const res = Array.from({ length: N }, (_, i) => play(1000 + i, h, a));
  const w = { human: 0, ai: 0, draw: 0 } as Record<string, number>; res.forEach(r => w[r.winner!]++);
  const avg = (f: (r: typeof res[0]) => number) => (res.reduce((x, r) => x + f(r), 0) / N).toFixed(2);
  console.log(`${name}: n=${N} wins human=${w.human} ai=${w.ai} draw=${w.draw} | rounds ${avg(r => r.rounds)} | placements ${avg(r => r.places)} | triggers ${avg(r => r.traps)} | self-triggers ${avg(r => r.self)} | max plan ms ${Math.max(...res.map(r => r.ms)).toFixed(0)}`);
}
