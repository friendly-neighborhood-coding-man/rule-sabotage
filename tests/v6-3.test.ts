/**
 * V6.3: Kane single-call preflight (case reproducibility, gate refuses before any process), latency-bounded prototype
 * (termination, warm spare, deterministic legal fallback), pilot defaults. No Kane, no network, no self-play batch.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
process.env.KANE_REFEREE = 'off';
const ROOT = new URL('..', import.meta.url);
const DIR = new URL('../evidence/v6/kane-preflight/', import.meta.url);
const E = await import('../server/v6/engine.ts');
const { loadWeights } = await import('../server/weights.ts');
const W8 = loadWeights();

test('Kane preflight case: one AI self-play tier-3 case, no participant data, files intact and consistent', () => {
  const m = JSON.parse(readFileSync(new URL('manifest.json', DIR), 'utf8'));
  for (const [f, h] of Object.entries(m.files as Record<string, string>)) assert.equal(createHash('sha256').update(readFileSync(new URL(f, DIR), 'utf8')).digest('hex'), h, f);
  assert.equal(m.participantData, false); assert.equal(m.source.game, 'oa-v3/96001/ai-first'); assert.equal(m.source.turn, 8);
  const c = JSON.parse(readFileSync(new URL('case.json', DIR), 'utf8'));
  assert.equal(c.engine.final, 'unverified'); assert.equal(c.engine.activated, false); assert.equal(c.engine.tier, 3);
  assert.equal(c.trialPageSha256, createHash('sha256').update(readFileSync(new URL('trial-page.html', DIR), 'utf8')).digest('hex'));
  assert.equal(JSON.parse(readFileSync(new URL('conditions.json', DIR), 'utf8')).conditions.length, 6);
  assert.ok(!existsSync(new URL('kane-verdict.ndjson', DIR)), 'no Kane result exists');
});

test('Kane single call: plan within 30 credits (local estimate, not a hard limit); execute is refused before any process starts', async () => {
  const { PLAN, realDeps } = await import('../scripts/kane-single-call.ts');
  const B = await import('../server/balance/v4/kanebudget.ts');
  assert.equal(PLAN.calls, 1); assert.equal(PLAN.retries, 0); assert.ok(PLAN.ceilingCredits <= 30);
  assert.ok(PLAN.maxStepsForEstimate * B.MEASURED_CREDITS_PER_STEP <= PLAN.ceilingCredits);
  assert.equal(B.PAID_RESEARCH_EXECUTION, 'disabled');
  const tmp = mkdtempSync(join(tmpdir(), 'rs-ks1-'));
  try {
    const touched: string[] = [];
    const deps = { ...realDeps(join(tmp, 'ledger.ndjson'), '<html></html>', ['c'], { stdout: '', stderr: '', args: [] }), isRealCli: async () => { touched.push('cli'); return true; }, balance: async () => { touched.push('balance'); return 1000; }, exec: async () => { touched.push('exec'); return { timedOut: false, exitCode: 0 }; } };
    const approval = { runId: PLAN.runId, approvedBy: 'test', approvedAt: 'now', maxCalls: 1 as const, maxSteps: PLAN.maxStepsForEstimate, ceilingCredits: 30, acknowledgesNoHardCap: true as const };
    await assert.rejects(B.runPaidCall(approval, { maxSteps: PLAN.maxStepsForEstimate, timeoutS: PLAN.timeoutS }, { ...deps, env: { KANE_PAID_RUN_AUTH: PLAN.runId } }), (e: Error) => e instanceof B.PaidCallRefused && /disabled/.test(e.message));
    assert.deepEqual(touched, [], 'not even kane-cli --version or balance ran');
    assert.equal(B.readLedger(join(tmp, 'ledger.ndjson'))[0].event, 'refused');
  } finally { rmSync(tmp, { recursive: true, force: true }); }
  const src = readFileSync(new URL('../scripts/kane-single-call.ts', import.meta.url), 'utf8');
  const imports = src.split('\n').filter(l => /^import /.test(l) || /import\(/.test(l)).join('\n'); // what the runner actually loads
  assert.doesNotMatch(imports, /server\/kane\.ts|server\/game\.ts|server\/server\.ts|import\(/, 'not the production referee path');
  assert.doesNotMatch(src.replace(/\/\*[\s\S]*?\*\//g, ''), /kaneJudge/, 'kaneJudge is never called');
});

test('budgeted prototype: the pool terminates a planner at its deadline and the warm spare serves the next decision', async () => {
  const { PlannerPool } = await import('../server/v6/budgeted.ts');
  const { planningView } = await import('../server/v6/turn.ts');
  const slow = JSON.parse(readFileSync(new URL('../evidence/v6/v6-2-replay.json', import.meta.url), 'utf8')).positions.find((p: { policy: string }) => p.policy === 'ev-k1.2');
  const pool = new PlannerPool();
  try {
    const warm = await pool.run('softmax-v2', planningView(E.init(5, { ruleset: E.RULESET_V61, first: 'ai' })), 'ai', 180_000); // generous: under the full parallel test suite a fresh worker can take long to start
    assert.ok(warm.plan, warm.error);
    const t = await pool.run('ev-k1.2', planningView(slow.state), slow.p, 300);
    assert.equal(t.timedOut, true); assert.ok(t.ms < 2_000, `terminated after ${t.ms} ms`);
    assert.equal(typeof pool.lastRespawnMs, 'number');
    const next = await pool.run('softmax-v2', planningView(E.init(6, { ruleset: E.RULESET_V61, first: 'ai' })), 'ai', 180_000); // generous: under the full parallel test suite a fresh worker can take long to start
    assert.ok(next.plan, `the spare worker answered after a termination (${JSON.stringify({ e: next.error, t: next.timedOut, ms: next.ms })})`);
  } finally { await pool.close(); }
});

test('budgeted prototype: deadline fallback = no new effect, legal executor moves, recorded; no other policy substituted', async () => {
  const { decideBudgeted } = await import('../server/v6/budgeted.ts');
  const { aiTurnV6 } = await import('../server/v6/turn.ts');
  const s = E.init(99995, { ruleset: E.RULESET_V61, first: 'ai' });
  const before = structuredClone(s);
  const fakePool = { run: async () => ({ timedOut: true, ms: 8000 }), lastRespawnMs: 4 } as never;
  let meta: { outcome: string; fallback: string | null; terminated: boolean } | null = null;
  const r = await aiTurnV6(s, 'ai', 'oa-v3', W8, decideBudgeted(fakePool, new Map(), m => { meta = m as never; }));
  assert.equal(meta!.outcome, 'terminated'); assert.equal(meta!.terminated, true); assert.match(meta!.fallback!, /terminated at 8000 ms/);
  assert.equal(r.verdict, null, 'no effect placed'); assert.ok(r.moves.length > 0, 'it still moves'); assert.equal(r.error, null);
  assert.equal((r.budget as { outcome: string }).outcome, 'terminated');
  // the fallback moves are the shared executor's moves on the same position: deterministic
  const t = structuredClone(before);
  const r2 = await aiTurnV6(t, 'ai', 'oa-v3', W8, decideBudgeted(fakePool, new Map()));
  assert.deepEqual(r2.moves, r.moves); assert.deepEqual(t.pieces, s.pieces);
  // a planner error is also a recorded fallback, never another policy
  const errPool = { run: async () => ({ error: 'boom', ms: 3 }), lastRespawnMs: null } as never;
  const r3 = await aiTurnV6(structuredClone(before), 'ai', 'oa-v3', W8, decideBudgeted(errPool, new Map()));
  assert.equal((r3.budget as { outcome: string }).outcome, 'worker-error'); assert.equal(r3.verdict, null);
});

test('pilot defaults: V6.1 + the three referee-aware opponents; originals kept as baselines; prototype flagged', async () => {
  const O = await import('../server/v6/opponents.ts');
  assert.deepEqual(O.PILOT_DEFAULT_OPPONENTS.sort(), ['v6-ev-k1.2-ra', 'v6-oa-v3-ra', 'v6-softmax-v2-ra']);
  for (const id of ['v6-ev-k1.2', 'v6-softmax-v2', 'v6-oa-v3']) { assert.ok(O.OPPONENTS_V6[id]); assert.equal(O.OPPONENTS_V6[id].adapter, undefined); }
  for (const id of ['v6-ev-k1.2-ra-b', 'v6-softmax-v2-ra-b', 'v6-oa-v3-ra-b']) { assert.equal(O.OPPONENTS_V6[id].experimentalPrototype, true); assert.equal(O.OPPONENTS_V6[id].pilotDefault, undefined); }
  const html = readFileSync(new URL('../client/v6/index.html', import.meta.url), 'utf8');
  assert.ok(html.indexOf('v6-ruleset') > 0);
  const tmp = mkdtempSync(join(tmpdir(), 'rs-sum-'));
  try {
    const r = spawnSync(process.execPath, ['--experimental-strip-types', '--no-warnings=ExperimentalWarning', 'scripts/v6-pilot-summary.ts'], { cwd: fileURLToPath(ROOT), env: { ...process.env, PLAYTEST_DATA_DIR: tmp }, encoding: 'utf8' });
    assert.match(r.stdout, /No V6 pilot games recorded yet/);
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});
