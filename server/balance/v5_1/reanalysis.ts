/**
 * V5.1 offline reanalysis of the 300 stored V5 games (versioned 'reanalysis-1'). The original V5 metrics and
 * evaluation.json stay untouched; this computes NEW, separately named measures. No game is played.
 *
 * Strategy versus RNG diversity:
 *  - firstTurnChoice: what the first mover CHOSE on turn 1 (placement + committed moves, side-relative), per policy.
 *  - firstTurnEffects / firstTurnCellSets: diversity of the turn-1 effect and of its cell set.
 *  - conditionalActionDiversity: turns grouped by IDENTICAL observable state (side-relative, incl. turn number); in groups
 *    seen at least twice, how many distinct decisions were made (1 = the policy is a function of the public state).
 *  - postChanceResponses: after a random teleport, grouped by (state before the move, the move): number of distinct
 *    destinations vs distinct follow-up decisions (responses determined by what became visible).
 *  - strategicPrefixes: distinct decision sequences up to the first random outcome (over the first two turns), versus V5's
 *    "distinct two-turn openings", which also counted different random destinations as different openings.
 *  - corrected plan/execution agreement: moves compared up to the first move with more than one legal outcome (a
 *    teleport with a single destination is deterministic).
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { type State, type Move, type Dir, init, applyPlacement, applyMove, endTurn } from '../../engine.ts';
import { type Player } from '../../rules.ts';
import { effectFromId } from '../../weights.ts';
import { type GameRec } from '../selfplay.ts';
import { moveOutcomes, maskHidden } from '../v4/evplanner.ts';
import { canonicalState, canonicalPlan } from '../v5/evk11.ts';
import { entropy, r3 } from '../v3/stats.ts';

export type V5Game = { gameId: string; arm: string; policies: Record<Player, string>; rec: GameRec };
export const loadV5 = (dir: string): V5Game[] => readdirSync(join(dir, 'games')).sort().map(f => JSON.parse(readFileSync(join(dir, 'games', f), 'utf8')));

type TurnView = { turn: number; p: Player; policy: string; stateKey: string; decision: string; placement: string; cells: string; moves: { m: Move; random: boolean; destination: string | null }[]; planned: string[] | null };
/** Replay a game through the engine and describe every turn side-relatively (state at turn start, decision, moves). */
export function turns(g: V5Game): TurnView[] {
  const d = g.rec.detail!, s = init(d.seed, { first: d.first }), out: TurnView[] = [];
  for (const t of d.turns) {
    const start = structuredClone(s);
    const pl = t.placement ? { text: 'planner', effect: effectFromId(t.placement.effect)!, cells: t.placement.cells, interpretedBy: 'planner' } : null;
    if (pl) applyPlacement(s, t.p, pl);
    if (s.phase === 'place') s.phase = 'move';
    const moves: TurnView['moves'] = [];
    for (const m of t.moves) {
      const mv = { from: m.from, dir: m.dir as Dir, mode: m.mode as Move['mode'] };
      const random = moveOutcomes(maskHidden(s), t.p, mv).length > 1;
      const ev = applyMove(s, t.p, mv);
      const f = ev.find(e => e.t === 'forced' && e.how === 'teleport') as { to: string } | undefined;
      moves.push({ m: mv, random, destination: f?.to ?? null });
    }
    const firstRandom = moves.findIndex(x => x.random);
    const committed = moves.slice(0, firstRandom >= 0 ? firstRandom + 1 : moves.length).map(x => x.m);
    const decision = canonicalPlan(t.p, { placement: pl, moves: committed });
    out.push({ turn: t.turn, p: t.p, policy: g.policies[t.p], stateKey: `${t.turn}#${canonicalState(start, t.p)}`, decision, placement: decision.split('|')[0], cells: decision.split('|')[0].split('@')[1] ?? '', moves, planned: t.plannedMoves ? t.plannedMoves.map(m => `${m.from}${m.dir}${m.mode}`) : null });
    if (s.winner) break;
    endTurn(s);
  }
  return out;
}
const counts = (xs: string[]) => [...xs.reduce((m, k) => m.set(k, (m.get(k) ?? 0) + 1), new Map<string, number>()).values()];
const div = (xs: string[]) => { const c = counts(xs); return { n: xs.length, distinct: c.length, entropyBits: r3(entropy(c)), largestShare: xs.length ? r3(Math.max(...c) / xs.length) : null }; };

