/**
 * GW2 matched comparison (D136-D145): prepared pipeline, tested end to end with test doubles on the DEVELOPMENT dataset
 * (matched-generation-1). The experiment evidence (matched-evidence-2) is never read here beyond its manifests.
 * No Kane call, no paid call, no inference; both gates stay closed.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, rmSync, readdirSync, existsSync, appendFileSync, mkdirSync, cpSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { MATCHED, estimate } from '../gamewatch/gw2/matched/params.ts';
import { schedule, feedbackRuns } from '../gamewatch/gw2/matched/schedule.ts';
import { preregisterMatched, verifyMatchedPrereg, matchedPlan, dependencySet, headCommit, MATCHED_DOCS } from '../gamewatch/gw2/matched/prereg.ts';
import { runMatched, budgetPreflight, cumulative, nextCall, callComplete } from '../gamewatch/gw2/matched/pipeline.ts';
import { doubleRunner, DRY_RUN_PROFILES, driveSite, doubleStdout, LAWS, type Profile } from '../gamewatch/gw2/matched/doubles.ts';
import { executionProblems, discoverySiteProblems } from '../gamewatch/gw2/matched/integrity.ts';
import { candidateProblems, candidateText, checkCandidate, GATE_FILE, FEEDBACK_FILE } from '../gamewatch/gw2/matched/candidate.ts';
import { dryRun } from '../gamewatch/gw2/matched/dry-run.ts';
import { esc } from '../gamewatch/gw2/ext/html.ts';
import { sessionFeedbackForTest } from '../gamewatch/gw2/matched/feedback-testonly.ts';
import { activateSessionFeedback, constructSessionFeedback } from '../gamewatch/gw2/matched/feedback.ts';
import { loadFrozen, graphOf, sessionDir, importPhase } from '../gamewatch/gw2/matched/sessions.ts';
import { evaluateMatched, sessionOutcomes, sessionComplete } from '../gamewatch/gw2/matched/evaluate.ts';
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
const PROFILES: Record<string, Profile> = DRY_RUN_PROFILES; // M09 'narrower' (was 'keeper' before the final preflight; M04 still keeps)
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
  const shell = (h: string) => h.replace(/<h2>Observations that differ from the structured hypotheses<\/h2>[\s\S]*?<h2>What you can do<\/h2>/, '§');
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
  assert.equal(by('M01').revisionEffectsByAccuracy.corrections, 1, 'the original accuracy-based measure is kept');
  assert.equal(by('M01').revisionEffects.mixed, 1, 'target-based: corrections on common targets AND newly incorrect predictions');
  assert.ok(by('M01').targets.heldout.common.corrected > 0 && by('M01').targets.heldout.common.becameIncorrect > 0);
  assert.equal(by('M03').actions.conflicting, 1);
  for (const k of ['corrections', 'mixed', 'harmful', 'narrowingOnly', 'unchanged'] as const) assert.equal(by('M03').revisionEffects[k], 0, 'conflicting revisions are not scored');
  assert.equal(by('M03').revisionEffectsByAccuracy.corrections + by('M03').revisionEffectsByAccuracy.harmful, 0);
  assert.equal(by('M07').revisionEffectsByAccuracy.harmful, 1);
  assert.ok(by('M07').targets.heldout.common.becameIncorrect > by('M07').targets.heldout.common.corrected, 'the worse law makes more common targets incorrect than it corrects');
  assert.deepEqual(by('M05').representationAvailability.phase1, { hypotheses: 2, withStructuredRepresentation: 0 });
  assert.equal(by('M05').heldout.initial.accuracy, null, 'free text: nothing machine-evaluable, not a zero');
  assert.equal(by('M01').abstentions.phase1, 1); assert.equal(by('M01').abstentions.withdrawalsPhase2, 1);
  assert.equal(by('M06').complete, false);
  assert.deepEqual(e.blocks.map(b => b.complete), [true, true, false, true, true], 'an incomplete session leaves its block out of the comparison');
  assert.match(e.unit, /not replications/);
  // narrowing: accuracy rises only because predictions were dropped; never reported as self-correction
  const n = by('M09');
  assert.ok(n.heldout.change.accuracy! > 0 && n.heldout.change.coverage! < 0, 'accuracy up, coverage down');
  assert.equal(n.targets.heldout.common.corrected, 0); assert.ok(n.targets.heldout.situations.contraction > 0);
  assert.match(n.targets.attribution, /^narrowing only: .*not self-correction/);
  assert.equal(n.revisionEffects.narrowingOnly, 1); assert.equal(n.revisionEffects.corrections, 0);
  // the other promised measures are present, separately
  for (const x of e.sessions) {
    assert.ok('initial' in x.discoveryFit && 'final' in x.discoveryFit && 'targets' in x.discoveryFit);
    assert.ok(x.cReadings && 'discovery' in x.cReadings.initial.byPartition && 'heldout' in x.cReadings.final.byPartition);
    assert.ok(typeof x.counterexamples.final.total === 'number' && 'novelty' in x.counterexamples.final);
    assert.ok(Array.isArray(x.withdrawals) && Array.isArray(x.abstentionsPhase1) && Array.isArray(x.representationLoss));
  }
  assert.deepEqual(by('M01').withdrawals, ['H-2']); assert.deepEqual(by('M01').abstentionsPhase1, ['H-3']);
  assert.equal(e.encoding.file, MATCHED.encoding);
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
    for (let i = 0; i < 20; i++) { const n = nextCall(s.run, s.rec)!; order.push(n.runId); const r = await runMatched(opts); assert.equal(r.sessions.flatMap(x => x.phases).length, 1); }
    assert.deepEqual(order, schedule().flatMap(x => [x.runs[1], x.runs[2]]), 'strict schedule order');
    assert.equal(nextCall(s.run, s.rec), null);
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
    assert.throws(() => nextCall(t.run, t.rec), /never repeated/);
    const { runner } = doubleRunner(() => 'reviser');
    await assert.rejects(runMatched({ evidence: DEV, run: t.run, rec: t.rec, runner, feedback: { kind: 'test-only', build: sessionFeedbackForTest } }), /never repeated/);
    appendCheckpoint(t.rec, 'experiment-stopped', { reason: 'test' });
    assert.throws(() => nextCall(t.run, t.rec), /stopped/);
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

// ---------------------------------------------------------------- final execution preflight (D146-D153)

const slot = (session: string) => schedule().find(x => x.session === session)!;
/** A mocked process transport for kane-cli: version, balance and "run" (which drives the served site over HTTP). */
function mockTransport(profile: Profile, o: { balance?: number; used?: number; early?: boolean } = {}) {
  let balance = o.balance ?? 2000; const calls: string[][] = [];
  const transport = async (argv: string[]) => {
    calls.push(argv);
    if (argv[0] === '--version') return { code: 0, stdout: '0.10.4\n', stderr: '', timedOut: false };
    if (argv[0] === 'balance') return { code: 0, stdout: `Available credits: ${balance}\n`, stderr: '', timedOut: false };
    if (argv[0] === 'run') {
      const url = argv[argv.indexOf('--url') + 1], phase = argv[argv.indexOf('--max-steps') + 1] === '80' ? 1 : 2;
      const d = await driveSite(url.replace(/\/index\.html$/, ''), profile, phase as 1 | 2);
      balance = Math.round((balance - (o.used ?? 50)) * 1000) / 1000;
      return o.early ? { code: null, stdout: doubleStdout(true, 1, 0, '0.10.4'), stderr: '', timedOut: true } : { code: 0, stdout: doubleStdout(false, d.forms.length + 3, o.used ?? 50, '0.10.4'), stderr: '', timedOut: false };
    }
    return { code: 1, stdout: '', stderr: 'unexpected argv', timedOut: false };
  };
  return { transport, calls };
}
function approve(run: string, runId: string, phase: 1 | 2) {
  mkdirSync(join(run, 'approvals'), { recursive: true });
  writeFileSync(join(run, 'approvals', `${runId}.json`), JSON.stringify({ runId, approvedBy: 'test', approvedAt: '2026-11-26T00:00:00.000Z', maxCalls: 1, maxSteps: MATCHED.phases[phase].maxSteps, ceilingCredits: MATCHED.phases[phase].ceilingCredits, acknowledgesNoHardCap: true }));
}
async function withRunAuth<T>(runId: string, f: () => Promise<T>) { const prev = process.env.KANE_PAID_RUN_AUTH; process.env.KANE_PAID_RUN_AUTH = runId; try { return await f(); } finally { if (prev === undefined) delete process.env.KANE_PAID_RUN_AUTH; else process.env.KANE_PAID_RUN_AUTH = prev; } }

