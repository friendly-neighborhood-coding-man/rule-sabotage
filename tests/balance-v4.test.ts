/**
 * Balance Designer V4 unit tests: the expected-value teleport planner candidate (server/balance/v4/evplanner.ts) and
 * the engine-owned chance helpers. No Kane, no network, no LLM. Nothing here changes production behaviour.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
process.env.KANE_REFEREE = 'off';

const E = await import('../server/engine.ts');
const { init, applyPlacement, applyMove, legalMoves, teleportDestinations, teleportIndexProbabilities, rand, key, parseKey } = E;
const { makeEffect } = await import('../server/rules.ts');
const { planTurn, planMoves } = await import('../server/ai.ts');
const V4 = await import('../server/balance/v4/evplanner.ts');
const { playGame } = await import('../server/balance/selfplay.ts');
const { replayDetail, importGraph, ROOT } = await import('../server/balance/v3/batch.ts');
const { loadWeights } = await import('../server/weights.ts');
type State = import('../server/engine.ts').State;

const W = loadWeights();
const tp = makeEffect('teleport');
/** A board where the side to move (human) has teleport traps right in front of its pieces. */
function teleportBoard(seed: number, cells = ['1,1', '1,3', '1,5']): State {
  const s = init(seed, { first: 'human' });
  s.current = 'ai'; s.phase = 'place';
  applyPlacement(s, 'ai', { text: 'Any piece entering here is teleported to a random square.', effect: tp, cells, interpretedBy: 'test' });
  s.current = 'human'; s.phase = 'place'; s.actionsLeft = 3;
  return s;
}
/** Find an RNG state whose next engine draw picks index i of n (so a real applyMove lands on destination i). */
function rngForIndex(i: number, n: number, start = 12345): number {
  for (let r = start; ; r++) { const t = { rng: r } as State; if (rand(t) % n === i) return r; }
}
const piecesKey = (s: State) => JSON.stringify(s.pieces.map(q => [q.id, q.x, q.y, q.scored, q.frozen, q.shield]));

// ---------------- exact outcome distribution ----------------

test('teleport index probabilities are the exact law of rand() % n (sum 1, within 1e-9 of 1/n) and match an empirical draw', () => {
  for (const n of [1, 2, 3, 7, 13, 25, 31, 35]) {
    const p = teleportIndexProbabilities(n);
    assert.equal(p.length, n);
    assert.ok(Math.abs(p.reduce((a, b) => a + b, 0) - 1) < 1e-12, `sum for n=${n}`);
    for (const x of p) assert.ok(Math.abs(x - 1 / n) < 1e-9, `n=${n}`);
  }
  // Same counting formula on a small modulus, checked by brute force: N = 1000 values 1..N, n = 7.
  const N = 1000, n = 7, counts = Array(n).fill(0);
  for (let x = 1; x <= N; x++) counts[x % n]++;
  counts.forEach((c, i) => assert.equal(c, i === 0 ? Math.floor(N / n) : Math.floor((N - i) / n) + 1));
  // Empirical: 200k engine draws mod 25 stay within 5 standard errors of the exact law.
  const t = { rng: 987654321 } as State, k = 25, hits = Array(k).fill(0), draws = 200_000, pk = teleportIndexProbabilities(k);
  for (let i = 0; i < draws; i++) hits[rand(t) % k]++;
  hits.forEach((h, i) => { const se = Math.sqrt(draws * pk[i] * (1 - pk[i])); assert.ok(Math.abs(h - draws * pk[i]) < 5 * se, `index ${i}: ${h}`); });
});

