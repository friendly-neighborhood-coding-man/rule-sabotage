/**
 * GW2 P1: hybrid policy validator/evaluator and verdict-time coverage (gamewatch/gw2/policy.ts, coverage.ts,
 * inventory.ts). Deterministic HTTP test doubles only. Covers AC-P1.3, AC-P1.4, AC-P1.6 and the policy/coverage cases
 * listed in docs/gw2/PHASE_1_REPORT.md.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { startGw2Server } from '../gamewatch/gw2/serve.ts';
import { validatePolicy, evaluate, PolicyError } from '../gamewatch/gw2/policy.ts';
import { inventoryFromBundle, citations } from '../gamewatch/gw2/inventory.ts';
import { loadSession } from '../gamewatch/gw2/session.ts';
import { sessionCoverage } from '../gamewatch/gw2/coverage.ts';
import { ROOT } from '../gamewatch/gw2/paths.ts';
import { fixture, req, submit } from './gw2-fixtures.ts';

const P = (requirements: unknown[]) => ({ schema: 'gamewatch/gw2-policy@1', id: 't', requirements });
const ANOMALY = { category: 'confirmed observable anomaly', rules: 'R8', claim: 'a +1 cell fires twice', evidence: 'C-aaaaaa step 3' };

/** A session in which the double opens C-aaaaaa, submits ANOMALY, then opens C-bbbbbb. */
async function session(f: ReturnType<typeof fixture>, o: { accessLog?: boolean; ua2?: string } = {}) {
  const s = await startGw2Server({ exp: 'pol', out: f.out, site: f.site, accessLog: o.accessLog });
  try {
    await req(s.port, '/case-C-aaaaaa.html');
    await submit(s.port, { ...ANOMALY, nonce: s.nonce });
    await req(s.port, '/case-C-bbbbbb.html', { ua: o.ua2 });
  } finally { await s.close(); }
  return s;
}

test('AC-P1.3: an empty policy is "not-declared", never a pass or a fail', async () => {
  const f = fixture(), inv = inventoryFromBundle(f.bundle as never), s = await session(f);
  const r = evaluate(validatePolicy(P([]), inv), inv, loadSession(s.dir));
  assert.equal(r.investigationCompleteness.completeness, 'not-declared');
  assert.deepEqual(r.investigationCompleteness.requirements, []);
  assert.equal(r.findings.length, 1, 'the finding is still reported');
  rmSync(f.root, { recursive: true, force: true });
});

test('AC-P1.4: must-access is unsatisfied with one target served and satisfied with both; the finding is identical in both', async () => {
  const f = fixture(), inv = inventoryFromBundle(f.bundle as never), s = await session(f);
  const ss = loadSession(s.dir);
  const one = evaluate(validatePolicy(P([{ id: 'a', kind: 'must-access', targets: ['C-aaaaaa', 'C-9fc650'], reason: 'r' }]), inv), inv, ss);
  const both = evaluate(validatePolicy(P([{ id: 'a', kind: 'must-access', targets: ['C-aaaaaa', 'C-bbbbbb'], reason: 'r' }]), inv), inv, ss);
  assert.equal(one.investigationCompleteness.requirements[0].result, 'unsatisfied');
  assert.deepEqual(one.investigationCompleteness.requirements[0].missing, ['C-9fc650']);
  assert.equal(one.investigationCompleteness.completeness, 'incomplete');
  assert.equal(both.investigationCompleteness.requirements[0].result, 'satisfied');
  assert.equal(both.investigationCompleteness.completeness, 'complete');
  assert.deepEqual(one.findings, both.findings, 'a defect finding is reported unchanged whatever the completeness result');
  assert.equal(JSON.parse(one.findings[0].verbatim).category, 'confirmed observable anomaly');
  assert.equal(one.findings[0].verbatim, readFileSync(join(s.dir, 'notes.ndjson'), 'utf8').trim(), 'verbatim note line');
  rmSync(f.root, { recursive: true, force: true });
});

test('must-cite by exact identifier; must-evaluate stays not-evaluable even when the rule is cited and its evidence served', async () => {
  const f = fixture(), inv = inventoryFromBundle(f.bundle as never), s = await session(f);
  const r = evaluate(validatePolicy(P([
    { id: 'c1', kind: 'must-cite', targets: ['R8', 'C-aaaaaa'], reason: 'r' },
    { id: 'c2', kind: 'must-cite', targets: ['R1'], reason: 'r' },
    { id: 'e1', kind: 'must-evaluate', targets: ['R8'], reason: 'r' },
  ]), inv), inv, loadSession(s.dir));
  const by = Object.fromEntries(r.investigationCompleteness.requirements.map(x => [x.id, x]));
  assert.equal(by.c1.result, 'satisfied'); assert.equal(by.c2.result, 'unsatisfied');
  assert.equal(by.e1.result, 'not-evaluable'); assert.match(by.e1.why, /P4/);
  assert.equal(r.evaluationAvailability.ruleEvaluation, 'not-available');
  rmSync(f.root, { recursive: true, force: true });
});