test('real-runner boundary (mocked transport): Kane provenance from the sealed raw files, never a test double; validity kept separate', async () => {
  const s = setup();
  try {
    const { transport, calls } = mockTransport('reviser');
    const runner = kaneRunner(s.run, { mode: 'per-run-approval', scope: /^GW2-M(0[1-9]|10)-P[12]$/, transport }); // test seams only: the committed gate stays 'disabled'
    assert.equal(runner.gateMode, 'per-run-approval'); assert.equal(kaneRunner(s.run).gateMode, 'disabled');
    const feedback = { kind: 'runtime' as const, authorizationFor: () => { throw new Error('control arm: never asked'); } };
    for (const phase of [1, 2] as const) {
      const runId = slot('M01').runs[phase]; approve(s.run, runId, phase);
      await withRunAuth(runId, () => runMatched({ evidence: DEV, run: s.run, rec: s.rec, runner, feedback, sessions: [slot('M01')], maxCalls: 1 }));
    }
    assert.ok(calls.some(a => a[0] === 'run' && a.includes('--headless')), 'the real argv went through the transport');
    const nodes = graphOf(s.run, 'M01'), lines = readFileSync(nodes, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l).node);
    assert.ok(lines.length >= 5);
    for (const n of lines) {
      assert.deepEqual([n.author.kind, n.author.id, n.author.version], ['agent', 'kane-cli', '0.10.4'], 'a real Kane submission is attributed to kane-cli');
      const raw = join(sessionDir(s.run, 'M01'), `raw-${n.body.phase}`);
      assert.equal(n.provenance.kaneStdout.sha256, sha(readFileSync(join(raw, 'stdout.ndjson')))); assert.equal(n.provenance.kaneArgs.sha256, sha(readFileSync(join(raw, 'args.json'))));
      assert.equal(JSON.parse(readFileSync(join(raw, 'RAW_SEAL.json'), 'utf8')).files['stdout.ndjson'], n.provenance.kaneStdout.sha256, 'provenance names the sealed stdout');
    }
    const f1 = JSON.parse(readFileSync(join(sessionDir(s.run, 'M01'), 'FREEZE-1.json'), 'utf8'));
    assert.deepEqual(Object.keys(f1.validity).sort(), ['call', 'submissionVerification']);
    assert.equal(f1.validity.submissionVerification.verified, 3); assert.equal(f1.validity.call.status, 'completed');
    assert.ok(f1.submissions.every((x: any) => x.author === 'agent:kane-cli' && x.nonceValid === true));
    assert.deepEqual(executionProblems(s.run, s.rec), []);
    // the treatment arm needs the runtime feedback path, which refuses while AGENT_FEEDBACK_ENABLED is false: recorded, never retried
    const runId = slot('M02').runs[1]; approve(s.run, runId, 1);
    await assert.rejects(withRunAuth(runId, () => runMatched({ evidence: DEV, run: s.run, rec: s.rec, runner, feedback: { kind: 'runtime', authorizationFor: () => ({ runId: 'GW2-M02-P2', session: 'M02', arm: 'treatment', phase: 2, preregSha256: 'x', operatorAuthorization: 'x' }) }, sessions: [slot('M02')], maxCalls: 1 })), /failed at revision-page \(recorded; not retried\)/);
    const L = ledger(s.rec);
    assert.equal(L.filter(e => e.event === 'call-failed').length, 1); assert.equal(L.find(e => e.event === 'call-failed').data.stage, 'revision-page');
    assert.ok(L.some(e => e.event === 'experiment-stopped')); assert.throws(() => nextCall(s.run, s.rec), /stopped/);
    assert.ok(existsSync(join(sessionDir(s.run, 'M02'), 'FREEZE-1.json')), 'the call was still imported and frozen before the failure');
    // a failed transaction is still verified step by step (the failure exempts nothing) and the evaluation lists it
    assert.deepEqual(executionProblems(s.run, s.rec), [], 'the recorded steps of the failed call verify');
    appendFileSync(join(sessionDir(s.run, 'M02'), 'raw-1', 'stderr.txt'), 'x');
    assert.match(executionProblems(s.run, s.rec).join(), /GW2-M02-P1 raw: stderr\.txt differs from its raw seal/);
    assert.throws(() => evaluateMatched(DEV, s.run, s.rec), /stays closed: .*GW2-M02-P1 raw/);
    writeFileSync(join(sessionDir(s.run, 'M02'), 'raw-1', 'stderr.txt'), readFileSync(join(sessionDir(s.run, 'M02'), 'raw-1', 'stderr.txt'), 'utf8').slice(0, -1));
    const ev = evaluateMatched(DEV, s.run, s.rec);
    assert.deepEqual(ev.failedCalls.map(x => [x.runId, x.stage, x.frozen]), [['GW2-M02-P1', 'revision-page', true]]);
    assert.equal(ev.sessions.find(x => x.session === 'M02')!.complete, false); assert.equal(ev.sessions.find(x => x.session === 'M01')!.complete, true);
    // without Freeze-2, every revision measure and paired change is UNAVAILABLE (null), never zero
    const m2 = ev.sessions.find(x => x.session === 'M02')! as any;
    assert.deepEqual(m2.revision, { available: false, reason: 'no Freeze-2: the phase-2 call was not frozen' });
    assert.deepEqual(m2.heldout.change, { accuracy: null, coverage: null }); assert.equal(m2.heldout.final, null); assert.ok(m2.heldout.initial);
    for (const k of ['actions', 'revisionEffects', 'revisionEffectsByAccuracy', 'representationLoss', 'withdrawals', 'pairs']) assert.equal(m2[k], null, `${k} unavailable`);
    assert.deepEqual([m2.targets.heldout, m2.targets.attribution, m2.discoveryFit.final, m2.discoveryFit.change, m2.counterexamples.final, m2.abstentions.withdrawalsPhase2, m2.representationAvailability.phase2], [null, null, null, null, null, null, null]);
    const ctl = ev.arms.find(a => a.arm === 'treatment')!;
    assert.deepEqual(ctl.accuracyChange.find(x => x.session === 'M02')!.value, null); assert.deepEqual(ctl.corrections.find(x => x.session === 'M02')!.value, null, 'no zero is reported for a revision that never happened');
    assert.equal((ev.sessions.find(x => x.session === 'M01') as any).revision.available, true);
    // the evaluation-only path of a terminally stopped experiment opens once, and starts nothing
    assert.equal(ledger(s.rec).filter(e => e.event === 'call-start').length, 3, 'evaluating started no call');
    assert.throws(() => evaluateMatched(DEV, s.run, s.rec), /already opened once/);
    assert.throws(() => nextCall(s.run, s.rec), /stopped/);
  } finally { s.done(); }
  // a session served for a Kane call is never imported as a test double, and Kane provenance never labels a double's session
  const t = setup();
  try {
    const { runner } = doubleRunner(() => 'keeper');
    await runMatched({ evidence: DEV, run: t.run, rec: t.rec, runner, feedback: { kind: 'test-only', build: sessionFeedbackForTest }, sessions: [slot('M01')], maxCalls: 1 });
    const dir = join(sessionDir(t.run, 'M01'), 'phase-1', 'sessions'), sess = join(dir, readdirSync(dir)[0]), raw = join(sessionDir(t.run, 'M01'), 'raw-1');
    assert.throws(() => importPhase(t.run, t.rec, slot('M01'), 1, sess, { kane: { stdout: join(raw, 'stdout.ndjson'), args: join(raw, 'args.json'), version: '0.10.4' } }), /did not serve a Kane call/);
    const meta = JSON.parse(readFileSync(join(sess, 'session.json'), 'utf8'));
    assert.equal(meta.label, 'test-double');
    assert.ok(readFileSync(graphOf(t.run, 'M01'), 'utf8').split('\n').filter(Boolean).every(l => JSON.parse(l).node.author.kind === 'test-double'));
  } finally { t.done(); }
});

