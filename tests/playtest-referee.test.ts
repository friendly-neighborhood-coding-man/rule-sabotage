/**
 * Option A preflight (operator decision 2026-11-21): the playtest applies the production engine-only referee to the AI
 * opponent exactly as to the human. Deterministic regression tests on positions reused from the frozen V5.3 records
 * (ev-k1.2 games, the opponent's side): the position at the start of a recorded AI turn is rebuilt by engine replay, the
 * playtest opponent decides it again (the policy is deterministic, so it must choose the recorded effect; asserted), and
 * the referee outcome, placement, movement, telemetry and the feedback the page shows are checked.
 * No new game is played to completion; no self-play batch; no Kane; no LLM.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
process.env.KANE_REFEREE = 'off';
process.env.PLAYTEST_DATA_DIR = mkdtempSync(join(tmpdir(), 'rs-playtest-ref-'));
const E = await import('../server/engine.ts');
const { effectFromId } = await import('../server/weights.ts');
const { buildTrial } = await import('../server/trial.ts');
const { selectTier } = await import('../server/tiers.ts');
const S = await import('../server/playtest/session.ts');
const { view } = await import('../server/game.ts');
test.after(() => { S.stopPlanner(); rmSync(process.env.PLAYTEST_DATA_DIR!, { recursive: true, force: true }); });

type Fixture = { state: any; effect: string; cells: string[]; game: string; turn: number };
const RUN = 'evidence/balance/v5_3/2026-11-20T22-04-35Z-v53/games';
/** First AI-side placement of each referee class in the frozen ev-k1.2 records (sorted, so deterministic). */
function fixtures(): Record<'approved' | 'tier3' | 'engineFail', Fixture> {
  const out: Partial<Record<'approved' | 'tier3' | 'engineFail', Fixture>> = {};
  let n = 70000;
  for (const f of readdirSync(RUN).filter(f => f.startsWith('ev-k1.2-')).sort()) {
    const d = JSON.parse(readFileSync(join(RUN, f), 'utf8')).rec.detail;
    const s = E.init(d.seed, { first: d.first });
    for (const t of d.turns) {
      if (t.placement && t.p === 'ai') {
        const pl = { text: 'fixture', effect: effectFromId(t.placement.effect)!, cells: t.placement.cells, interpretedBy: 'fixture' };
        if (E.validatePlacement(s, 'ai', pl).ok) {
          const trial = buildTrial(s, 'ai', pl, ++n);
          const cls = trial.engineChecks.some(c => !c.pass) ? 'engineFail' : selectTier(s, 'ai', pl, trial).tier === 3 ? 'tier3' : 'approved';
          if (!out[cls]) out[cls] = { state: structuredClone(s), effect: t.placement.effect, cells: t.placement.cells, game: f, turn: t.turn };
        }
      }
      if (t.placement) E.applyPlacement(s, t.p, { text: 'r', effect: effectFromId(t.placement.effect)!, cells: t.placement.cells, interpretedBy: 'r' });
      if (s.phase === 'place') s.phase = 'move';
      for (const m of t.moves) E.applyMove(s, t.p, { from: m.from, dir: m.dir, mode: m.mode });
      if (s.winner) break;
      E.endTurn(s);
    }
    if (out.approved && out.tier3 && out.engineFail) return out as Record<'approved' | 'tier3' | 'engineFail', Fixture>;
  }
  throw new Error(`fixtures not found: ${JSON.stringify(Object.keys(out))}`);
}
const FX = fixtures();
const fx = (f: Fixture) => f.cells.map(E.cellName);

async function aiTurnFrom(fx: Fixture) {
  const pg = S.startPlaytest({ sessionId: '00000000-0000-4000-8000-000000000000', recorded: false, opponent: 'ev-k1.2', seed: fx.state.seed, first: fx.state.firstPlayer });
  pg.g.state = structuredClone(fx.state);
  const cellsBefore = { ...pg.g.state.cells };
  const ai = await S.beginPlaytest(pg);
  assert.ok(ai, 'the opponent played the turn');
  const t = pg.turns.find(x => x.p === 'ai')!;
  assert.deepEqual(t.placement?.cells, fx.cells.map(E.cellName), `fixture ${fx.game} turn ${fx.turn}: the frozen policy re-chose the recorded effect`);
  return { pg, ai: ai as any, t, cellsBefore };
}
const newCells = (before: Record<string, number>, after: Record<string, number>) => Object.keys(after).filter(k => after[k] !== before[k]);