test('partially unevaluable: satisfied + not-evaluable gives "undetermined", not "complete"', async () => {
  const f = fixture(), inv = inventoryFromBundle(f.bundle as never), s = await session(f);
  const r = evaluate(validatePolicy(P([{ id: 'a', kind: 'must-access', targets: ['C-aaaaaa'], reason: 'r' }, { id: 'e', kind: 'must-evaluate', targets: ['R8'], reason: 'r' }]), inv), inv, loadSession(s.dir));
  assert.equal(r.investigationCompleteness.completeness, 'undetermined');
  rmSync(f.root, { recursive: true, force: true });
});

test('malformed policies and unknown targets are rejected with every problem listed, never silently ignored', () => {
  const inv = inventoryFromBundle(fixture().bundle as never);
  const bad = (p: unknown, re: RegExp) => { assert.throws(() => validatePolicy(p, inv), (e: unknown) => e instanceof PolicyError && e.problems.some(x => re.test(x))); };
  bad(null, /not a JSON object/);
  bad({ ...P([]), schema: 'gamewatch/gw2-policy@2' }, /schema/);
  bad({ ...P([]), extra: 1 }, /unknown policy field/);
  bad(P([{ id: 'a', kind: 'must-visit-all', targets: ['C-aaaaaa'], reason: 'r' }]), /kind/);
  bad(P([{ id: 'a', kind: 'must-access', targets: [], reason: 'r' }]), /non-empty/);
  bad(P([{ id: 'a', kind: 'must-access', targets: ['C-aaaaaa'] }]), /reason/);
  bad(P([{ id: 'a', kind: 'must-access', targets: ['C-aaaaaa'], reason: 'r' }, { id: 'a', kind: 'must-cite', targets: ['R1'], reason: 'r' }]), /duplicate id/);
  bad(P([{ id: 'a', kind: 'must-access', targets: ['C-zzzzzz'], reason: 'r' }]), /"C-zzzzzz" is not an evidence id/);
  bad(P([{ id: 'a', kind: 'must-access', targets: ['R8'], reason: 'r' }]), /it is a rule id/);
  bad(P([{ id: 'a', kind: 'must-cite', targets: ['R99'], reason: 'r' }]), /"R99" is neither/);
  bad(P([{ id: 'a', kind: 'must-evaluate', targets: ['C-aaaaaa'], reason: 'r' }]), /it is an evidence id/);
  bad(P([{ id: 'a b', kind: 'must-cite', targets: ['R1'], reason: 'r', weight: 2 }]), /unknown field "weight"/);
});

test('exact identifier matching: no prefix, suffix or substring hits', () => {
  const inv = inventoryFromBundle(fixture().bundle as never);
  const c = citations({ evidence: 'C-9fc6501, xC-aaaaaa, C-bbbbbb-old, (C-9fc650). R14; R2/R8', claim: 'see C-aaaaa' }, inv);
  assert.deepEqual(c.evidence, ['C-9fc650']);
  assert.deepEqual(c.rules, ['R14', 'R2', 'R8'], 'R14 is R14, not R1');
  assert.ok(!c.rules.includes('R1'));
  assert.deepEqual(c.unknownIdLike, ['C-9fc6501', 'C-aaaaa']);
  assert.deepEqual(citations({ nonce: 'C-aaaaaa' }, inv).evidence, [], 'the nonce field is never searched');
});

test('access logging disabled: must-access is not-evaluable (never satisfied), coverage says unavailable, findings unchanged', async () => {
  const f = fixture(), inv = inventoryFromBundle(f.bundle as never), s = await session(f, { accessLog: false });
  const r = evaluate(validatePolicy(P([{ id: 'a', kind: 'must-access', targets: ['C-aaaaaa'], reason: 'r' }]), inv), inv, loadSession(s.dir));
  assert.equal(r.investigationCompleteness.requirements[0].result, 'not-evaluable');
  assert.match(r.investigationCompleteness.requirements[0].why, /unavailable.*not evidence that a page was not accessed/);
  const cov = sessionCoverage(inv, s.dir);
  assert.ok(cov.columns.every(c => c.items.every(i => i.serverAccess === 'unavailable')));
  assert.equal(r.findings.length, 1);
  rmSync(f.root, { recursive: true, force: true });
});