export function reanalyse(games: V5Game[]) {
  const views = games.map(g => ({ g, t: turns(g) }));
  const byArm = new Map<string, typeof views>(); for (const v of views) byArm.set(v.g.arm, [...(byArm.get(v.g.arm) ?? []), v]);
  const arms = Object.fromEntries([...byArm.entries()].map(([arm, vs]) => {
    const t1 = vs.map(v => v.t[0]);
    // strategic prefix: decisions (placement + committed moves) of turns 1-2, cut at the first random outcome
    const prefix = vs.map(v => { const parts: string[] = []; for (const t of v.t.slice(0, 2)) { parts.push(t.decision); if (t.moves.some(x => x.random)) break; } return parts.join(' / '); });
    const realized2 = vs.map(v => v.t.slice(0, 2).map(t => `${t.decision}>${t.moves.map(x => x.destination ?? '').join(',')}`).join(' / '));
    // conditional diversity per policy
    const groups = new Map<string, Set<string>>(); const seen = new Map<string, number>();
    for (const v of vs) for (const t of v.t) { const k = `${t.policy}|${t.stateKey}`; seen.set(k, (seen.get(k) ?? 0) + 1); (groups.get(k) ?? groups.set(k, new Set()).get(k)!).add(t.decision); }
    const rep = [...groups.entries()].filter(([k]) => (seen.get(k) ?? 0) >= 2);
    // post-chance responses
    const post = new Map<string, { dest: Set<string>; resp: Set<string> }>();
    for (const v of vs) v.t.forEach((t, i) => t.moves.forEach((x, j) => { if (!x.random) return; const k = `${t.policy}|${t.stateKey}|${t.decision}`; const e = post.get(k) ?? post.set(k, { dest: new Set(), resp: new Set() }).get(k)!; e.dest.add(x.destination ?? 'none'); e.resp.add(`${x.destination}>${t.moves.slice(j + 1).map(y => `${y.m.from}${y.m.dir}`).join(' ')}`); void i; }));
    const postMulti = [...post.values()].filter(e => e.dest.size >= 2);
    // corrected agreement
    let turnsChecked = 0, agree = 0;
    for (const v of vs) for (const t of v.t) { if (!t.planned) continue; turnsChecked++; const fr = t.moves.findIndex(x => x.random); const exec = t.moves.slice(0, fr >= 0 ? fr + 1 : t.moves.length).map(x => `${x.m.from}${x.m.dir}${x.m.mode}`); if (JSON.stringify(exec) === JSON.stringify(t.planned)) agree++; }
    return [arm, {
      games: vs.length, policies: [...new Set(vs.flatMap(v => Object.values(v.g.policies)))],
      firstTurnChoice: div(t1.map(t => t.decision)), firstTurnEffects: div(t1.map(t => t.placement.split('@')[0])), firstTurnCellSets: div(t1.map(t => t.placement)),
      strategicPrefixes: div(prefix), realizedTwoTurnTrajectories: div(realized2),
      conditionalActionDiversity: { repeatedStates: rep.length, statesWithMoreThanOneDecision: rep.filter(([, d]) => d.size > 1).length, maxDecisionsInOneState: rep.length ? Math.max(...rep.map(([, d]) => d.size)) : 0 },
      postChanceResponses: { randomMovesWithSeveralSeenDestinations: postMulti.length, meanDistinctDestinations: postMulti.length ? r3(postMulti.reduce((a, e) => a + e.dest.size, 0) / postMulti.length) : null, meanDistinctResponses: postMulti.length ? r3(postMulti.reduce((a, e) => a + e.resp.size, 0) / postMulti.length) : null, responsesPerDestination: postMulti.length ? r3(postMulti.reduce((a, e) => a + e.resp.size / e.dest.size, 0) / postMulti.length) : null },
      correctedPlanExecutionAgreement: { turns: turnsChecked, agree, rate: turnsChecked ? r3(agree / turnsChecked) : null },
    }];
  }));
  return { schema: 'rule-sabotage/v5-reanalysis@1', version: 'reanalysis-1', arms };
}
export type { State };