test('a Kane call that ends without run_end: forms imported and frozen under a neutral agent author with the reasons (never Kane-labelled, never a double)', async () => {
  const s = setup();
  try {
    const { transport } = mockTransport('reviser', { early: true });
    const runner = kaneRunner(s.run, { mode: 'per-run-approval', scope: null, transport });
    const runId = slot('M01').runs[1]; approve(s.run, runId, 1);
    await withRunAuth(runId, () => runMatched({ evidence: DEV, run: s.run, rec: s.rec, runner, feedback: { kind: 'runtime', authorizationFor: () => { throw new Error('x'); } }, sessions: [slot('M01')], maxCalls: 1 }));
    const nodes = readFileSync(graphOf(s.run, 'M01'), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l).node);
    assert.ok(nodes.length > 0);
    for (const n of nodes) { assert.equal(n.author.kind, 'agent'); assert.equal(n.author.id, 'agent-call-without-execution-provenance'); assert.equal(n.provenance, undefined); }
    assert.match(nodes[0].body.executionProvenance.failures.join(), /no run_end/);
    const f1 = JSON.parse(readFileSync(join(sessionDir(s.run, 'M01'), 'FREEZE-1.json'), 'utf8'));
    assert.equal(f1.validity.call.status, 'inconclusive'); assert.equal(f1.validity.submissionVerification.verified, 3, 'the forms are verified submissions even though the call is not valid');
    assert.deepEqual(executionProblems(s.run, s.rec), []);
  } finally { s.done(); }
});

