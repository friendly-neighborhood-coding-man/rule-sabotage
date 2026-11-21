/**
 * V6.2 latency: checks the semantics-preserving fast State copy (server/v6/fastclone.ts) on the captured slow positions
 * of evidence/v6/v6-2-replay.json: every decision must be IDENTICAL (chosen plan, full ranking, simulation count) with
 * and without it, and the wall time of both is reported. Output: evidence/v6/v6-2-fastclone.json. Run: npm run v6.2:fastclone
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { planPolicy53, type Policy53 } from '../server/v6/forks/policies53.ts';
import { withFastClone } from '../server/v6/fastclone.ts';
import { planningView } from '../server/v6/turn.ts';
import { loadWeights } from '../server/weights.ts';
import { ROOT } from './v6-fork.ts';
import type { State } from '../server/v6/engine.ts';

const W8 = loadWeights();
const replay = JSON.parse(readFileSync(join(ROOT, 'evidence/v6/v6-2-replay.json'), 'utf8')) as { positions: { game: string; turn: number; p: 'human' | 'ai'; policy: Policy53; plannerMs: number; state: State }[] };
const only = process.argv[2] ? Number(process.argv[2]) : Infinity;
const picked = (['softmax-v2', 'ev-k1.2', 'oa-v3'] as Policy53[]).flatMap(pol => replay.positions.filter(x => x.policy === pol).sort((a, b) => b.plannerMs - a.plannerMs).slice(0, Math.min(3, only)));
const sig = (p: ReturnType<typeof planPolicy53>) => JSON.stringify([p.chosen, p.ranked, p.sims, p.candidates]);
const rows = [];
for (const pos of picked) {
  // interleaved, twice each (base, optimised, base, optimised); the faster of the two runs of each arm is reported
  const runBase = () => { const t = performance.now(); const r = planPolicy53(pos.policy, structuredClone(pos.state), pos.p, W8); return { r, ms: performance.now() - t }; };
  const runFast = () => { const t = performance.now(); const r = withFastClone(() => planPolicy53(pos.policy, process.env.V62_VIEW === '0' ? structuredClone(pos.state) : planningView(pos.state), pos.p, W8)); return { r, ms: performance.now() - t }; };
  const b1 = runBase(), f1 = runFast(), b2 = runBase(), f2 = runFast();
  const base = b1.r, fast = f1.r, baseMs = Math.min(b1.ms, b2.ms), fastMs = Math.min(f1.ms, f2.ms);
  if (sig(b2.r) !== sig(base) || sig(f2.r) !== sig(fast)) throw new Error('a decision is not deterministic');
  const row = { game: pos.game, turn: pos.turn, policy: pos.policy, baseMs: Math.round(baseMs), fastMs: Math.round(fastMs), speedup: Math.round((baseMs / fastMs) * 100) / 100, identical: sig(base) === sig(fast) };
  rows.push(row); console.log(JSON.stringify(row));
}
writeFileSync(join(ROOT, process.env.V62_OUT || 'evidence/v6/v6-2-optimised.json'), JSON.stringify({ schema: 'rule-sabotage/v6-2-fastclone@1', arm: process.env.V62_VIEW === '0' ? 'fast state copy only' : 'fast state copy + planning view (+ the engine key/teleport optimisations in this build)', note: 'Interleaved base/optimised/base/optimised, min of each arm. Same positions as the profile (3 slowest recorded per policy). identical = chosen plan, full ranking, sims and candidate count equal.', rows }, null, 1) + '\n');