test('attribution uncertain (two clients in one session): must-access not-evaluable, coverage "uncertain"', async () => {
  const f = fixture(), inv = inventoryFromBundle(f.bundle as never), s = await session(f, { ua2: 'another-client/1' });
  const ss = loadSession(s.dir);
  assert.equal(ss.journal.attribution, 'uncertain');
  const r = evaluate(validatePolicy(P([{ id: 'a', kind: 'must-access', targets: ['C-aaaaaa'], reason: 'r' }]), inv), inv, ss);
  assert.equal(r.investigationCompleteness.requirements[0].result, 'not-evaluable'); assert.match(r.investigationCompleteness.requirements[0].why, /attribution uncertain/);
  assert.ok(sessionCoverage(inv, s.dir).columns[0].items.every(i => i.serverAccess === 'uncertain'));
  rmSync(f.root, { recursive: true, force: true });
});

test('verdict-time coverage: access after a finding is not credited to it; a citation before access is flagged; session end credits it', async () => {
  const f = fixture(), inv = inventoryFromBundle(f.bundle as never);
  const s = await startGw2Server({ exp: 'cov', out: f.out, site: f.site });
  try {
    await req(s.port, '/case-C-aaaaaa.html');
    await submit(s.port, { category: 'confirmed observable anomaly', claim: 'z', evidence: 'C-aaaaaa and C-bbbbbb', nonce: s.nonce });
    await req(s.port, '/case-C-bbbbbb.html');
  } finally { await s.close(); }
  const cov = sessionCoverage(inv, s.dir), [f1, end] = cov.columns;
  const it = (c: typeof f1, id: string) => c.items.find(i => i.id === id)!;
  assert.equal(it(f1, 'C-aaaaaa').serverAccess, 'recorded');
  assert.equal(it(f1, 'C-bbbbbb').serverAccess, 'not-recorded', 'later access is not credited to the earlier finding');
  assert.deepEqual((f1.summary as { citedWithoutAccess: string[] }).citedWithoutAccess, ['C-bbbbbb']);
  assert.equal(it(end, 'C-bbbbbb').serverAccess, 'recorded');
  assert.equal(it(f1, 'C-bbbbbb').reconstructedVisit, 'not-available', 'no browser log supplied: not "no visit"');
  assert.equal(cov.accessEvidence.ordering, 'server sequence numbers');
  assert.ok(f1.seq! > 1 && f1.seq! < end.seq!);
  rmSync(f.root, { recursive: true, force: true });
});

test('AC-P1.6: completeness never reads agent summaries; a finding that claims full coverage does not satisfy must-access', async () => {
  const f = fixture(), inv = inventoryFromBundle(f.bundle as never);
  const s = await startGw2Server({ exp: 'claim', out: f.out, site: f.site });
  try { await submit(s.port, { category: 'clean / no problem found', claim: 'I opened every page: C-aaaaaa C-bbbbbb C-9fc650 M-cccccc', evidence: 'all pages accessed', nonce: s.nonce }); } finally { await s.close(); }
  const r = evaluate(validatePolicy(P([{ id: 'a', kind: 'must-access', targets: ['C-aaaaaa'], reason: 'r' }]), inv), inv, loadSession(s.dir));
  assert.equal(r.investigationCompleteness.requirements[0].result, 'unsatisfied');
  for (const f2 of ['policy.ts', 'session.ts', 'journal.ts']) {
    const src = readFileSync(join(ROOT, 'gamewatch/gw2', f2), 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
    assert.ok(!/run_end|\.summary\b|one_liner/.test(src), `${f2} does not read agent summaries`);
  }
  rmSync(f.root, { recursive: true, force: true });
});

test('a note edited after submission no longer joins its journal event and stops counting; its text is still reported', async () => {
  const f = fixture(), inv = inventoryFromBundle(f.bundle as never), s = await session(f);
  const nf = join(s.dir, 'notes.ndjson');
  const { writeFileSync } = await import('node:fs');
  writeFileSync(nf, readFileSync(nf, 'utf8').replace('step 3', 'step 4'));
  const ss = loadSession(s.dir);
  assert.equal(ss.findings[0].join, 'note-changed'); assert.equal(ss.findings[0].counts, false);
  const cov = sessionCoverage(inv, s.dir);
  assert.equal(cov.uncountedFindings.length, 1); assert.match(cov.uncountedFindings[0].verbatim, /step 4/);
  rmSync(f.root, { recursive: true, force: true });
});