test('completion needs a VALID run_end; an invalid one makes the call and its session incomplete', async () => {
  assert.equal(callComplete({ exitCode: 0, timedOut: false, runEndValid: true }), true);
  assert.equal(callComplete({ exitCode: 0, timedOut: false, runEndValid: false }), false);
  assert.equal(callComplete({ exitCode: 0, timedOut: false }), false);
  const s = setup();
  try {
    const { runner: base } = doubleRunner(x => PROFILES[x]);
    const runner = { ...base, run: async (r: any) => { const x = await base.run(r); return r.runId === 'GW2-M02-P2' ? { ...x, stdout: x.stdout.replace('"status":"passed"', '"status":"weird"') } : x; } };
    await runMatched({ evidence: DEV, run: s.run, rec: s.rec, runner, feedback: { kind: 'test-only', build: sessionFeedbackForTest } });
    const end = ledger(s.rec).find(e => e.event === 'call-end' && e.data.runId === 'GW2-M02-P2').data;
    assert.deepEqual([end.runEndPresent, end.runEndValid, end.complete], [true, false, false]);
    const e = evaluateMatched(DEV, s.run, s.rec);
    assert.equal(e.sessions.find(x => x.session === 'M02')!.complete, false, 'present but invalid is not complete');
    assert.equal(e.blocks.find(b => b.block === 1)!.complete, false);
  } finally { s.done(); }
});