test('teleportDestinations is the engine’s own choice set: the real move always lands on destinations[rng % n]', () => {
  for (const seed of [11, 12, 13, 14, 15, 16]) {
    const s = teleportBoard(seed);
    for (const m of legalMoves(s, 'human').filter(m => m.dir === 'right')) {
      const t = structuredClone(s);
      const from = parseKey(m.from), into = key(from.x + 1, from.y);
      if (!t.cells[into]) continue;
      // destinations are computed after the piece stands on the burned trap cell
      const probe = structuredClone(s); const q = probe.pieces.find(x => !x.scored && x.owner === 'human' && key(x.x, x.y) === m.from)!;
      q.x = from.x + 1; delete probe.cells[into];
      const dests = teleportDestinations(probe, { x: q.x, y: q.y });
      const r0 = structuredClone(t); const idx = rand(r0) % dests.length;
      const ev = applyMove(t, 'human', m);
      const f = ev.find(e => e.t === 'forced' && e.how === 'teleport') as { to: string } | undefined;
      assert.ok(f, 'teleport fired');
      assert.equal(f!.to, dests[idx], `seed ${seed} ${m.from}`);
      assert.ok(!dests.some(k => k.startsWith('0,') || k.startsWith('6,')), 'never an edge column');
      assert.ok(dests.every(k => !t.cells[k] || k === f!.to), 'no square with a live effect');
    }
  }
});

test('moveOutcomes enumerates every legal destination exactly once with the engine law, and each outcome equals a real engine run', () => {
  const s = teleportBoard(21);
  const m = legalMoves(s, 'human').find(x => x.from === '0,3' && x.dir === 'right')!;
  const rngBefore = s.rng, snapshot = JSON.stringify(s);
  const outs = V4.moveOutcomes(s, 'human', m);
  assert.equal(JSON.stringify(s), snapshot, 'input state untouched'); assert.equal(s.rng, rngBefore);
  assert.ok(outs.length > 20, `${outs.length} outcomes`);
  assert.ok(Math.abs(outs.reduce((a, o) => a + o.p, 0) - 1) < 1e-12);
  assert.equal(new Set(outs.map(o => o.destination)).size, outs.length, 'no duplicates');
  const pr = teleportIndexProbabilities(outs.length);
  outs.forEach((o, i) => {
    assert.equal(o.p, pr[i]);
    const real = structuredClone(s); real.rng = rngForIndex(i, outs.length);
    applyMove(real, 'human', m);
    assert.equal(piecesKey(o.state), piecesKey(real), `outcome ${i} (${o.destination}) equals the real engine`);
  });
  // a deterministic move has exactly one outcome with p = 1
  const det = legalMoves(s, 'human').find(x => x.from === '0,3' && x.dir === 'up')!;
  const d = V4.moveOutcomes(s, 'human', det);
  assert.equal(d.length, 1); assert.equal(d[0].p, 1); assert.equal(d[0].random, false);
  // and the outcomes do not depend on the hidden RNG at all
  const s2 = structuredClone(s); s2.rng = 0xdeadbeef;
  assert.deepEqual(V4.moveOutcomes(s2, 'human', m).map(o => [o.p, o.destination, piecesKey(o.state)]), outs.map(o => [o.p, o.destination, piecesKey(o.state)]));
});

test('the same-column rule variant (R1) is enumerated through the same engine helper', () => {
  const s = init(5, { first: 'human', variant: { id: 'r1', experimental: E.EXPERIMENTAL_RULE_VARIANT, teleport: 'same-column' } });
  s.current = 'ai'; s.phase = 'place'; applyPlacement(s, 'ai', { text: 't', effect: tp, cells: ['1,3'], interpretedBy: 'test' }); s.current = 'human'; s.phase = 'move'; s.actionsLeft = 3;
  const outs = V4.moveOutcomes(s, 'human', { from: '0,3', dir: 'right', mode: 'stack' });
  assert.ok(outs.length >= 5 && outs.every(o => parseKey(o.destination!).x === 1));
});

// ---------------- no hidden information ----------------