test('1. AI tier 1/2 effect: engine-approved and placed', { timeout: 300_000 }, async () => {
  const { pg, ai, t, cellsBefore } = await aiTurnFrom(FX.approved);
  const v = ai.verdicts[0];
  assert.equal(v.final, 'engine-approved'); assert.ok(v.tier.tier === 1 || v.tier.tier === 2); assert.equal(v.activated, true);
  assert.ok(ai.events.some((e: any) => e.t === 'place' && e.p === 'ai'), 'a place event for the page to animate');
  assert.equal(t.ai!.placementBlocked, null); assert.equal(t.placement!.verdict, 'engine-approved'); assert.deepEqual(t.placement!.placed, fx(FX.approved));
  assert.ok(newCells(cellsBefore, pg.g.state.cells).length > 0 || ai.events.some((e: any) => e.t === 'trigger'), 'the effect is on the board (or already triggered this turn)');
});
for (const [name, key, final] of [['2. AI tier 3 effect: unverified, not placed', 'tier3', 'unverified'], ['3. AI effect failing an engine check: rejected, not placed', 'engineFail', 'rejected']] as const) {
  test(`${name}; 4. the AI still moves legally; 5. telemetry and visible feedback record the block`, { timeout: 300_000 }, async () => {
    const { pg, ai, t } = await aiTurnFrom(FX[key]);
    const v = ai.verdicts[0];
    // 2/3: rejected without placement
    assert.equal(v.final, final); assert.equal(v.activated, false); assert.deepEqual(v.placedCells, []);
    if (key === 'tier3') assert.equal(v.tier.tier, 3); else assert.equal(v.decidedBy, 'engine');
    assert.ok(!ai.events.some((e: any) => e.t === 'place'), 'no place event');
    assert.ok(!pg.g.state.rules.some(r => r.owner === 'ai' && r.turn === FX[key].turn), 'no AI rule created this turn');
    // 4: legal movement continues, and the turn passes on
    assert.ok(t.moves.length > 0, 'the AI moved after the block');
    assert.ok(ai.events.some((e: any) => e.t === 'move' && e.p === 'ai'));
    assert.ok(pg.g.state.winner || pg.g.state.current === 'human');
    // 5: telemetry
    assert.equal(t.placement!.verdict, final); assert.deepEqual(t.placement!.placed, []);
    assert.match(t.ai!.placementBlocked!, new RegExp(`referee: ${final}`));
    const rec = S.record(pg);
    assert.equal(rec.interactions.notPlaced.ai, 1); assert.equal(rec.interactions.placements.ai, 1);
    // 5: what the page shows (the production client renders ai.verdicts and view.reviews; the log shows the rationale)
    assert.match(v.message, final === 'unverified' ? /Not placed\. This rule needs Kane review \(tier 3: .+\) and the Kane referee is off/ : /Engine safety check failed: .+/);
    assert.match(ai.decision.rationale, /its effect was not placed \(referee: /);
    assert.ok(view(pg.g).reviews.some((r: any) => r.reviewId === v.reviewId && r.final === final && !r.activated));
  });
}

test('the frozen AI does not choose a replacement effect after a block (no fallback)', { timeout: 300_000 }, async () => {
  const { ai } = await aiTurnFrom(FX.tier3);
  assert.equal(ai.verdicts.length, 1, 'exactly one proposal per turn');
});

test('human side, same referee: a tier-3 human effect is not placed and, as for the AI, no second effect can be placed that turn (fixture reused from referee-v41)', { timeout: 120_000 }, async () => {
  const pg = S.startPlaytest({ sessionId: '00000000-0000-4000-8000-000000000001', recorded: false, opponent: 'ev-k1.2', first: 'human' });
  await S.beginPlaytest(pg);
  const p = await S.humanPreview(pg, 'Anything entering is shoved 5 squares north');
  assert.equal(p.interpretation.status, 'approximate', 'the preview tells the human it is an approximation before they submit');
  const r = await S.humanPlace(pg, { token: p.token!, cells: ['3,3'] });
  assert.equal(r.verdicts[0].final, 'unverified'); assert.equal(r.verdicts[0].tier!.tier, 3); assert.match(r.verdicts[0].message, /Not placed/);
  assert.equal(Object.keys(pg.g.state.cells).length, 0);
  assert.equal(pg.current!.placement!.verdict, 'unverified'); assert.deepEqual(pg.current!.placement!.placed, []);
  // The engine's placement step ends once an effect is submitted (production rule, unchanged): a second attempt this turn is refused.
  const p2 = await S.humanPreview(pg, 'Frozen for a turn');
  await assert.rejects(() => S.humanPlace(pg, { token: p2.token!, cells: ['3,0'] }), /before your first move/);
  assert.equal(pg.current!.rejectedAttempts.length, 1, 'the refused retry is recorded');
});