test('integrity: tampered raw output, journal, phase-2 site or graph, and an incomplete transaction, each refuse the next call', async () => {
  const fresh = async () => { const s = setup(), { runner } = doubleRunner(x => PROFILES[x]); await runMatched({ evidence: DEV, run: s.run, rec: s.rec, runner, feedback: { kind: 'test-only', build: sessionFeedbackForTest }, sessions: [slot('M02')], maxCalls: 1 }); assert.deepEqual(executionProblems(s.run, s.rec), []); return s; };
  const cases: [string, (s: ReturnType<typeof setup>) => void, RegExp][] = [
    ['raw stdout', s => appendFileSync(join(sessionDir(s.run, 'M02'), 'raw-1', 'stdout.ndjson'), '{}\n'), /raw: stdout\.ndjson differs from its raw seal/],
    ['access journal', s => { const d = join(sessionDir(s.run, 'M02'), 'phase-1', 'sessions'); appendFileSync(join(d, readdirSync(d)[0], 'access.ndjson'), '{}\n'); }, /access journal differs|server session seal-violated/],
    ['phase-2 site', s => appendFileSync(join(sessionDir(s.run, 'M02'), 'site-2', 'revision.html'), '<p>extra</p>'), /phase-2 site: revision\.html differs from its record/],
    ['phase-2 site extra file', s => writeFileSync(join(sessionDir(s.run, 'M02'), 'site-2', 'extra.html'), 'x'), /extra\.html is not in its record/],
    ['graph', s => { const g = graphOf(s.run, 'M02'), t = readFileSync(g, 'utf8'); writeFileSync(g, t.replace('Every turn grants three actions.', 'Every turn grants four actions.')); }, /graph|prefix|differs/],
    ['incomplete transaction', s => { appendCheckpoint(s.rec, 'call-start', { runId: 'GW2-M02-P2', session: 'M02', phase: 2 }); appendCheckpoint(s.rec, 'call-end', { runId: 'GW2-M02-P2', session: 'M02', phase: 2, used: 1 }); }, /incomplete sealing transaction \(missing raw-seal, server-closed, freeze-2\)/],
  ];
  for (const [what, tamper, why] of cases) {
    const s = await fresh();
    try {
      tamper(s);
      assert.throws(() => nextCall(s.run, s.rec), why, what);
      const { runner } = doubleRunner(x => PROFILES[x]);
      await assert.rejects(runMatched({ evidence: DEV, run: s.run, rec: s.rec, runner, feedback: { kind: 'test-only', build: sessionFeedbackForTest }, sessions: [slot('M02')] }), /integrity check failed|never repeated/, `${what}: no further call`);
      assert.equal(ledger(s.rec).filter(e => e.event === 'call-start').length, what === 'incomplete transaction' ? 2 : 1, `${what}: nothing started`);
    } finally { s.done(); }
  }
});