const RNGS = [1, 0x2545f491, 0x9e3779b9, 0xcafebabe, 4242];
test('hidden-RNG invariance: identical public state + different hidden RNG => identical EV decisions and values (production differs)', () => {
  let productionDiffered = 0;
  for (const [seed, cells] of [[31, ['1,1']], [32, ['1,3', '2,5']]] as [number, string[]][]) {
    const base = teleportBoard(seed, cells);
    const plans = RNGS.map(r => { const s = structuredClone(base); s.rng = r; return { ev: V4.planTurnEV(s, { me: 'human', weights: W }), nx: V4.nextMovesEV(s, 'human', W), prod: planMoves(s, 'human', 0, Math.random, W).moves }; });
    const sig = (p: typeof plans[number]) => JSON.stringify({ chosen: p.ev.chosen.id, ranked: p.ev.ranked.map(c => [c.summary, c.score.toFixed(9), c.afterReply.toFixed(9)]), nx: p.nx });
    for (const p of plans) assert.equal(sig(p), sig(plans[0]), `seed ${seed}: EV plan depends on the hidden RNG`);
    if (new Set(plans.map(p => JSON.stringify(p.prod))).size > 1) productionDiffered++;
  }
  assert.ok(productionDiffered >= 1, 'power check: the production planner DOES change its moves with the hidden RNG on these boards');
});

test('the EV value of a random move is the probability-weighted average of its outcomes (not the best or the realized one)', () => {
  const s = V4.maskHidden(teleportBoard(41));
  const m = legalMoves(s, 'human').find(x => x.from === '0,1' && x.dir === 'right')!;
  const outs = V4.moveOutcomes(s, 'human', m);
  const vals = outs.map(o => evalHuman(o.state));
  const avg = outs.reduce((a, o, i) => a + o.p * vals[i], 0);
  assert.ok(Math.max(...vals) - avg > 0.5, 'outcomes really differ (best realization is much better than average)');
  // greedyEV picks by expected value: with only this move vs standing still, its value must equal the average.
  const g = V4.greedyEV(s, 'human', V4.newCtx(W), 0);
  if (g.moves.length && g.moves[0].from === m.from && g.moves[0].dir === m.dir && g.pending) assert.ok(Math.abs(g.expected - avg) < 1e-9);
});
const { evaluate } = await import('../server/ai.ts');
function evalHuman(s: State) { return evaluate(s, 'human', W); }

test('the committed move sequence ends at the first random move (no moves that assume an unresolved destination)', () => {
  let sawChance = 0;
  for (const seed of [51, 52, 53, 54, 55, 56]) {
    const s = teleportBoard(seed);
    const nx = V4.nextMovesEV(s, 'human', W);
    const t = structuredClone(s);
    nx.moves.forEach((m, i) => {
      const outs = V4.moveOutcomes(V4.maskHidden(t), 'human', m);
      if (i < nx.moves.length - 1) assert.equal(outs.length, 1, `move ${i} is random but more moves follow it`);
      else if (nx.endsAtChance) { assert.ok(outs.length > 1); sawChance++; }
      applyMove(t, 'human', m);
    });
  }
  assert.ok(sawChance >= 1, 'at least one board exercised a random final move');
});

test('production planner is untouched: planTurn / planMoves give the same result as the V3-recorded decisions on a V3 game', () => {
  // Replays a recorded V3 validation game (arm A, production planner) and re-plans each turn with the production
  // planner: the ranked candidate list and chosen id must match the record exactly.
  const dir = join(ROOT, 'evidence/balance/v3/datasets/2026-11-19T15-56-36Z-v3-screen/games');
  const rec = JSON.parse(readFileSync(join(dir, 'A-62101-human.json'), 'utf8')).rec;
  const d = rec.detail;
  const s = init(d.seed, { first: d.first, start: { id: d.start.id, experimental: E.EXPERIMENTAL_START_CONFIG, pieces: { firstMover: d.start.count[d.first], secondMover: d.start.count[d.first === 'human' ? 'ai' : 'human'] }, layout: d.start.layout } });
  let checked = 0;
  for (const t of d.turns.slice(0, 6)) {
    const plan = planTurn(s, { me: t.p, weights: W });
    assert.equal(plan.chosen.id, t.chosen, `turn ${t.turn}`);
    assert.deepEqual(plan.ranked.map((c: { summary: string; score: number }) => [c.summary, Math.round(c.score * 1000) / 1000]), t.candidates.map((c: { summary: string; score: number }) => [c.summary, c.score]));
    checked++;
    // advance with the recorded actions (engine only)
    const r = replayStep(s, t);
    if (!r) break;
  }
  assert.ok(checked >= 4);
});
const { effectFromId } = await import('../server/weights.ts');
function replayStep(s: State, t: { p: 'human' | 'ai'; placement: { effect: string; cells: string[] } | null; moves: { from: string; dir: 'up' | 'down' | 'left' | 'right'; mode: 'stack' | 'single' }[] }) {
  if (t.placement) applyPlacement(s, t.p, { text: 'planner', effect: effectFromId(t.placement.effect)!, cells: t.placement.cells, interpretedBy: 'planner' });
  if (s.phase === 'place') s.phase = 'move';
  for (const m of t.moves) applyMove(s, t.p, { from: m.from, dir: m.dir, mode: m.mode });
  if (s.winner) return false;
  E.endTurn(s); return !s.winner;
}

