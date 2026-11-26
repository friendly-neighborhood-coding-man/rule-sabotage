/**
 * GW2 Extension V0 (D121-D128): three independent outputs and their boundaries.
 * Offline only: P7 published evidence and synthetic test doubles; no Kane, no paid call, no gate change.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, mkdtempSync, rmSync, cpSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { partitionReader, loadSubmissions, AccessRefused, type Hyp } from '../gamewatch/gw2/ext/inputs.ts';
import { behaviourCore, buildBehaviour } from '../gamewatch/gw2/ext/behaviour.ts';
import { notificationsCore, buildNotifications, CLASSIFICATION } from '../gamewatch/gw2/ext/notifications.ts';
import { contradictionsCore, buildContradictions } from '../gamewatch/gw2/ext/contradictions.ts';
import { activateAgentFeedback, AGENT_FEEDBACK_ENABLED } from '../gamewatch/gw2/ext/feedback.ts';
import { buildFeedbackForTest as buildAgentFeedback, previewForTest as renderAgentFeedback } from '../gamewatch/gw2/ext/feedback-testonly.ts';
import { buildAll, render, safeDashboardDir } from '../gamewatch/gw2/ext/dashboard.ts';
import { PLAN, ARMS, MANIPULATED } from '../gamewatch/gw2/ext/control-plan.ts';
import { PAID_RESEARCH_EXECUTION } from '../server/balance/v4/kanebudget.ts';
import { resolvePage } from '../gamewatch/kane/serve.ts';

const ROOT = join(import.meta.dirname, '..');
const EXP = join(ROOT, 'evidence/gw2/p7-pilot/exp');
const sha = (f: string) => createHash('sha256').update(readFileSync(f)).digest('hex');
const all = buildAll(EXP);
const spec = JSON.parse(readFileSync(join(EXP, 'partitions/spec/spec.json'), 'utf8'));
const heldout = JSON.parse(readFileSync(join(EXP, 'partitions/heldout/observations.json'), 'utf8'));
const heldoutUnits: string[] = [...heldout.cases.map((c: any) => c.caseId), ...heldout.matches.map((m: any) => m.matchId)];
const ruleTexts: string[] = spec.game.rules.map((r: any) => r.text);

// ---------------------------------------------------------------- synthetic test doubles
const T = (id: string, f: Record<string, any>) => ({ id, kind: 'turn-start' as const, build: f.build ?? 'b1', source: { type: 'case' as const, id: id.split('/')[0], pointer: `/x/${id}` },
  fields: { build: 'b1', side: 'Human', turn: 1, isFirstMover: true, piecesOnBoard: 3, pendingBonus: 0, actionsGranted: 3, ...f } });
const law = (when: any, field: string, equals: any) => ({ form: 'law', situation: 'turn-start', ...(when ? { when } : {}), expect: [{ field, equals }] });
const eqBuild = (b: string) => ({ op: 'eq', args: [{ op: 'field', name: 'build' }, { op: 'const', value: b }] });
const H = (ref: string, clauses: any[] | null, o: Partial<Hyp> = {}): Hyp => ({ id: `h-${ref}`, ref, kind: 'hypothesis', session: 's1', index: 0, statement: `statement ${ref}`, confidence: 'high', evidence: 'C-1', structured: null, verbatim: `{"ref":"${ref}"}`,
  representations: clauses ? [{ id: `r-${ref}`, origin: 'submitter', fidelity: 'faithful', author: 'agent:double', representation: { clauses }, status: 'represented', clauses }] : [], ...o });

test('channel separation: A and C never read or contain the specification; B reads no submission; measures are three separate blocks', () => {
  for (const [name, out] of [['A', all.A], ['C', all.C]] as const) {
    assert.ok(!out.partitionsRead.some((p: string) => p.startsWith('spec/')), `${name} read the spec`);
    const text = JSON.stringify(out);
    for (const t of ruleTexts) assert.ok(!text.includes(t), `${name} contains spec text`);
    assert.ok(!/"rule"\s*:/.test(text) && !/encoding-2/.test(text), `${name} contains spec references`);
  }
  const b = JSON.stringify(all.B);
  for (const h of loadSubmissions(EXP).hyps) { assert.ok(!b.includes(h.id), 'B mentions a hypothesis'); if (h.statement) assert.ok(!b.includes(h.statement)); }
  assert.equal(all.B.agentInvolved, false);
  assert.deepEqual(Object.keys(all.M).sort(), ['agentBehaviouralDiscovery', 'combined', 'machineVerifiableDescriptions', 'systemDiscrepancyDetection']);
  assert.match(all.M.combined, /^never/);
});

test('access boundaries: readers refuse partitions outside their allow-list, tampered files and unbound manifests', () => {
  assert.throws(() => partitionReader(EXP, ['discovery']).read('heldout', 'observations.json'), AccessRefused);
  assert.throws(() => partitionReader(EXP, ['discovery']).read('spec', 'spec.json'), AccessRefused);
  assert.throws(() => partitionReader(EXP, ['discovery']).read('discovery', 'not-listed.json'), /not in the partition manifest/);
  const d = mkdtempSync(join(tmpdir(), 'gw2-ext-'));
  try {
    cpSync(EXP, join(d, 'exp'), { recursive: true });
    const f = join(d, 'exp/partitions/discovery/observations.json'); writeFileSync(f, readFileSync(f, 'utf8').replace('"build-06b9"', '"build-06b8"'));
    assert.throws(() => partitionReader(join(d, 'exp'), ['discovery']).read('discovery', 'observations.json'), /differs from its manifest/);
    const mf = join(d, 'exp/partitions/heldout/MANIFEST.json'); writeFileSync(mf, readFileSync(mf, 'utf8') + ' ');
    assert.throws(() => partitionReader(join(d, 'exp'), ['heldout']).read('heldout', 'observations.json'), /not the manifest bound by the freeze/);
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test('agent feedback: disabled by default; only discovery/feedback evidence; never held-out, spec, eval labels or a defect label', () => {
  assert.equal(AGENT_FEEDBACK_ENABLED, false);
  assert.throws(() => activateAgentFeedback(EXP, { session: '1e26529c62afc36e' }), /not enabled/); // V1: runtime activation is the only non-test path
  for (const p of ['heldout', 'spec', 'eval'] as any[]) assert.throws(() => buildAgentFeedback(EXP, { session: '1e26529c62afc36e', partitions: ['discovery', p] }), /never authorized/);
  const f = buildAgentFeedback(EXP, { session: '1e26529c62afc36e' });
  assert.deepEqual(f.partitionsRead, ['discovery/observations.json']);
  const text = JSON.stringify(f) + renderAgentFeedback(f);
  for (const u of heldoutUnits) assert.ok(!text.includes(u), `held-out unit ${u} disclosed`);
  for (const t of ruleTexts) assert.ok(!text.includes(t));
  assert.ok(!/QX-\d+|build-c1dc|build-78ff/.test(text), 'operator or held-out build ids disclosed');
  assert.ok(!/defect|bug|specification/i.test(text));
  assert.equal(f.items.length, 390, 'H-1 discovery counterexamples only');
  assert.ok(f.items.every(i => i.evidence === 'discovery' && i.yourHypothesis === 'H-1'));
  assert.deepEqual(f.withoutCheck, [{ yourHypothesis: 'H-4', reason: 'no structured representation: free text is not checked' }]);
  assert.equal(buildAgentFeedback(EXP, { session: 'e95f5bc28e46532c' }).items.length, 0);
  assert.deepEqual(buildAgentFeedback(EXP, { session: 'e95f5bc28e46532c' }).withoutCheck.map(x => x.yourHypothesis), ['H-1', 'H-2']);
});

// The feedback-partition test moved to tests/gw2-ext-v1.test.ts (V1, D130): a feedback partition now also needs the
// externally anchored pre-registration to bind its manifest, so the test builds such a record; its V0 assertions are kept there.

test('the operator dashboard cannot reach a discovery session', () => {
  const site = join(EXP, 'partitions/discovery/site');
  for (const p of ['/../../../../ext-v0/p7-operator/index.html', '/%2e%2e/%2e%2e/ext-v0/p7-operator/unmatched-actions.html', '/unmatched-actions.html'])
    { const r = resolvePage(p, site); assert.ok(r === null || !readdirSync(site).includes(r.page), p); }
  for (const d of [join(EXP, 'partitions/discovery/site/ops'), join(tmpdir(), 'x/site/ops'), join(ROOT, 'evidence/gw2/p7-pilot/ops'), join(ROOT, 'docs/ops'), join(ROOT, 'evidence/gw2/ext-v0/p7-operator')])
    assert.throws(() => safeDashboardDir(d), /refusing/, d);
});

test('notification correctness on test doubles: expected, observed, evidence, build, spec reference, provisional status, missing information', () => {
  const enc: any = { enc: { id: 'enc-test', status: 'draft', review: { status: 'unreviewed' } }, authoritative: false,
    usable: [{ rule: 'R1', clauses: [law(null, 'actionsGranted', { op: 'field', name: 'piecesOnBoard' })] }], inventory: [{ rule: 'R1', status: 'encoded' }, { rule: 'R2', status: 'unencoded', reason: 'not expressible' }] };
  const sits = { discovery: [T('C-1/s0/turn-start', {}), T('C-1/s4/turn-start', { piecesOnBoard: 2, actionsGranted: 3 }), T('C-2/s0/turn-start', { actionsGranted: null })], heldout: [T('C-9/s0/turn-start', { piecesOnBoard: 1, actionsGranted: 2, build: 'b1' })] };
  const r = notificationsCore([{ id: 'R1', text: 'one action per piece' }, { id: 'R2', text: 'other' }], enc, sits, { b1: { label: 'QX-1', heldoutIds: ['b9'] } });
  assert.equal(r.notifications.length, 2);
  const [d, h] = r.notifications;
  assert.deepEqual([d.partition, d.rule.id, d.rule.text, d.field, d.expected, d.observed, d.evidence.situation, d.evidence.unit, d.build.id, d.build.label], ['discovery', 'R1', 'one action per piece', 'actionsGranted', 2, 3, 'C-1/s4/turn-start', 'C-1', 'b1', 'QX-1']);
  assert.equal(h.partition, 'heldout');
  assert.equal(d.classification, CLASSIFICATION); assert.match(d.specificationStatus, /PROVISIONAL/); assert.match(r.specification.note, /PROVISIONAL/);
  assert.ok(!/\b(bug|defect)\b/i.test(JSON.stringify(r.notifications).replace(/not classified/g, '')));
  assert.deepEqual(r.notEncoded, [{ rule: 'R2', status: 'unencoded', reason: 'not expressible', consequence: 'no notification can be produced for this rule' }]);
  assert.equal(r.missingInformation.find(m => m.partition === 'discovery')?.outcomeUnknown, 1, 'an unrecorded outcome is missing information, not a notification');
  assert.equal(new Set(r.notifications.map(n => n.id)).size, 2);
  assert.deepEqual(notificationsCore([{ id: 'R1', text: 'x' }], enc, sits, {}).notifications.map(n => n.id).length, 2);
});

test('notification correctness on P7: per rule and build, the counts equal the committed O↔S contradicting outcome checks', () => {
  const tw = JSON.parse(readFileSync(join(EXP, 'evaluations/three-way-1.json'), 'utf8'));
  for (const x of tw.implementationCorrectness) {
    const n = all.B.notifications.filter((y: any) => y.rule.id === x.rule && y.partition === x.scope.partition && y.build.id === x.scope.build).length;
    assert.equal(n, x.scope.outcomeChecks?.contradicting ?? 0, `${x.rule} ${x.scope.partition} ${x.scope.build}`);
  }
  assert.equal(all.B.notifications.length, 338);
  assert.equal(all.B.notifications.find((n: any) => n.rule.id === 'R3')?.evidence.situation, 'C-0662fc/s0/turn-start');
  assert.match(all.B.specification.note, /PROVISIONAL/);
});

test('missing information and conflicting hypotheses on test doubles', () => {
  const sits = { discovery: [T('C-1/s0/turn-start', {}), T('C-1/s4/turn-start', { piecesOnBoard: 2, actionsGranted: 2 }), T('C-2/s0/turn-start', { actionsGranted: null })] };
  const hyps = [H('H-1', [law(eqBuild('b1'), 'actionsGranted', { op: 'const', value: 3 })]), H('H-2', [law(null, 'actionsGranted', { op: 'field', name: 'piecesOnBoard' })], { session: 's2' }), H('H-3', null, { session: 's2' }), H('A-1', null, { kind: 'abstention' })];
  const c = contradictionsCore(hyps, sits, {}, ['discovery']);
  assert.deepEqual(c.contradictions.map(x => [x.hypothesis.ref, x.evidence.situation, x.predicted, x.observed]), [['H-1', 'C-1/s4/turn-start', 3, 2]]);
  assert.deepEqual(c.conflictsBetweenHypotheses.map(x => [x.situation, x.field, x.predictions.map((p: any) => `${p.ref}=${p.predicted}`).join(',')]), [['C-1/s4/turn-start', 'actionsGranted', 'H-1=3,H-2=2']]);
  assert.deepEqual(c.notEvaluable.map(x => x.ref), ['H-3'], 'free text is listed, abstention is not a claim');
  const a = behaviourCore(hyps, sits, {});
  assert.deepEqual(a.map(x => [x.ref, x.verificationStatus]), [['H-1', 'contradicted by discovery evidence'], ['H-2', 'consistent with discovery evidence'], ['H-3', 'not machine-evaluable: free text only (no structured representation)'], ['A-1', 'abstention (no claim)']]);
  const h1 = a[0].representations[0].byBuild[0].clauses[0].discovery;
  assert.equal(h1.outcomeChecks.unknown, 1, 'the unrecorded outcome is unknown, not support and not a counterexample');
  assert.equal(h1.counterexamples, 1);
});

test('preservation: every original submission appears verbatim; building the outputs changes no published P7 file', () => {
  const rec = JSON.parse(readFileSync(join(ROOT, 'evidence/gw2/p7-pilot/REDACTION_RECORD.json'), 'utf8'));
  const before = rec.files.map((f: any) => sha(join(ROOT, f.file)));
  const A = buildBehaviour(EXP); buildNotifications(EXP); buildContradictions(EXP);
  const hyps = loadSubmissions(EXP).hyps;
  assert.equal(A.hypotheses.length, 8);
  for (const h of hyps) { const x = A.hypotheses.find((y: any) => y.hypothesis === h.id)!; assert.equal(x.submitted.verbatim, h.verbatim); assert.equal(x.submitted.statement, h.statement); }
  assert.equal(A.hypotheses.filter((h: any) => /free text only/.test(h.verificationStatus)).length, 5);
  assert.deepEqual(rec.files.map((f: any) => sha(join(ROOT, f.file))), before);
  assert.deepEqual(before, rec.files.map((f: any) => f.publishedSha256));
});

test('determinism: the committed P7 operator dashboard is exactly what the builder renders', () => {
  const files = render(buildAll(EXP), 'P7 pilot (published evidence)'), dir = join(ROOT, 'evidence/gw2/ext-v0/p7-operator');
  assert.deepEqual(readdirSync(dir).sort(), Object.keys(files).sort());
  for (const [f, t] of Object.entries(files)) assert.equal(readFileSync(join(dir, f), 'utf8'), t, f);
  assert.equal(all.M.agentBehaviouralDiscovery.heldoutOutcomeChecks.matching, 194);
  assert.equal(all.M.agentBehaviouralDiscovery.heldoutOutcomeChecks.contradicting, 190);
  assert.equal(all.M.machineVerifiableDescriptions.accurateDescriptions, 0);
  assert.equal(all.C.contradictions.length, 390 + 187 + 2 + 1);
});

test('fresh matched no-notification control: prepared, not executable; arms differ only in the manipulated factor', () => {
  assert.equal(PLAN.executable, false); assert.equal(PAID_RESEARCH_EXECUTION, 'disabled');
  assert.deepEqual([...MANIPULATED], ['agentHypothesisFeedback']);
  const strip = (a: any) => Object.fromEntries(Object.entries(a).filter(([k]) => !(MANIPULATED as readonly string[]).includes(k)));
  assert.deepEqual(strip(ARMS.control), strip(ARMS.feedback));
  assert.equal(ARMS.control.specificationShownToAgent, false);
  assert.match(ARMS.control.revisionOpportunity, /revision/, 'the control gets the same revision window, without feedback');
  assert.match(PLAN.historicalBaseline.role, /not a matched control/);
});
