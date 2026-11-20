/**
 * V5.1: profile oa-v2's real computation on recorded positions of the 4 games that hit the 30-min limit and of normal OA
 * games (no game played). For each decision: wall time split into candidate generation / own move phase / worst-case
 * search, and the work counters that drive it (candidates, own end states, strata kept, opponent options, greedy sims).
 *   npm run balance:v51:oa-profile -> evidence/balance/v5_1/oa-profile.json
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from '../server/balance/v3/batch.ts';
import { loadV5 } from '../server/balance/v5_1/reanalysis.ts';
import { init, applyPlacement, applyMove, endTurn, type Dir, type Move, type State } from '../server/engine.ts';
import { effectFromId, loadWeights } from '../server/weights.ts';
import { maskHidden, newCtx } from '../server/balance/v4/evplanner.ts';
import { candidatePlacements, greedy11, ownEnds11, stratify11, byScoreThenCanon, K1 } from '../server/balance/v5/evk11.ts';
import { worstAnswer, PARAMS } from '../server/balance/v5/policies.ts';
import { type Player } from '../server/rules.ts';
const w = loadWeights(), log = (s: string) => console.log(`[${new Date().toISOString()}] ${s}`);
const games = loadV5(join(ROOT, 'evidence/balance/v5/2026-11-20T16-11-56Z-v5'));
const SLOW = ['S-OA-68001-ai', 'S-OA-68009-ai', 'S-OA-68014-human', 'S-OA-68030-human'], NORMAL = ['S-OA-68002-human', 'S-OA-68005-ai'];

function profile(s0: State, me: Player) {
  const T = (f: () => void) => { const t = performance.now(); f(); return performance.now() - t; };
  const s = maskHidden(s0), ctx = newCtx(w, PARAMS.oa.strata, K1); ctx.me = me;
  let cands: ReturnType<typeof candidatePlacements> = [], pre: { ends: ReturnType<typeof ownEnds11>; c: unknown }[] = [];
  const tCand = T(() => { cands = candidatePlacements(s, me, w); });
  const tOwn = T(() => { pre = cands.map(pl => { const st = structuredClone(s); if (pl) applyPlacement(st, me, pl); st.phase = 'move'; const first = greedy11(st, me, ctx); return { ends: ownEnds11(st, me, ctx), c: { placement: pl, moves: first.moves, score: 0, id: '', afterReply: 0, summary: '' } }; }); });
  const ownEnds = pre.map(x => x.ends.length);
  const top = pre.map(x => ({ ...x, v: x.ends.reduce((a, e) => a + e.p * e.v, 0) })).sort((a, b) => byScoreThenCanon(me)({ ...(a.c as object), score: a.v } as never, { ...(b.c as object), score: b.v } as never)).slice(0, PARAMS.oa.topN);
  let kept = 0, oppOptions = 0; const simsBefore = ctx.sims;
  const tWorst = T(() => { for (const x of top) { const ends = stratify11(x.ends, me, PARAMS.oa.strata); kept += ends.length; for (const e of ends) { const rep = structuredClone(e.state); endTurn(rep); if (!rep.winner && rep.current !== me) oppOptions += candidatePlacements(rep, rep.current, w).length; worstAnswer(e.state, me, ctx); } } });
  return { ms: Math.round(tCand + tOwn + tWorst), msCandidates: Math.round(tCand), msOwnMovePhase: Math.round(tOwn), msWorstCase: Math.round(tWorst), candidates: cands.length, ownEndStatesTotal: ownEnds.reduce((a, b) => a + b, 0), ownEndStatesMax: Math.max(...ownEnds), strataKept: kept, opponentOptionsEvaluated: oppOptions, greedySimsInWorstCase: ctx.sims - simsBefore, liveEffects: Object.keys(s.cells).length, piecesOnBoard: s.pieces.filter(q => !q.scored).length };
}
const out: Record<string, unknown> = { newGamesPlayed: 0, note: 'times are on this PC with nothing else running; the run used 6 parallel workers, so in-run times were higher' };
for (const id of [...SLOW, ...NORMAL]) {
  const g = games.find(x => x.gameId === id)!, d = g.rec.detail!, s = init(d.seed, { first: d.first }), rows: unknown[] = [];
  for (const t of d.turns) {
    if (t.turn % 3 === 1 || SLOW.indexOf(id) < 0) { const r = profile(s, t.p); rows.push({ turn: t.turn, p: t.p, ...r }); log(`${id} t${t.turn}: ${JSON.stringify(r)}`); }
    if (t.placement) applyPlacement(s, t.p, { text: 'planner', effect: effectFromId(t.placement.effect)!, cells: t.placement.cells, interpretedBy: 'planner' });
    if (s.phase === 'place') s.phase = 'move';
    for (const m of t.moves) applyMove(s, t.p, { from: m.from, dir: m.dir as Dir, mode: m.mode as Move['mode'] });
    if (s.winner) break; endTurn(s);
  }
  out[id] = { slow: SLOW.includes(id), turnsPlayed: d.turns.length, recordedMs: g.rec.ms, errors: g.rec.errors, profiled: rows };
}
writeFileSync(join(ROOT, 'evidence/balance/v5_1/oa-profile.json'), JSON.stringify(out, null, 2));
log('written');
