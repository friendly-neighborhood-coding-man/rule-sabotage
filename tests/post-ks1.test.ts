/**
 * Post-KS1: trial coverage completeness (KS1 as regression fixture), the supplementary-scenario proposal, the separated
 * evaluation record, and the public-evidence redaction proposal. No Kane call; KS1 originals are read-only.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
process.env.KANE_REFEREE = 'off';
const E = await import('../server/v6/engine.ts');
const { makeEffect } = await import('../server/rules.ts');
const { buildTrial } = await import('../server/v6/forks/trial.ts');
const { refereeV6 } = await import('../server/v6/turn.ts');
const C = await import('../server/v6/coverage.ts');
const R = await import('../scripts/evidence-redact.ts');
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const D = new URL('../evidence/v6/kane-preflight/', import.meta.url);
const state = JSON.parse(readFileSync(new URL('state-before.json', D), 'utf8'));
const kase = JSON.parse(readFileSync(new URL('case.json', D), 'utf8'));
const ks1pl = { text: kase.placement.text, effect: kase.placement.effect, cells: kase.placement.cells, interpretedBy: 'fixture' };

test('KS1 fixture: the frozen decision is reproduced and coverage is INCOMPLETE_EVIDENCE (A1 never entered), whatever the six conditions say', () => {
  const v = refereeV6(structuredClone(state), kase.proposer, ks1pl, { keepTrial: false }).verdict;
  assert.equal(v.final, 'unverified'); assert.equal(v.tier, 3); assert.equal(v.activated, false);
  const trial = buildTrial(state, kase.proposer, ks1pl, 9101);
  assert.deepEqual(trial.symmetry.map(r => r.cell).sort(), ['A2', 'B1']);
  const cov = C.trialCoverage(trial, ks1pl);
  assert.equal(cov.status, 'INCOMPLETE_EVIDENCE'); assert.deepEqual(cov.missing, ['A1']);
  const rec = C.evaluationRecord({ protocol: 'kane-conditions-v4.1', results: [true, true, true, true, true, true], source: 'KS1', coverage: cov, referee: { final: v.final, tier: v.tier, activated: v.activated } });
  assert.equal(rec.overall, 'INCOMPLETE_EVIDENCE', 'six true conditions do not override missing coverage');
  assert.equal(rec.conditionSatisfaction.allTrue, true); assert.equal(rec.independentSafetyEvidence.status, 'NONE'); assert.equal(rec.refereeDecision.final, 'unverified');
  assert.match(cov.note, /not evidence that the effect is unsafe/);
});

test('why A1 was skipped: both in-board neighbours (B1, A2) are cells of the same placement', () => {
  const s = structuredClone(state);
  const h = { ...s, cells: { ...s.cells, '0,1': 99, '1,0': 99 } };
  const free = [[-1, 0], [1, 0], [0, -1], [0, 1]].map(([dx, dy]) => [0 + dx, 0 + dy]).filter(([x, y]) => E.inside(x, y)).filter(([x, y]) => !h.cells[E.key(x, y)]);
  assert.deepEqual(free, [], 'no effect-free in-board neighbour of A1 after the placement');
});

test('proposed supplementary scenario: A1 entered from B1 after pre-burning B1 in the sandbox; symmetric, fires once; state untouched', () => {
  const trial = buildTrial(state, kase.proposer, ks1pl, 9102);
  const before = JSON.stringify(state);
  const sup = C.supplementaryScenarios(state, kase.proposer, ks1pl, C.trialCoverage(trial, ks1pl));
  assert.equal(sup.length, 1);
  assert.deepEqual([sup[0].cell, sup[0].enteredFrom, sup[0].preBurned, sup[0].dir], ['A1', 'B1', 'B1', 'left']);
  assert.equal(sup[0].identical, true); assert.equal(sup[0].fired, true);
  assert.deepEqual(sup[0].secondVisitFired, { human: false, ai: false });
  assert.equal(sup[0].human.endSquare, 'own start square');
  assert.equal(JSON.stringify(state), before);
});

test('the supplementary generator reproduces the original trial rows exactly where the trial could enter (A2, B1)', () => {
  const trial = buildTrial(state, kase.proposer, ks1pl, 9103);
  for (const row of trial.symmetry) {
    const forced = { status: 'INCOMPLETE_EVIDENCE' as const, requirements: [{ cell: row.cell, side: 'any' as const, covered: false, by: null }], missing: [row.cell], entryRelative: false, note: '' };
    const [sup] = C.supplementaryScenarios(state, kase.proposer, ks1pl, forced);
    assert.equal(sup.preBurned, null, `${row.cell}: a clean neighbour exists`);
    assert.deepEqual([sup.enteredFrom, sup.dir, sup.human, sup.ai, sup.identical], [row.enteredFrom, row.dir, row.human, row.ai, row.identical], row.cell);
  }
});

test('coverage rules: a fully entered entry-independent placement is COMPLETE; entry-relative shoves need every in-board side', () => {
  const s = E.init(77, { ruleset: E.RULESET_V61, first: 'human' });
  const pl = { text: 't', effect: makeEffect('freeze'), cells: [E.key(5, 1), E.key(7, 7)], interpretedBy: 't' };
  const t = buildTrial(s, 'human', pl, 9104);
  const cov = C.trialCoverage(t, pl);
  assert.equal(cov.status, 'COMPLETE');
  assert.equal(C.evaluationRecord({ protocol: 'p', results: [true], source: 's', coverage: cov, referee: { final: 'engine-approved', tier: 1, activated: true } }).overall, 'CONDITIONS_SATISFIED_ON_COMPLETE_COVERAGE');
  assert.equal(C.evaluationRecord({ protocol: 'p', results: [true, false], source: 's', coverage: cov, referee: { final: 'engine-approved', tier: 1, activated: true } }).overall, 'CONDITIONS_NOT_SATISFIED');
  const back = { ...pl, effect: makeEffect('shove', 'back', 2) };
  const cb = C.trialCoverage(buildTrial(s, 'human', back, 9105), back);
  assert.equal(cb.status, 'INCOMPLETE_EVIDENCE', 'the current trial enters each cell from one side only');
  assert.equal(cb.requirements.length, 8);
});

test('public evidence: every redaction rule is narrow; the originals stay unchanged; the proposal matches its correction record', () => {
  const r = R.redact('{"type":"recording_state","session_id":"8eaec214-8259-40a5-9b72-6d73bfb3d0f4","pid":34000} D:\\\\Rule_Sabotage\\\\rule-sabotage-live\\\\evidence C:/Program Files/Google/Chrome/Application/chrome.exe "approvedBy": "Eric (account owner), project thread message cmsg_ABC123" D:\\Temp\\rs-kane-ks1-UEPEpK D:/Tools/npm-global/kane-cli.cmd');
  assert.doesNotMatch(r.text, /8eaec214|34000|Rule_Sabotage|Program Files|cmsg_|UEPEpK|Tools/);
  assert.match(r.text, /Eric \(account owner\)/); assert.match(r.text, /recording_state/);
  assert.equal(R.redact('{"before":10503.2867,"used":9.097}').text, '{"before":10503.2867,"used":9.097}', 'balances only by the optional rule');
  assert.equal(execFileSync('git', ['status', '--porcelain', '--', 'evidence/v6/kane-preflight'], { cwd: ROOT, encoding: 'utf8' }).trim(), '', 'originals unchanged');
  const rec = JSON.parse(readFileSync(new URL('../evidence/v6/kane-preflight-public-proposed/CORRECTION_RECORD.json', import.meta.url), 'utf8'));
  assert.match(rec.status, /PROPOSED, not applied/);
  for (const f of rec.files) {
    assert.equal(createHash('sha256').update(readFileSync(new URL(`../${f.file}`, import.meta.url))).digest('hex'), f.originalSha256, f.file);
    if (f.redacted) { const t = readFileSync(new URL(`../${f.proposedFile}`, import.meta.url), 'utf8'); assert.equal(createHash('sha256').update(t).digest('hex'), f.proposedSha256); assert.doesNotMatch(t, /session_id":"[0-9a-f]|[A-Za-z]:[\\/]+(Rule_Sabotage|Temp|Tools|Program Files)|cmsg_/, f.proposedFile); }
  }
  assert.ok(existsSync(new URL('../evidence/v6/ks1-evaluation/ks1-evaluation-record.json', import.meta.url)));
});
