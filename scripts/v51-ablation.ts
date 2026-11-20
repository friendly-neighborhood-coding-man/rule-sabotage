/**
 * V5.1 ablation (offline, 0 Kane, 0 external calls):
 *   npm run balance:v51:ablation -- preflight      6 smoke games on throwaway seeds 99801-99806 (one per arm): replay, agreement
 *   npm run balance:v51:ablation -- preregister    freeze (needs preflight + trace equivalence, clean tree)
 *   npm run balance:v51:ablation -- run            exactly 96 games, once
 *   npm run balance:v51:ablation -- evaluate <dir>
 */
import { writeFileSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { ROOT, replayDetail } from '../server/balance/v3/batch.ts';
import { playGame } from '../server/balance/selfplay.ts';
import { loadWeights } from '../server/weights.ts';
import { moveOutcomes, maskHidden } from '../server/balance/v4/evplanner.ts';
import { init, applyPlacement, applyMove, endTurn, type Dir, type Move } from '../server/engine.ts';
import { effectFromId } from '../server/weights.ts';
const A = await import('../server/balance/v5_1/ablrun.ts');
const PRE = join(ROOT, 'evidence/balance/v5_1/ablation-preflight.json');
const [cmd, arg] = process.argv.slice(2);
if (cmd === 'preflight') {
  const w = loadWeights(), trace = JSON.parse(readFileSync(join(ROOT, 'evidence/balance/v5_1/trace.json'), 'utf8'));
  const jobs = A.ablJobs().filter(j => j.seed === 69001 && j.first === 'human'), rows: unknown[] = [];
  jobs.forEach((j, i) => {
    const t0 = Date.now(), { gameId: _g, condition: _c, arm, ...job } = j as never as Record<string, unknown> & { arm: string };
    const opts = { detail: true, ...(job.planner ? { planner: job.planner, evVariant: job.evVariant } : {}), ...(job.ablation ? { ablation: job.ablation } : {}), ...(job.policy ? { policy: job.policy } : {}) } as never;
    const r = playGame(99801 + i, 'human', { human: w, ai: w }, opts);
    // corrected agreement (a move counts as random only if it has more than one legal outcome)
    const d = r.detail!, s = init(d.seed, { first: d.first }); let turns = 0, agree = 0;
    for (const t of d.turns) {
      if (t.placement) applyPlacement(s, t.p, { text: 'planner', effect: effectFromId(t.placement.effect)!, cells: t.placement.cells, interpretedBy: 'planner' }); if (s.phase === 'place') s.phase = 'move';
      const exec: string[] = []; let cut = false;
      for (const m of t.moves) { const mv = { from: m.from, dir: m.dir as Dir, mode: m.mode as Move['mode'] }; if (!cut) exec.push(`${m.from}${m.dir}${m.mode}`); if (moveOutcomes(maskHidden(s), t.p, mv).length > 1) cut = true; applyMove(s, t.p, mv); }
      if (t.plannedMoves) { turns++; if (JSON.stringify(exec) === JSON.stringify(t.plannedMoves.map(m => `${m.from}${m.dir}${m.mode}`))) agree++; }
      if (s.winner) break; endTurn(s);
    }
    rows.push({ arm, seed: 99801 + i, winner: r.winner, turns: r.turns, ms: Date.now() - t0, replayOk: replayDetail(r).ok, plannedTurns: turns, agree, errors: r.errors, illegal: r.illegal });
    console.log(JSON.stringify(rows[rows.length - 1]));
  });
  // Plan = execution is REQUIRED only for arms that claim it (C4 and the full ev-k1.1). Without C4 the planner plans with
  // 0.02 noise and executes without it, so disagreement there is the historical behaviour being ablated (reported, not a failure).
  const ok = rows.every((x: any) => x.replayOk && !x.errors.length && !x.illegal.length && (!['C4', 'K11'].includes(x.arm) || x.agree === x.plannedTurns)) && trace.equivalence.armK1EqualsFrozenEvK1 === trace.equivalence.states && trace.equivalence.armK11EqualsEvK11 === trace.equivalence.states;
  writeFileSync(PRE, JSON.stringify({ smoke: rows, traceEquivalence: trace.equivalence, pass: ok }, null, 2));
  console.log(`preflight ${ok ? 'PASS' : 'FAIL'}`);
} else if (cmd === 'preregister') { const p = JSON.parse(readFileSync(PRE, 'utf8')); if (!p.pass) throw new Error('preflight did not pass: not preregistering'); const e = A.preregister(PRE); console.log(`preregistered #${e.seq}`, JSON.stringify({ ...(e.data as object), assignments: '[96]' })); }
else if (cmd === 'run') await A.runAblation();
else if (cmd === 'evaluate') { const e = A.evaluateAblation(resolve(arg)); console.log(JSON.stringify({ candidateCauses: e.candidateCauses })); }
else { console.log('usage: preflight | preregister | run | evaluate <dir>'); process.exit(2); }