test('evaluateCached is exactly the production evaluate()', () => {
  const ctx = V4.newCtx(W);
  for (const seed of [61, 62, 63]) {
    const s = teleportBoard(seed);
    for (const m of legalMoves(s, 'human')) for (const o of V4.moveOutcomes(s, 'human', m)) for (const me of ['human', 'ai'] as const) assert.equal(V4.evaluateCached(o.state, me, ctx), evaluate(o.state, me, W));
  }
});

test('reply stratification (the one approximation) keeps the full mass and stays close to exact replies', () => {
  const ctx = V4.newCtx(W, 8);
  const ends = Array.from({ length: 30 }, (_, i) => ({ p: 1 / 30, v: i * i, state: { i } as never }));
  const st = V4.stratify(ends, ctx);
  assert.equal(st.length, 8); assert.ok(Math.abs(st.reduce((a, e) => a + e.p, 0) - 1) < 1e-12);
  assert.equal(V4.stratify(ends.slice(0, 8), ctx).length, 8, 'exact when <= 8 end states');
  // whole-turn scores with 8 strata vs exact replies on a teleport board: same ranking leader, small score error
  const s = teleportBoard(71, ['1,3']);
  assert.equal(V4.REPLY_STRATA, 16);
  const a = V4.planTurnEV(s, { me: 'human', weights: W }), b = V4.planTurnEV(s, { me: 'human', weights: W, replyStrata: 1e9 });
  const err = Math.max(...a.ranked.map(c => Math.abs(c.score - b.ranked.find(x => x.summary === c.summary)!.score)));
  console.log(`[v4-stratify] candidates approximated ${a.approximatedCandidates}, max |score error| ${err.toFixed(4)}, leader ${a.ranked[0].summary} / exact ${b.ranked[0].summary}`);
  assert.ok(err < 0.4, `max score error ${err}`);
  assert.equal(a.ranked[0].summary, b.ranked[0].summary, 'same leading plan as exact replies');
});

// ---------------- replay, determinism, isolation ----------------

test('an EV-candidate self-play game is deterministic and replays move for move through the engine alone', { timeout: 600_000 }, () => {
  const job = (planner: Record<string, 'ev-v4'>) => playGame(99101, 'ai', { human: W, ai: W }, { detail: true, planner: planner as never, maxMs: 300_000 });
  const a = job({ human: 'ev-v4' }), b = job({ human: 'ev-v4' });
  assert.equal(a.detail!.finalHash, b.detail!.finalHash, 'same seed, same planners => same game');
  assert.deepEqual(a.planners, { human: V4.EV_PLANNER_ID });
  const r = replayDetail(a);
  assert.ok(r.ok, r.problems.join('; '));
  assert.equal(a.illegal.length + a.errors.length, 0);
});

test('production isolation: game.ts / server.ts never reach the candidate; selfplay uses it only when asked', () => {
  for (const entry of ['server/game.ts', 'server/server.ts', 'server/ai.ts', 'server/trial.ts']) {
    const g = importGraph(entry);
    assert.ok(!g.files.includes('server/balance/v4/evplanner.ts'), `${entry} imports the candidate`);
  }
  assert.ok(!/evplanner|planTurnEV|ev-v4/.test(readFileSync(join(ROOT, 'server/game.ts'), 'utf8')));
  assert.match(V4.evPlannerHash(), /^[0-9a-f]{16}$/);
});
