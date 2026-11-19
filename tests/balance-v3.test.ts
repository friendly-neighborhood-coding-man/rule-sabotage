/**
 * Balance Designer V3 unit tests (no Kane, no network). They prove the starting-configuration contract, the
 * normalized outcome rule, production isolation, the offline guard, determinism and engine replay, and the
 * proposal/catalog/acceptance rules. Kane appears only as the TEST DOUBLE, if at all.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.KANE_REFEREE = 'off';
const E = await import('../server/engine.ts');
const W = await import('../server/weights.ts');
const { playGame } = await import('../server/balance/selfplay.ts');
const B = await import('../server/balance/v3/batch.ts');
const P = await import('../server/balance/v3/proposals.ts');
const St = await import('../server/balance/v3/stats.ts');
const A = await import('../server/balance/v3/analysis.ts');
const K3 = await import('../server/balance/v3/kane3.ts');
type Player = 'human' | 'ai';

const root = fileURLToPath(new URL('../', import.meta.url));
const src = (f: string) => readFileSync(join(root, f), 'utf8');
const w = W.loadWeights();
const fw = { human: w, ai: w };
const cfg = (fm: number, sm: number, extra: Partial<import('../server/engine.ts').StartingConfiguration> = {}) => ({ id: `T${fm}${sm}`, experimental: E.EXPERIMENTAL_START_CONFIG, pieces: { firstMover: fm, secondMover: sm }, layout: 'spread' as const, ...extra });
const strip = (r: unknown) => { const { ms: _m, start: _s, ...x } = r as Record<string, unknown>; return JSON.stringify({ ...x, reason: String(x.reason).replace(/ \(normalized\)/, '') }); };

// ---------------------------------------------------------------- starting configuration contract
test('a starting configuration must carry the experimental token and stay inside 2..4 pieces', () => {
  assert.throws(() => E.init(1, { start: { ...cfg(3, 3), experimental: 'x' } as never }), /explicitly marked experimental/);
  assert.throws(() => E.init(1, { start: cfg(5, 3) }), /pieces.firstMover/);
  assert.throws(() => E.init(1, { start: cfg(3, 1) }), /pieces.secondMover/);
  assert.throws(() => E.init(1, { start: cfg(3, 3, { firstTurnActions: 0 }) }), /firstTurnActions/);
  assert.equal(E.init(1).start, undefined, 'production init has no starting configuration');
});

test('piece counts 2, 3, 4: stable ids, symmetric home rows, correct action allowance', () => {
  for (const n of [2, 3, 4]) for (const first of ['human', 'ai'] as Player[]) {
    const s = E.init(7, { first, start: cfg(n, n) });
    for (const p of ['human', 'ai'] as Player[]) {
      const ps = s.pieces.filter(q => q.owner === p);
      assert.equal(ps.length, n);
      assert.deepEqual(ps.map(q => q.id), Array.from({ length: n }, (_, i) => `${p === 'human' ? 'h' : 'a'}${i + 1}`));
      const rows = ps.map(q => q.y);
      assert.deepEqual(rows, [...rows].sort((a, b) => a - b));
      assert.deepEqual(rows.map(y => 6 - y).sort((a, b) => a - b), rows, `rows of ${n} pieces are mirror-symmetric`);
      for (const q of ps) { assert.equal(q.x, E.START_X[p]); assert.deepEqual(q.home, { x: q.x, y: q.y }); }
    }
    assert.equal(s.actionsLeft, n, 'actions = pieces on board (policy unchanged)');
    assert.equal(E.piecesOf(s, 'human'), n);
  }
});

test('asymmetric counts follow the FIRST MOVER, not the side (3/2 and 2/3, both sides starting)', () => {
  for (const first of ['human', 'ai'] as Player[]) {
    const second: Player = first === 'human' ? 'ai' : 'human';
    const a = E.init(11, { first, start: cfg(3, 2) });
    assert.equal(E.piecesOf(a, first), 3); assert.equal(E.piecesOf(a, second), 2); assert.equal(a.actionsLeft, 3);
    const b = E.init(11, { first, start: cfg(2, 3) });
    assert.equal(E.piecesOf(b, first), 2); assert.equal(E.piecesOf(b, second), 3); assert.equal(b.actionsLeft, 2);
    E.endTurn(b); assert.equal(b.current, second); assert.equal(b.actionsLeft, 3);
  }
});

test('first-turn action cap and second-mover bonus apply to exactly one turn each', () => {
  const s = E.init(5, { first: 'human', start: cfg(3, 3, { firstTurnActions: 1, secondMoverFirstTurnBonus: 2 }) });
  assert.equal(s.actionsLeft, 1);
  E.endTurn(s); assert.equal(s.current, 'ai'); assert.equal(s.actionsLeft, 5);
  E.endTurn(s); assert.equal(s.actionsLeft, 3);
  E.endTurn(s); assert.equal(s.actionsLeft, 3);
});

test('winner detection: all own pieces across wins, for 2, 3 and 4 pieces and unequal counts', () => {
  for (const [fm, sm] of [[2, 2], [3, 3], [4, 4], [3, 2], [2, 3]]) {
    const s = E.init(3, { first: 'human', start: cfg(fm, sm) });
    const hs = s.pieces.filter(q => q.owner === 'human');
    for (const q of hs.slice(1)) { q.scored = true; }
    const last = hs[0]; last.x = 5; last.y = 3; s.phase = 'move';
    assert.equal(s.winner, null);
    const ev = E.applyMove(s, 'human', { from: `5,3`, dir: 'right', mode: 'stack' });
    assert.equal(s.winner, 'human', `${fm}/${sm}`);
    assert.ok(ev.some(e => e.t === 'win' && /all \d pieces/.test(e.reason)));
    assert.match(s.winReason, new RegExp(`all ${fm} pieces`));
  }
  // with fewer pieces, scoring your whole (smaller) set wins even if the opponent has more across
  const s = E.init(3, { first: 'human', start: cfg(3, 2) });
  const ai = s.pieces.filter(q => q.owner === 'ai'); const hu = s.pieces.filter(q => q.owner === 'human');
  hu[0].scored = true; hu[1].scored = true; // human (3 pieces) has 2 across
  ai[0].scored = true; ai[1].x = 1; ai[1].y = 3; s.current = 'ai'; s.phase = 'move'; s.actionsLeft = 1; // ai (2 pieces) about to finish
  E.applyMove(s, 'ai', { from: '1,3', dir: 'left', mode: 'stack' });
  assert.equal(s.winner, 'ai');
});

test('normalized turn-limit tie-break: fraction across first, then fraction of journey left, then draw (exact integers)', () => {
  const atLimit = (fm: number, sm: number, setup: (s: import('../server/engine.ts').State) => void) => { const s = E.init(9, { first: 'human', start: cfg(fm, sm) }); s.turn = s.maxTurns; setup(s); E.endTurn(s); return s; };
  // 3 vs 2: human 1/3 across vs ai 1/2 across -> ai wins although the raw count is equal
  let s = atLimit(3, 2, s => { s.pieces.find(q => q.id === 'h1')!.scored = true; s.pieces.find(q => q.id === 'a1')!.scored = true; });
  assert.equal(s.winner, 'ai'); assert.match(s.winReason, /normalized/);
  // 4 vs 2: 2/4 vs 1/2 -> equal fractions; journeys decide: human 2 pieces at 6 squares left each = 12/24, ai 1 piece 3 left = 3/12
  s = atLimit(4, 2, s => { for (const id of ['h1', 'h2', 'a1']) s.pieces.find(q => q.id === id)!.scored = true; s.pieces.find(q => q.id === 'a2')!.x = 3; });
  assert.equal(s.winner, 'ai');
  // equal fractions and equal journey fractions -> draw
  s = atLimit(4, 2, s => { for (const id of ['h1', 'h2', 'a1']) s.pieces.find(q => q.id === id)!.scored = true; });
  assert.equal(s.winner, 'draw');
  // equal counts: identical to the production rule
  for (const seed of [1, 2, 3, 4]) {
    const mk = (start?: ReturnType<typeof cfg>) => { const t = E.init(seed, { first: 'human', ...(start ? { start } : {}) }); t.turn = t.maxTurns; t.pieces[seed % 6].x = 3; t.pieces[(seed + 2) % 6].scored = seed % 2 === 0; return t; };
    const a = mk(), b = mk(cfg(3, 3)); E.endTurn(a); E.endTurn(b);
    assert.equal(b.winner, a.winner, `seed ${seed}`);
  }
});

// ---------------------------------------------------------------- backward compatibility and determinism
test('3:3 experimental games reproduce production games exactly (both first movers)', () => {
  for (const seed of [41, 42]) for (const first of ['human', 'ai'] as Player[]) {
    const prod = playGame(seed, first, { human: W.freezeWeights(w), ai: W.freezeWeights(w) });
    const exp = playGame(seed, first, { human: W.freezeWeights(w), ai: W.freezeWeights(w) }, { start: cfg(3, 3) });
    assert.equal(strip(exp), strip(prod), `seed ${seed} ${first}`);
  }
});

test('fixed seed is deterministic and the recorded game replays move by move through the engine alone', () => {
  for (const [fm, sm] of [[2, 3], [4, 4]]) {
    const a = playGame(77, 'ai', { human: W.freezeWeights(w), ai: W.freezeWeights(w) }, { start: cfg(fm, sm), detail: true });
    const b = playGame(77, 'ai', { human: W.freezeWeights(w), ai: W.freezeWeights(w) }, { start: cfg(fm, sm), detail: true });
    assert.equal(JSON.stringify({ ...a, ms: 0 }), JSON.stringify({ ...b, ms: 0 }));
    const r = B.replayDetail(a);
    assert.ok(r.ok, r.problems.join('; '));
    assert.ok(a.detail!.turns.every(t => t.candidates.length >= 1 && t.candidates.some(c => c.id === t.chosen)));
    // a tampered record is caught
    const t = structuredClone(a); t.detail!.turns[0].moves[0].dir = t.detail!.turns[0].moves[0].dir === 'up' ? 'down' : 'up';
    assert.equal(B.replayDetail(t).ok, false);
  }
});

// ---------------------------------------------------------------- isolation and offline guarantees
test('production code never creates an experimental starting configuration', () => {
  for (const f of ['server/game.ts', 'server/server.ts', 'server/trial.ts', 'server/tiers.ts', 'server/kane.ts', 'client/app.js']) assert.ok(!/EXPERIMENTAL_START_CONFIG|StartingConfiguration|start:\s*\{\s*id/.test(src(f)), `${f} must not reference experimental starts`);
  assert.match(src('server/game.ts'), /state: init\(seed \?\? \(Date\.now\(\) & 0x7fffffff\)\)/, 'production games call init(seed) with no options');
});

test('the batch worker cannot reach game.ts, Kane, OpenRouter or tiers (static import graph)', () => {
  const c = B.offlineImportCheck();
  assert.ok(c.pass, JSON.stringify(c));
  for (const f of B.FORBIDDEN_MODULES) assert.ok(!c.files.includes(f));
  assert.ok(c.files.includes('server/balance/v3/offline.ts') && c.files.includes('server/ai.ts'));
});

test('the offline guard counts and blocks every outbound channel, and strips model keys', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'rs-v3-guard-'));
  const f = join(dir, 'probe.ts');
  writeFileSync(f, `process.env.GROQ_API_KEY='x'; process.env.OPENROUTER_API_KEY='y'; process.env.NVIDIA_API_KEY='z';
const { installOfflineGuard, guardReport } = await import(${JSON.stringify(new URL('../server/balance/v3/offline.ts', import.meta.url).href)});
installOfflineGuard();
const tries = [() => fetch('https://api.groq.com'), async () => (await import('node:https')).request('https://openrouter.ai'), async () => (await import('node:http')).get('http://example.com'), async () => (await import('node:net')).connect(443, 'x'), async () => (await import('node:child_process')).spawn('kane-cli', ['run'])];
let thrown = 0; for (const t of tries) { try { await t(); } catch { thrown++; } }
const r = guardReport(); console.log(JSON.stringify({ thrown, attempts: r.attempts, env: [process.env.GROQ_API_KEY, process.env.OPENROUTER_API_KEY, process.env.NVIDIA_API_KEY], stripped: r.strippedEnv }));`);
  const { execFileSync } = await import('node:child_process');
  const out = JSON.parse(execFileSync(process.execPath, ['--experimental-strip-types', '--no-warnings', f], { encoding: 'utf8' }).trim().split('\n').pop()!);
  assert.equal(out.thrown, 5); assert.equal(out.attempts, 5);
  assert.deepEqual(out.env, [null, null, null], "keys are gone (undefined serializes to null)");
  assert.ok(out.stripped.includes('GROQ_API_KEY') && out.stripped.includes('OPENROUTER_API_KEY') && out.stripped.includes('NVIDIA_API_KEY'));
});

test('offline worker batch: real games, zero external calls, results in job order', async () => {
  const m = B.loadMatrix();
  assert.equal(m.totalGames, 100); assert.equal(B.buildJobs(m, w).length, 100);
  const jobs = B.buildJobs(m, w).filter(j => j.seed === m.seeds[0] && (j.condition === 'C3' || j.condition === 'C4')).map(j => ({ ...j, seed: 90009, gameId: j.gameId.replace(String(m.seeds[0]), '90009') }));
  const r = await B.runBatch(jobs, { workers: 2 });
  assert.equal(r.guard.attempts, 0); assert.equal(r.guard.workers, 2);
  assert.deepEqual(r.recs.map(x => `${x.seed}/${x.first}/${x.start?.id}`), jobs.map(j => `90009/${j.first}/${j.condition}`));
  for (const x of r.recs) assert.ok(B.replayDetail(x).ok);
});

test('the matrix is exactly 100 games: 5 conditions x 10 seeds x both first movers, seeds disjoint from V1/V2', () => {
  const m = B.loadMatrix();
  assert.deepEqual(m.conditions.map(c => `${c.id}:${c.firstMover}/${c.secondMover}`), ['C0:3/3', 'C1:2/2', 'C2:4/4', 'C3:3/2', 'C4:2/3']);
  const spent = [...Array.from({ length: 12 }, (_, i) => 1000 + i), ...Array.from({ length: 12 }, (_, i) => 5000 + i), 3000, 3001, 3002, 3003, ...Array.from({ length: 16 }, (_, i) => 3100 + i), ...Array.from({ length: 16 }, (_, i) => 3200 + i), ...Array.from({ length: 16 }, (_, i) => 7000 + i), ...Array.from({ length: 16 }, (_, i) => 7100 + i)];
  assert.ok(m.seeds.every(s => !spent.includes(s)));
  const ids = B.buildJobs(m, w).map(j => j.gameId);
  assert.equal(new Set(ids).size, 100);
});

// ---------------------------------------------------------------- statistics
test('statistics: Wilson interval, exact binomial, minimum significant share, seeded permutation', () => {
  assert.deepEqual(St.wilson(10, 20), [0.299, 0.701]);
  assert.equal(St.binomTwoSided(10, 20), 1);
  assert.equal(St.binomTwoSided(15, 20), 0.041);
  assert.equal(St.minSignificantK(20), 15);
  const a = St.permutationHeterogeneity([[1, 1, 1, 1, 1, 1, 1, 1], [0, 0, 0, 0, 0, 0, 0, 0]], 2000)!;
  const b = St.permutationHeterogeneity([[1, 1, 1, 1, 1, 1, 1, 1], [0, 0, 0, 0, 0, 0, 0, 0]], 2000)!;
  assert.deepEqual(a, b); assert.ok(a.p < 0.01);
  assert.ok(St.permutationHeterogeneity([[1, 0, 1, 0], [0, 1, 0, 1]], 2000)!.p > 0.5);
});

test('analysis of real recorded games: per-condition rates carry intervals and findings stay cautious', () => {
  const games = (['C3', 'C4'] as const).flatMap(cond => [91, 92].flatMap(seed => (['human', 'ai'] as Player[]).map(first => {
    const c = cond === 'C3' ? cfg(3, 2) : cfg(2, 3);
    const rec = playGame(seed, first, { human: W.freezeWeights(w), ai: W.freezeWeights(w) }, { start: { ...c, id: cond }, detail: true });
    return { row: B.summaryRow(rec, { gameId: B.gameId(cond, seed, first), condition: cond }), rec };
  })));
  const a = A.analyze(games, ['C3', 'C4']);
  assert.equal(a.conditions.length, 2);
  for (const c of a.conditions) { assert.equal(c.games, 4); assert.ok(c.firstMover.ci95[0] <= c.firstMover.ci95[1]); assert.ok(c.sideWithMorePieces); }
  assert.ok(a.findings.every(f => f.kind !== 'SIGNAL' || /exploratory/i.test(f.text)));
  assert.ok(a.findings.some(f => f.kind === 'LIMITATION'));
});

// ---------------------------------------------------------------- proposals, catalog, provenance, gates
const gameIds = new Set(['C0-62001-human', 'C3-62004-ai']);
const body = (o: Record<string, string>) => new URLSearchParams({ nonce: 'n', entry: 'hypothesis', title: 'First mover tempo', cause: 'starting-rules', explanation: 'The first mover gets a full set of actions before the opponent can place a single trap.', evidence: 'C0-62001-human C3-62004-ai', p1metric: 'abs_first_mover_edge', p1dir: 'decrease', p1size: '0.15', intervention: 'S3_FIRST_TURN_ACTIONS', value: '2', competing: 'The planner is just better at moving first.', counterexample: 'C3-62004-ai', acceptance: 'edge below 10 points on 60 fresh games', disproof: 'edge unchanged', ...o }).toString();
const claude = { origin: 'claude' as const, author: 'Claude', note: 'test' };

test('notebook entries become typed proposals; unknown games, out-of-bounds values and missing predictions are refused', () => {
  const ok = P.parseNotebookEntry(body({}), { id: 'HT1', provenance: claude, gameIds, datasetHash: 'd' });
  assert.deepEqual(ok.problems, []);
  assert.deepEqual(ok.proposal.intervention, { id: 'S3_FIRST_TURN_ACTIONS', value: 2 });
  assert.match(P.parseNotebookEntry(body({ evidence: 'C9-1-human' }), { id: 'x', provenance: claude, gameIds, datasetHash: 'd' }).problems.join(), /unknown game/);
  assert.match(P.parseNotebookEntry(body({ value: '9' }), { id: 'x', provenance: claude, gameIds, datasetHash: 'd' }).problems.join(), /integer in \[1, 3\]/);
  assert.match(P.parseNotebookEntry(body({ intervention: 'rm -rf /' }), { id: 'x', provenance: claude, gameIds, datasetHash: 'd' }).problems.join(), /not in the catalog/);
  assert.match(P.parseNotebookEntry(body({ p1metric: '' }), { id: 'x', provenance: claude, gameIds, datasetHash: 'd' }).problems.join(), /no falsifiable prediction/);
  const nc = P.parseNotebookEntry(new URLSearchParams({ entry: 'conclusion', title: 'No change', cause: 'no-defect', verdict: 'no-change-justified' }).toString(), { id: 'C1', provenance: claude, gameIds, datasetHash: 'd' });
  assert.deepEqual(nc.problems, [], 'concluding that no change is justified is a valid entry');
});

test('provenance: only a stored real kane-cli output can be labelled Kane; the test double never can', () => {
  const dir = mkdtempSync(join(tmpdir(), 'rs-v3-prov-'));
  const s = K3.openV3Session(dir, 'KX3', { gameIds, datasetHash: 'd', isTestDouble: true });
  s.open = true;
  const e = K3.acceptV3Entry(s, body({ nonce: s.nonce }), '0.0.0-test-double');
  assert.deepEqual(e.problems, []);
  K3.sealProvenance(s);
  assert.equal(e.proposal.provenance.origin, 'kane-test-double');
  assert.deepEqual(P.checkProposal(e.proposal), []);
  const forged = structuredClone(e.proposal); forged.provenance.origin = 'kane';
  assert.match(P.checkProposal(forged).join(), /test double cannot be labelled as Kane/);
  const late = K3.acceptV3Entry({ ...s, open: false }, body({ nonce: 'bad' }), null);
  assert.ok(late.problems.includes('wrong or missing nonce') && late.problems.includes('arrived outside the Kane call window'));
  assert.match(P.checkProposal({ ...e.proposal, provenance: { origin: 'claude', author: 'c', note: '', kane: e.proposal.provenance.kane } }).join(), /must not carry a Kane reference/);
});

test('catalog: starting-rule interventions become typed treatments; combinations need single-factor results first', () => {
  const t = P.toTreatment([{ id: 'S1_PIECES', value: { firstMover: 3, secondMover: 2 } }]);
  assert.ok(t.ok && t.treatment.start?.pieces.firstMover === 3 && t.treatment.start.experimental === E.EXPERIMENTAL_START_CONFIG);
  const p = P.toTreatment([{ id: 'P1_SEARCH_OWN_BENEFIT', value: 0.5 }]);
  assert.ok(p.ok && p.treatment.hooks?.searchOwnBenefitFactor === 0.5);
  assert.equal(P.toTreatment([{ id: 'P1_SEARCH_OWN_BENEFIT', value: 1.5 }]).ok, false);
  const combo = [{ id: 'S3_FIRST_TURN_ACTIONS', value: 2 }, { id: 'P1_SEARCH_OWN_BENEFIT', value: 0.5 }];
  const r = P.toTreatment(combo);
  assert.ok(!r.ok && /single-factor result/.test(r.reason));
  const r2 = P.toTreatment(combo, new Set(['S3_FIRST_TURN_ACTIONS', 'P1_SEARCH_OWN_BENEFIT']));
  assert.ok(r2.ok && r2.treatment.start?.firstTurnActions === 2 && r2.treatment.hooks?.searchOwnBenefitFactor === 0.5);
  const s = E.init(4, { first: 'ai', start: (r2 as { treatment: { start: import('../server/engine.ts').StartingConfiguration } }).treatment.start });
  assert.equal(s.actionsLeft, 2);
});

test('partial search hook: factor 0 equals the V2 searchOwnBenefit:false, factor 1 equals production', async () => {
  const AI = await import('../server/ai.ts');
  const s = E.init(13, { first: 'ai' });
  for (const e of AI.CANDIDATE_EFFECTS) {
    assert.deepEqual(AI.bestCells(s, 'ai', e, w, { searchOwnBenefitFactor: 0 }), AI.bestCells(s, 'ai', e, w, { searchOwnBenefit: false }));
    assert.deepEqual(AI.bestCells(s, 'ai', e, w, { searchOwnBenefitFactor: 1 }), AI.bestCells(s, 'ai', e, w));
  }
});

test('normalized evaluation hook is the production evaluation at 3 v 3 and differs only when counts differ', async () => {
  const AI = await import('../server/ai.ts');
  for (const seed of [21, 22, 23]) {
    const s = E.init(seed, { first: 'ai' }); const e = E.init(seed, { first: 'ai', start: cfg(3, 3) });
    assert.equal(AI.evaluate(s, 'ai', w, { normalizedEval: true }), AI.evaluate(s, 'ai', w));
    assert.equal(AI.evaluate(e, 'human', w, { normalizedEval: true }), AI.evaluate(e, 'human', w));
  }
  const u = E.init(21, { first: 'ai', start: cfg(2, 3) });
  assert.notEqual(AI.evaluate(u, 'ai', w, { normalizedEval: true }), AI.evaluate(u, 'ai', w));
  const t = P.toTreatment([{ id: 'P4_NORMALIZED_EVAL', value: true }]);
  assert.ok(t.ok && t.treatment.hooks?.normalizedEval === true);
});

test('acceptance gates: moving toward 50% is not enough; length, fairness, diversity, counterplay and safety all count', () => {
  const base = { targetMetric: { control: 0.3, treated: 0.1, ci95OfDifference: [-0.32, -0.08] as [number, number], direction: 'decrease' as const, minEffect: 0.1 }, intendedBehaviourChanged: true, meanTurns: { control: 14, treated: 15 }, turnLimitRate: { control: 0, treated: 0.02 }, firstMoverEdge: { control: 0.2, treated: 0.1 }, entropy: { control: 0.8, treated: 0.78 }, comebackRate: { control: 0.3, treated: 0.28 }, leadChanges: { control: 2, treated: 1.9 }, safety: { illegal: 0, errors: 0, softlocks: 0 }, independentSeeds: true };
  assert.equal(P.acceptCorrection(base).accepted, true);
  const v2like = { ...base, meanTurns: { control: 14.5, treated: 27.1 } };
  const g = P.acceptCorrection(v2like); assert.equal(g.accepted, false); assert.equal(g.gates.find(x => x.id === 'length')!.pass, false);
  assert.equal(P.acceptCorrection({ ...base, firstMoverEdge: { control: 0.2, treated: 0.02 }, entropy: { control: 0.8, treated: 0.5 } }).accepted, false, 'closer to 50% but less diverse is refused');
  assert.equal(P.acceptCorrection({ ...base, independentSeeds: false }).accepted, false);
  assert.equal(P.acceptCorrection({ ...base, targetMetric: { ...base.targetMetric, ci95OfDifference: [-0.3, 0.02] } }).accepted, false);
});

test('Kane V3 is prepared but cannot run without an approval record and the matching environment token', () => {
  assert.throws(() => K3.assertKaneApproved(null, 'r1'), /PREPARED, not authorised/);
  delete process.env.KANE_V3_APPROVED;
  assert.throws(() => K3.assertKaneApproved({ approvedBy: 'x', approvedAt: 'now', runId: 'r1', maxCredits: 80, maxCalls: 1 }, 'r1'), /KANE_V3_APPROVED/);
  assert.equal(K3.KANE_V3_PLAN.status, 'PREPARED_NOT_RUN');
  assert.ok(!/first mover (has|holds) an advantage|is imbalanced/i.test(K3.objectiveV3()), 'the objective asks questions and states no conclusion');
});

test('registered V3 proposals are well-formed, cite real games of the dataset, and none claims Kane', () => {
  const reg = JSON.parse(src('balance/v3/proposals.json')) as { dataset: { runId: string }; proposals: import('../server/balance/v3/proposals.ts').Proposal[] };
  const ids = new Set(src(`evidence/balance/v3/datasets/${reg.dataset.runId}/games.ndjson`).split(/\r?\n/).filter(Boolean).map(l => JSON.parse(l).gameId as string));
  assert.equal(ids.size, 100);
  for (const p of reg.proposals) {
    assert.deepEqual(P.checkProposal(p), [], p.id);
    assert.ok(!p.provenance.origin.startsWith('kane'), `${p.id} must not claim Kane`);
    for (const g of [...p.evidenceGames, ...(p.counterexample ? [p.counterexample] : [])]) assert.ok(ids.has(g), `${p.id}: ${g}`);
    for (const pr of p.predictions) assert.ok(P.PROPOSAL_METRICS[pr.metric], `${p.id}: ${pr.metric}`);
    if (p.intervention) assert.ok(P.toTreatment([p.intervention]).ok, `${p.id} intervention`);
  }
});
