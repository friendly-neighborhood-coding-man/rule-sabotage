/**
 * GW2 matched comparison (D136-D145): prepared pipeline, tested end to end with test doubles on the DEVELOPMENT dataset
 * (matched-generation-1). The experiment evidence (matched-evidence-2) is never read here beyond its manifests.
 * No Kane call, no paid call, no inference; both gates stay closed.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, rmSync, readdirSync, existsSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { MATCHED, estimate } from '../gamewatch/gw2/matched/params.ts';
import { schedule, feedbackRuns } from '../gamewatch/gw2/matched/schedule.ts';
import { preregisterMatched, verifyMatchedPrereg, matchedPlan } from '../gamewatch/gw2/matched/prereg.ts';
import { runMatched, budgetPreflight, cumulative, nextCall } from '../gamewatch/gw2/matched/pipeline.ts';
import { doubleRunner, type Profile } from '../gamewatch/gw2/matched/doubles.ts';
import { sessionFeedbackForTest } from '../gamewatch/gw2/matched/feedback-testonly.ts';
import { activateSessionFeedback, constructSessionFeedback } from '../gamewatch/gw2/matched/feedback.ts';
import { loadFrozen, graphOf, sessionDir } from '../gamewatch/gw2/matched/sessions.ts';
import { evaluateMatched } from '../gamewatch/gw2/matched/evaluate.ts';
import { kaneRunner } from '../gamewatch/gw2/matched/kane-runner.ts';
import { NO_FEEDBACK } from '../gamewatch/gw2/matched/revision-page.ts';
import { selectFeedback, renderFeedbackSection, FEEDBACK_CAP } from '../gamewatch/gw2/ext/feedback-core.ts';
import { activationProblems, AGENT_FEEDBACK_ENABLED } from '../gamewatch/gw2/ext/feedback.ts';
import { readExecLedger, appendCheckpoint } from '../gamewatch/gw2/p7-exec.ts';
import { startGw2Server } from '../gamewatch/gw2/serve.ts';
import { PAID_RESEARCH_EXECUTION } from '../server/balance/v4/kanebudget.ts';
import { buildAll } from '../gamewatch/gw2/ext/dashboard.ts';
import { renderV2, safeDashboardDirV2 } from '../gamewatch/gw2/ext/dashboard-v2.ts';

const ROOT = join(import.meta.dirname, '..');
const DEV = join(ROOT, MATCHED.devEvidence), EXP2 = join(ROOT, MATCHED.evidence);
const sha = (b: string | Buffer) => createHash('sha256').update(b).digest('hex');
const spec = JSON.parse(readFileSync(join(DEV, 'partitions/spec/spec.json'), 'utf8'));
const ruleTexts: string[] = spec.game.rules.map((r: any) => r.text);
const heldout = JSON.parse(readFileSync(join(DEV, 'partitions/heldout/observations.json'), 'utf8'));
const heldoutUnits: string[] = [...heldout.cases.map((c: any) => c.caseId), ...heldout.matches.map((m: any) => m.matchId)];
const PROFILES: Record<string, Profile> = { M01: 'reviser', M02: 'reviser', M03: 'conflicted', M04: 'keeper', M05: 'freetext', M06: 'early', M07: 'harmful', M08: 'reviser', M09: 'keeper', M10: 'reviser' };
const ledger = (rec: string) => readExecLedger(rec).entries as any[];

function setup() {
  const d = mkdtempSync(join(tmpdir(), 'gw2-matched-')), run = join(d, 'run'), rec = join(d, 'record');
  preregisterMatched(DEV, rec);
  return { d, run, rec, done: () => rmSync(d, { recursive: true, force: true }) };
}

// one full run shared by several tests
const full = await (async () => {
  const s = setup(), { runner, seen } = doubleRunner(x => PROFILES[x]);
  const result = await runMatched({ evidence: DEV, run: s.run, rec: s.rec, runner, feedback: { kind: 'test-only', build: sessionFeedbackForTest } });
  return { ...s, result, seen };
})();
process.on('exit', () => full.done());

test('parameters and schedule: 5 + 5 sessions in balanced blocks from seed 20261126; 20 calls; feedback only for treatment phase 2', () => {
  assert.deepEqual(MATCHED.sessionsPerArm, { control: 5, treatment: 5 }); assert.equal(MATCHED.seed, 20261126); assert.equal(MATCHED.callsTotal, 20);
  assert.deepEqual([MATCHED.phases[1].maxSteps, MATCHED.phases[1].timeoutS, MATCHED.phases[1].ceilingCredits], [80, 2700, 300]);
  assert.deepEqual([MATCHED.phases[2].maxSteps, MATCHED.phases[2].timeoutS, MATCHED.phases[2].ceilingCredits], [40, 1350, 150]);
  assert.equal(MATCHED.feedback.cap, 25); assert.deepEqual([...MATCHED.feedback.evidence], ['discovery']); assert.equal(MATCHED.researchThresholdCredits, 4000);
  assert.ok(estimate(1) <= 300 && estimate(2) <= 150, 'the existing preflight estimate fits both ceilings');
  const s = schedule();
  assert.deepEqual(s, schedule(), 'deterministic');
  assert.equal(s.length, 10);
  for (let b = 1; b <= 5; b++) assert.deepEqual(s.filter(x => x.block === b).map(x => x.arm).sort(), ['control', 'treatment'], `block ${b} balanced`);
  assert.ok(s.some(x => x.block > 1 && s.find(y => y.block === x.block)!.arm !== s[0].arm), 'order varies between blocks');
  assert.deepEqual(feedbackRuns().map(r => r.session), s.filter(x => x.arm === 'treatment').map(x => x.session));
  assert.ok(feedbackRuns().every(r => r.phase === 2 && r.arm === 'treatment' && r.runId.endsWith('-P2')));
  assert.equal(PAID_RESEARCH_EXECUTION, 'disabled'); assert.equal(AGENT_FEEDBACK_ENABLED, false);
});

test('feedback cap: deterministic, every pattern before any repeat, shown vs total reported; rendering refuses more than the cap', () => {
  const it = (n: number, pred: number, obs: number) => ({ id: `i${n}`, yourHypothesis: 'H-1', clause: 0, evidence: 'discovery', build: 'b', situation: `C-${String(n).padStart(3, '0')}/s0`, page: 'C', outcome: 'actionsGranted', yourPrediction: pred, recorded: obs });
  const items = [...Array.from({ length: 40 }, (_, i) => it(i, 3, 2)), ...Array.from({ length: 30 }, (_, i) => it(100 + i, 3, 4)), it(500, 3, 1)];
  const a = selectFeedback(items), b = selectFeedback([...items].reverse());
  assert.deepEqual(a.shown.map(x => x.id), b.shown.map(x => x.id), 'input order does not matter');
  assert.equal(a.shown.length, 25);
  assert.deepEqual(a.patterns.map(p => [p.recorded, p.total, p.shown]), [[1, 1, 1], [2, 40, 12], [4, 30, 12]], 'the rare pattern is shown; the rest are balanced');
  assert.equal(selectFeedback(items.slice(0, 5)).shown.length, 5);
  assert.throws(() => selectFeedback(items, 0), /positive integer/);
  const f: any = { cap: 25, notice: 'n', totals: { shown: 26, differing: 71 }, summary: [{ yourHypothesis: 'H-1', totalDiffering: 71, shown: 26, patternsTotal: 3, patternsShown: 3 }], items: items.slice(0, 26), withoutCheck: [] };
  assert.throws(() => renderFeedbackSection(f), /exceed the cap/);
  assert.throws(() => renderFeedbackSection({ ...f, cap: 30 }), /not the pre-registered cap/);
  assert.throws(() => renderFeedbackSection({ ...f, items: items.slice(0, 24) }), /does not match the items shown/);
  assert.match(renderFeedbackSection({ ...f, items: a.shown, totals: { shown: 25, differing: 71 }, summary: [{ ...f.summary[0], shown: 25 }] }), /Showing 25 of 71 recorded observations/);
  assert.equal(FEEDBACK_CAP, 25);
});

test('pipeline on test doubles: every session runs both phases in order, each freeze independently anchored', () => {
  const L = ledger(full.rec), sched = schedule();
  assert.equal(full.result.stopped, null);
  assert.deepEqual(L.filter(e => e.event === 'call-start').map(e => e.data.runId), sched.flatMap(s => [s.runs[1], s.runs[2]]), 'strictly sequential, phase 1 then phase 2');
  assert.equal(L.filter(e => e.event === 'call-end').length, 20);
  for (const s of sched) {
    const f1 = loadFrozen(full.run, full.rec, s.session, 1), f2 = loadFrozen(full.run, full.rec, s.session, 2);
    assert.equal(f2.freeze.freeze1Sha256, f1.freezeSha256);
    assert.ok(f2.freeze.graphHead.count >= f1.freeze.graphHead.count);
    assert.ok(f1.nodes.every(n => (n.body as any).session === s.session), 'own session only');
  }
  assert.equal(new Set(L.filter(e => e.event.startsWith('freeze-')).map(e => e.data.freezeSha256)).size, 20, 'twenty distinct anchors');
  assert.equal(cumulative(full.rec), Math.round((MATCHED.priorResearchCredits + 20 * 40) * 1000) / 1000, 'balance-delta accounting');
});

test('phase 2: same shell in both arms; treatment gets only capped discovery feedback on its own Freeze-1; control gets none', () => {
  const page = (runId: string) => full.seen[runId].revision!;
  const ctl = page('GW2-M01-P2'), trt = page('GW2-M02-P2'); // both "reviser"
  assert.match(ctl, new RegExp(NO_FEEDBACK)); assert.ok(!trt.includes(NO_FEEDBACK));
  const shell = (h: string) => h.replace(/<h2>Observations that differ from your structured hypotheses<\/h2>[\s\S]*?<h2>What you can do<\/h2>/, '§');
  assert.equal(shell(ctl), shell(trt), 'identical apart from the feedback section');
  for (const s of schedule()) {
    const p = page(s.runs[2]);
    for (const t of ruleTexts) assert.ok(!p.includes(t), 'no specification text');
    for (const u of heldoutUnits) assert.ok(!p.includes(u), `held-out unit ${u} disclosed`);
    for (const o of schedule().filter(x => x.session !== s.session && PROFILES[x.session] !== PROFILES[s.session])) for (const st of ['Two actions per turn.', 'Moves seem limited each turn.']) if (p.includes(st)) assert.ok(PROFILES[s.session] === 'conflicted' || PROFILES[s.session] === 'freetext', 'another session leaked');
    if (s.arm === 'treatment') { const n = (p.match(/<tr><td>[CM]-[0-9a-f]{6}<\/td>/g) ?? []).length; assert.ok(n <= 25 * 3, 'capped'); assert.match(p, /Showing \d+ of \d+ recorded observations/); }
  }
  const evs = ledger(full.rec).filter(e => e.event === 'revision-page');
  assert.equal(evs.length, 10);
  assert.ok(evs.every(e => (e.data.arm === 'treatment') === (e.data.feedback !== null)));
  assert.ok(evs.filter(e => e.data.feedback).every(e => e.data.feedback.cap === 25 && e.data.feedback.shown <= 25 * 3 && e.data.feedback.testOnly === true));
  const site = join(sessionDir(full.run, 'M02'), 'site-2');
  assert.ok(readFileSync(join(site, 'hypothesis.html'), 'utf8').includes('name="revises"'));
  assert.ok(!readdirSync(site).some(f => /unmatched|contradictions|behaviour|measures/.test(f)));
});

test('feedback reads only the authenticated Freeze-1 prefix: later nodes and appended bytes change nothing', () => {
  const f = constructSessionFeedback(DEV, full.run, full.rec, 'M02');
  const lines = readFileSync(graphOf(full.run, 'M02'), 'utf8').split('\n').filter(Boolean), f1 = loadFrozen(full.run, full.rec, 'M02', 1);
  assert.ok(lines.length > f1.freeze.graphHead.count, 'phase-2 nodes exist after the Freeze-1 prefix');
  assert.deepEqual(f.partitionsRead, ['discovery/observations.json'], 'discovery only, through the pre-registered manifest');
  const ev = ledger(full.rec).find(e => e.event === 'revision-page' && e.data.session === 'M02');
  assert.equal(f.digest, ev.data.feedback.digest, 'the same feedback before and after phase 2');
  assert.ok(f.items.every(i => i.evidence === 'discovery' && !heldoutUnits.includes(i.page)));
});

test('originals preserved; revisions, withdrawals, conflicts, early termination and missing representations are recorded as such', () => {
  for (const s of schedule()) {
    const f1 = loadFrozen(full.run, full.rec, s.session, 1), f2 = loadFrozen(full.run, full.rec, s.session, 2);
    const later = new Map(f2.nodes.map(n => [n.id, n]));
    for (const n of f1.nodes) assert.deepEqual(later.get(n.id), n, 'every phase-1 node unchanged in the later prefix');
    for (const sub of f2.submissions.filter((x: any) => x.revision?.resolved)) {
      const n = later.get(sub.id)!; assert.deepEqual(n.parents, [{ id: sub.revision.of, relation: 'refines' }]);
    }
  }
  const call = (s: string, p: number) => ledger(full.rec).find(e => e.event === 'call-end' && e.data.session === s && e.data.phase === p).data;
  assert.equal(call('M06', 1).timedOut, true); assert.equal(call('M06', 1).runEndPresent, false);
  assert.equal(loadFrozen(full.run, full.rec, 'M06', 1).freeze.callStatus, 'inconclusive');
  assert.equal(loadFrozen(full.run, full.rec, 'M06', 2).freeze.callStatus, 'completed', 'the session continued after early termination');
  assert.equal(loadFrozen(full.run, full.rec, 'M06', 1).submissions.length, 1, 'what was submitted before the stop is kept');
  assert.equal(loadFrozen(full.run, full.rec, 'M04', 2).submissions.length, 0, 'keeping everything is a valid phase 2');
});

test('single evaluation: refused before freezing is complete, opened once, session-level outcomes reported separately', async () => {
  const s = setup();
  try {
    const { runner } = doubleRunner(x => PROFILES[x]);
    await runMatched({ evidence: DEV, run: s.run, rec: s.rec, runner, feedback: { kind: 'test-only', build: sessionFeedbackForTest }, sessions: schedule().slice(0, 2) });
    assert.throws(() => evaluateMatched(DEV, s.run, s.rec), /stays closed: M03 phase 1 is not frozen/);
    assert.ok(!ledger(s.rec).some(e => e.event === 'gate-opened'));
  } finally { s.done(); }
  const e = evaluateMatched(DEV, full.run, full.rec);
  assert.throws(() => evaluateMatched(DEV, full.run, full.rec), /already opened once/);
  assert.equal(ledger(full.rec).filter(x => x.event === 'gate-opened').length, 1);
  const by = (x: string) => e.sessions.find(s => s.session === x)!;
  assert.deepEqual(by('M01').actions, { kept: 1, revised: 1, withdrawn: 1, conflicting: 0, additions: 0 });
  assert.equal(by('M01').revisionEffects.corrections, 1);
  assert.equal(by('M03').actions.conflicting, 1); assert.equal(by('M03').revisionEffects.corrections + by('M03').revisionEffects.harmful, 0, 'conflicting revisions are not scored');
  assert.equal(by('M07').revisionEffects.harmful, 1);
  assert.deepEqual(by('M05').representationAvailability.phase1, { hypotheses: 2, withStructuredRepresentation: 0 });
  assert.equal(by('M05').heldout.initial.accuracy, null, 'free text: nothing machine-evaluable, not a zero');
  assert.equal(by('M01').abstentions.phase1, 1); assert.equal(by('M01').abstentions.withdrawalsPhase2, 1);
  assert.equal(by('M06').complete, false);
  assert.deepEqual(e.blocks.map(b => b.complete), [true, true, false, true, true], 'an incomplete session leaves its block out of the comparison');
  assert.match(e.unit, /not replications/);
  assert.ok(e.arms.every(a => a.sessions === 5 && a.accuracyChange.length === 5));
});

test('budget failures stop the whole experiment after the call is frozen; nothing is retried; preflight refuses a call that could cross 4,000', async () => {
  for (const [profile, outcome] of [['overspend', 'CEILING_EXCEEDED'], ['unknown', 'SPEND_UNKNOWN']] as const) {
    const s = setup();
    try {
      const { runner } = doubleRunner(() => profile);
      const r = await runMatched({ evidence: DEV, run: s.run, rec: s.rec, runner, feedback: { kind: 'test-only', build: sessionFeedbackForTest } });
      const L = ledger(s.rec);
      assert.match(r.stopped!, /GW2-M01-P1/); assert.equal(L.filter(e => e.event === 'call-start').length, 1, 'no further call');
      assert.equal(L.find(e => e.event === 'call-end').data.outcome, outcome);
      assert.ok(existsSync(join(sessionDir(s.run, 'M01'), 'FREEZE-1.json')), 'the stopped call is still frozen');
      assert.ok(L.some(e => e.event === 'experiment-stopped'));
      const ev = evaluateMatched(DEV, s.run, s.rec);
      assert.ok(ev.stopped && ev.blocks.every(b => !b.complete));
    } finally { s.done(); }
  }
  const s = setup();
  try {
    assert.equal(budgetPreflight(s.rec, 1), null);
    appendCheckpoint(s.rec, 'call-start', { runId: 'X' }); appendCheckpoint(s.rec, 'call-end', { runId: 'X', used: 3600 });
    assert.match(budgetPreflight(s.rec, 1)!, /would exceed the 4000-credit threshold/);
    assert.equal(budgetPreflight(s.rec, 2), null, '3732.043 + 150 stays below 4,000');
    appendCheckpoint(s.rec, 'call-start', { runId: 'Y' });
    assert.match(budgetPreflight(s.rec, 2)!, /unknown/, 'a started call without an end makes the spend unknown');
  } finally { s.done(); }
});

test('one call per invocation: resumable from the ledger, each run id started once, same freezes as one pass; a stop or a dangling call refuses', async () => {
  const s = setup();
  try {
    const { runner } = doubleRunner(x => PROFILES[x]), opts = { evidence: DEV, run: s.run, rec: s.rec, runner, feedback: { kind: 'test-only' as const, build: sessionFeedbackForTest }, maxCalls: 1 };
    const order: string[] = [];
    for (let i = 0; i < 20; i++) { const n = nextCall(s.rec)!; order.push(n.runId); const r = await runMatched(opts); assert.equal(r.sessions.flatMap(x => x.phases).length, 1); }
    assert.deepEqual(order, schedule().flatMap(x => [x.runs[1], x.runs[2]]), 'strict schedule order');
    assert.equal(nextCall(s.rec), null);
    const again = await runMatched(opts); assert.equal(again.sessions.length, 0, 'nothing is repeated');
    const starts = ledger(s.rec).filter(e => e.event === 'call-start').map(e => e.data.runId);
    assert.equal(starts.length, 20); assert.equal(new Set(starts).size, 20);
    for (const x of schedule()) for (const p of [1, 2]) {
      const a = loadFrozen(s.run, s.rec, x.session, p).hyps.map(h => [h.ref, h.kind, h.statement]), b = loadFrozen(full.run, full.rec, x.session, p).hyps.map(h => [h.ref, h.kind, h.statement]);
      assert.deepEqual(a, b, `${x.session} Freeze-${p} equals the one-pass run`);
    }
  } finally { s.done(); }
  const t = setup();
  try {
    appendCheckpoint(t.rec, 'call-start', { runId: 'GW2-M01-P1', session: 'M01', phase: 1 });
    assert.throws(() => nextCall(t.rec), /never repeated/);
    const { runner } = doubleRunner(() => 'reviser');
    await assert.rejects(runMatched({ evidence: DEV, run: t.run, rec: t.rec, runner, feedback: { kind: 'test-only', build: sessionFeedbackForTest } }), /never repeated/);
    appendCheckpoint(t.rec, 'experiment-stopped', { reason: 'test' });
    assert.throws(() => nextCall(t.rec), /stopped/);
  } finally { t.done(); }
});

test('gates: a Kane run is refused before any server or process; test-only feedback never pairs with Kane; runtime feedback refuses while disabled', async () => {
  const s = setup();
  try {
    let probed = false;
    const k = kaneRunner(s.run, { probe: { isRealCli: async () => { probed = true; return true; }, balance: async () => { probed = true; return 5000; } } });
    await assert.rejects(runMatched({ evidence: DEV, run: s.run, rec: s.rec, runner: k, feedback: { kind: 'runtime', authorizationFor: () => ({} as any) } }), /paid-call gate is disabled/);
    assert.match((await k.preflight!({ runId: 'GW2-M01-P1', session: 'M01', arm: 'control', phase: 1, objective: '', maxSteps: 80, timeoutS: 2700, ceilingCredits: 300 }))!, /disabled/);
    assert.equal(probed, false, 'the gate refuses before consulting the CLI');
    assert.ok(!existsSync(join(s.run, 'sessions')), 'no server session was created');
    await assert.rejects(runMatched({ evidence: DEV, run: s.run, rec: s.rec, runner: k, feedback: { kind: 'test-only', build: sessionFeedbackForTest } }), /only with a test-double runner/);
    const { runner } = doubleRunner(x => PROFILES[x]);
    const pre = verifyMatchedPrereg(DEV, s.rec);
    const auth = (sl: any) => ({ runId: sl.runs[2], session: sl.session, arm: sl.arm, phase: 2, preregSha256: pre.preregSha256, operatorAuthorization: 'test double' });
    await assert.rejects(runMatched({ evidence: DEV, run: s.run, rec: s.rec, runner, feedback: { kind: 'runtime', authorizationFor: auth }, sessions: schedule().slice(0, 2) }), /not enabled/);
    assert.throws(() => activateSessionFeedback(DEV, s.run, s.rec, { session: 'M02', authorization: auth(schedule()[1]) }), /not enabled/);
    const plan = { preregSha256: pre.preregSha256, prereg: pre.prereg };
    assert.deepEqual(activationProblems(true, auth(schedule()[1]), plan, { session: 'M02', phase: 2 }), [], 'a listed treatment run would pass the rule');
    assert.match(activationProblems(true, { ...auth(schedule()[0]), arm: 'treatment' }, plan, { session: 'M01', phase: 2 }).join(), /does not list run GW2-M01-P2/, 'a control session cannot be authorized');
    assert.match(activationProblems(true, { ...auth(schedule()[1]), runId: 'GW2-M02-P1' }, plan, { session: 'M02', phase: 2 }).join(), /does not list/);
  } finally { s.done(); }
});

test('pre-registration binds manifests, files and schedule; the experiment evidence is distinct and unread', () => {
  const s = setup();
  try {
    assert.doesNotThrow(() => verifyMatchedPrereg(DEV, s.rec));
    const p = JSON.parse(readFileSync(join(s.rec, 'PREREGISTRATION.json'), 'utf8'));
    assert.deepEqual(p.plan.schedule, schedule()); assert.deepEqual(p.plan.agentFeedback.runs, feedbackRuns());
    assert.ok(Object.keys(p.files).includes('gamewatch/gw2/matched/pipeline.ts'));
    assert.throws(() => verifyMatchedPrereg(EXP2, s.rec), /not the manifest bound by the pre-registration/, 'another evidence set is refused');
    assert.throws(() => preregisterMatched(DEV, s.rec), /written once/);
  } finally { s.done(); }
  const m1 = matchedPlan(DEV).plan.evidence.manifests, m2 = matchedPlan(EXP2).plan.evidence.manifests;
  for (const k of Object.keys(m1)) assert.notEqual((m1 as any)[k], (m2 as any)[k], `${k} differs between the dry-run and the experiment evidence`);
  const proc = JSON.parse(readFileSync(join(ROOT, MATCHED.procedures.generation), 'utf8'));
  assert.deepEqual(proc.runs.experiment.matches.seeds, Array.from({ length: 12 }, (_, i) => 98501 + i));
});

test('phase-2 server keeps only the revises field in addition; any other extra field is refused', async () => {
  const d = mkdtempSync(join(tmpdir(), 'gw2-matched-srv-'));
  try {
    await assert.rejects(startGw2Server({ exp: 'x', out: join(d, 'o'), site: join(DEV, 'partitions/discovery/site'), extraHypothesisFields: ['spec'] }), /cannot be added/);
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test('dashboard V2: invariance label corrected; committed bytes equal the renderer; V1 kept', () => {
  const P7 = join(ROOT, 'evidence/gw2/p7-pilot/exp'), files = renderV2(buildAll(P7), 'P7 pilot (published evidence)', P7), dir = join(ROOT, 'evidence/gw2/ext-v2/p7-operator');
  assert.deepEqual(readdirSync(dir).sort(), Object.keys(files).sort());
  for (const [f, t] of Object.entries(files)) assert.equal(readFileSync(join(dir, f), 'utf8'), t, f);
  const u = files['unmatched-actions.html'];
  assert.equal((u.match(/<td>within-build invariance \(matched situation differing in pieceSide, effectOwner\)<\/td>/g) ?? []).length, 4);
  assert.ok(!/<td>cross-build invariance<\/td>/.test(u));
  assert.match(readFileSync(join(ROOT, 'evidence/gw2/ext-v1/p7-operator/unmatched-actions.html'), 'utf8'), /<td>cross-build invariance<\/td>/, 'V1 kept as committed');
  assert.throws(() => safeDashboardDirV2(join(ROOT, 'evidence/gw2/ext-v1/x')), /refusing/);
});