test('the discovery site is verified against the pre-registered manifest before serving; a changed file stops the experiment', async () => {
  const d = mkdtempSync(join(tmpdir(), 'gw2-matched-ev-')), ev = join(d, 'evidence'), rec = join(d, 'record'), run = join(d, 'run');
  try {
    cpSync(DEV, ev, { recursive: true }); preregisterMatched(ev, rec);
    assert.deepEqual(discoverySiteProblems(ev, verifyMatchedPrereg(ev, rec).manifests.discovery), []);
    const site = join(ev, 'partitions/discovery/site'), page = readdirSync(site).find(f => f.startsWith('case-'))!;
    appendFileSync(join(site, page), '<!-- changed -->');
    const { runner } = doubleRunner(() => 'keeper');
    await assert.rejects(runMatched({ evidence: ev, run, rec, runner, feedback: { kind: 'test-only', build: sessionFeedbackForTest }, sessions: [slot('M01')] }), new RegExp(`discovery site: ${page} differs from its record`));
    const L = ledger(rec);
    assert.ok(!L.some(e => e.event === 'call-start'), 'nothing was served'); assert.ok(L.some(e => e.event === 'call-refused') && L.some(e => e.event === 'experiment-stopped'));
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test('fair revision opportunity: both arms get the complete frozen phase-1 submissions; the phase-2 objective assumes no memory', () => {
  const ctl = full.seen['GW2-M01-P2'].revision!, trt = full.seen['GW2-M02-P2'].revision!;
  for (const p of [ctl, trt]) {
    for (const x of ['Every turn grants three actions.', 'Effects fire when entered.', 'shield behaviour', '<dd>medium</dd>', '<dd>C-000000</dd>', 'submitted, checkable (1 of 1 clause valid)', 'none submitted (not machine-checkable)', 'Abstention scope', 'This is a new, separate call'])
      assert.ok(p.includes(x), `revision page lists ${x}`);
    assert.ok(p.includes(esc(LAWS.three)), 'the full submitted representation, verbatim');
  }
  assert.match(MATCHED.phases[2].objective, /no memory of the earlier call/); assert.doesNotMatch(MATCHED.phases[2].objective, /continuing the same investigation/);
  assert.match(MATCHED.phases[2].objective, /revision\.html/);
  for (const t of ruleTexts) assert.ok(!MATCHED.phases[2].objective.includes(t));
});

test('representation loss is recorded per original and counted as harmful', async () => {
  const s = setup();
  try {
    const { runner } = doubleRunner(() => 'dropper');
    await runMatched({ evidence: DEV, run: s.run, rec: s.rec, runner, feedback: { kind: 'test-only', build: sessionFeedbackForTest }, sessions: [slot('M01')] });
    const o = sessionOutcomes(loadFrozen(s.run, s.rec, 'M01', 1), loadFrozen(s.run, s.rec, 'M01', 2), { discovery: [], heldout: [] });
    assert.deepEqual(o.representationLoss, ['H-1']); assert.equal(o.revisionEffects.representationLost, 1); assert.equal(o.revisionEffects.harmful, 1);
    assert.deepEqual(o.representationAvailability.phase2, { hypotheses: 1, withStructuredRepresentation: 0 });
  } finally { s.done(); }
});

test('pre-registration binds the complete execution dependency set and the exact commit', () => {
  const deps = dependencySet();
  for (const f of ['server/balance/v4/kanebudget.ts', 'server/kane.ts', 'scripts/kane-single-call.ts', 'gamewatch/gw2/matched/kane-runner.ts', 'gamewatch/gw2/matched/integrity.ts', 'gamewatch/gw2/matched/candidate.ts', 'gamewatch/gw2/serve.ts', 'gamewatch/gw2/journal.ts', 'gamewatch/gw2/ext/feedback.ts'])
    assert.ok(deps.includes(f), `${f} is an execution dependency`);
  for (const f of ['gamewatch/gw2/matched/doubles.ts', 'gamewatch/gw2/matched/feedback-testonly.ts', 'gamewatch/gw2/matched/dry-run.ts']) assert.ok(!deps.includes(f), `${f} is not reachable from the operator CLI`);
  const s = setup();
  try {
    const p = JSON.parse(readFileSync(join(s.rec, 'PREREGISTRATION.json'), 'utf8'));
    for (const f of [...deps, ...MATCHED_DOCS]) assert.ok(f in p.files, `${f} bound`);
    assert.equal(p.commit.head, headCommit()); assert.match(p.commit.head, /^[0-9a-f]{40}$/);
    assert.throws(() => preregisterMatched(DEV, join(s.d, 'other'), { expectCommit: '0'.repeat(40) }), /HEAD is/);
  } finally { s.done(); }
});

test('enabled-candidate check: only the three gate lines may differ from the reviewed commit; historical tests are untouched', () => {
  const read = (f: string) => readFileSync(join(ROOT, f), 'utf8');
  const reviewed = (f: string) => read(f), cand = (f: string) => candidateText(f, read(f));
  assert.deepEqual(candidateProblems([GATE_FILE, FEEDBACK_FILE], (rev, f) => rev === 'reviewed' ? reviewed(f) : cand(f)), []);
  assert.match(cand(GATE_FILE), /= 'per-run-approval';/); assert.match(cand(GATE_FILE), /\^GW2-M\(0\[1-9\]\|10\)-P\[12\]\$/); assert.match(cand(FEEDBACK_FILE), /AGENT_FEEDBACK_ENABLED = true;/);
  assert.match(candidateProblems([GATE_FILE, FEEDBACK_FILE, 'gamewatch/gw2/matched/pipeline.ts'], (rev, f) => rev === 'reviewed' ? reviewed(f) : cand(f)).join(), /exactly/);
  assert.match(candidateProblems([GATE_FILE, FEEDBACK_FILE], (rev, f) => rev === 'reviewed' ? reviewed(f) : cand(f) + '\n// more').join(), /more than the gate lines/);
  assert.match(candidateProblems([GATE_FILE, FEEDBACK_FILE], (rev, f) => rev === 'reviewed' ? cand(f) : cand(f)).join(), /does not hold exactly one line/, 'the reviewed commit must be the disabled one');
  const r = checkCandidate('HEAD');
  assert.equal(r.ok, false, 'this commit is the reviewed (disabled) state, not a candidate'); assert.match(r.problems.join(), /must change exactly/);
  assert.equal(PAID_RESEARCH_EXECUTION, 'disabled'); assert.equal(AGENT_FEEDBACK_ENABLED, false);
});

test('non-paid dry run: generation 1 only, 20 double calls, clean integrity, single evaluation; refuses an existing record', async () => {
  const d = mkdtempSync(join(tmpdir(), 'gw2-matched-dry-'));
  try {
    const r = await dryRun(join(d, 'record'), join(d, 'run'));
    assert.equal(r.evidence, MATCHED.devEvidence); assert.equal(r.calls, 20); assert.deepEqual(r.integrityProblems, []);
    assert.equal(r.evaluation.sessions.length, 10); assert.ok(r.ops.calls.every((c: any) => c.frozen));
    const p = JSON.parse(readFileSync(join(d, 'record', 'PREREGISTRATION.json'), 'utf8'));
    assert.equal(p.plan.evidence.dir, MATCHED.devEvidence);
    await assert.rejects(dryRun(join(d, 'record'), join(d, 'run')), /new record/);
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test('a failed transaction must be a clean, stopped prefix: steps after the failure or a missing stop are integrity problems', async () => {
  const s = setup();
  try {
    const { runner } = doubleRunner(x => PROFILES[x]);
    await runMatched({ evidence: DEV, run: s.run, rec: s.rec, runner, feedback: { kind: 'test-only', build: sessionFeedbackForTest }, sessions: [slot('M01')], maxCalls: 1 });
    appendCheckpoint(s.rec, 'call-start', { runId: 'GW2-M01-P2', session: 'M01', phase: 2 });
    appendCheckpoint(s.rec, 'call-failed', { runId: 'GW2-M01-P2', session: 'M01', phase: 2, stage: 'serve', error: 'test' });
    assert.match(executionProblems(s.run, s.rec).join(), /not marked stopped after the failure/);
    appendCheckpoint(s.rec, 'experiment-stopped', { reason: 'GW2-M01-P2 failed at serve: test' });
    assert.deepEqual(executionProblems(s.run, s.rec), []);
    appendCheckpoint(s.rec, 'raw-seal', { runId: 'GW2-M01-P2', rawSealSha256: 'x', files: {} });
    assert.match(executionProblems(s.run, s.rec).join(), /gap in its transaction|recorded after the call failed/);
  } finally { s.done(); }
});

test('a session with a recorded call-failed is incomplete whatever its freeze status', () => {
  const ok = { phase: 1, runEndValid: true, exitCode: 0, timedOut: false, outcome: 'completed' }, calls = [ok, { ...ok, phase: 2 }];
  const fail = (session: string, phase: number) => ({ event: 'call-failed', data: { session, phase, runId: `GW2-${session}-P${phase}`, stage: 'freeze' } });
  assert.equal(sessionComplete('M01', true, calls as any, []), true, 'baseline: two complete calls and Freeze-2');
  assert.equal(sessionComplete('M01', true, calls as any, [fail('M01', 2)]), false, 'Freeze-2 present, but a call failed');
  assert.equal(sessionComplete('M01', true, calls as any, [fail('M01', 1)]), false);
  assert.equal(sessionComplete('M01', true, calls as any, [fail('M02', 1)]), sessionComplete('M01', true, calls as any, []), 'another session\'s failure does not touch this one');
  assert.equal(sessionComplete('M01', false, calls as any, []), false, 'no Freeze-2');
});
