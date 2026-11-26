/**
 * GW2 matched comparison: the single final evaluation (D144). PREPARED, NOT EXECUTED on real sessions.
 *
 * Refused unless the anchored pre-registration still holds, the final held-out evidence has never been opened (no
 * "gate-opened" in the external ledger), and every declared session has Freeze-1 and Freeze-2, or the experiment was
 * stopped and every call that started is frozen. Opening is recorded once ("gate-opened"), then held-out and eval are
 * read through the pre-registered manifests. Outputs are SESSION-LEVEL: each session is one unit; its outcome checks are
 * correlated and are never treated as independent replications. Reported separately, never combined into one score:
 *   - held-out accuracy and coverage, initial (Freeze-1) vs final (after revisions), and the paired change;
 *   - corrections (a revision more accurate than its original), harmful revisions (less accurate, or a structured
 *     representation lost), unchanged, not comparable;
 *   - actions on originals: kept, revised, withdrawn, conflicting (two or more phase-2 forms for one original);
 *   - abstentions (phase 1) and withdrawals (phase 2);
 *   - representation availability per phase;
 *   (final preflight, item 5, added without changing the measures above)
 *   - discovery fit, initial vs final (the same score on the discovery partition the agent saw);
 *   - prediction targets (situation, outcome field) with a recorded outcome, compared between original and revision and
 *     between the initial and the final set: corrections on COMMON targets (contradicted before, matching after),
 *     common targets that became incorrect, newly introduced predictions (matching / incorrect), and dropped
 *     predictions (coverage contraction) vs added ones (expansion), at target and at situation level;
 *   - an attribution of every accuracy change: an increase without any correction on common targets that comes with
 *     coverage contraction is labelled "narrowing only" and is never reported as self-correction;
 *   - C readings (three-way, verify.ts threeWay with the pre-registered spec encoding) per partition, initial vs final;
 *   - counterexample classes of held-out contradictions (p8-corrections.ts novelty against the applicable discovery
 *     situations of the same build; and whether discovery already held a counterexample of that clause);
 *   - withdrawals, abstentions and loss of machine-evaluable representations listed per original.
 * A call that failed after call-start (recorded "call-failed", experiment stopped) is listed in failedCalls; its session is
 * incomplete, whatever its freeze status. If its phase-1 call was never frozen the session has no outcomes. A session
 * without Freeze-2 reports its Freeze-1 readings only: every revision measure and paired change is unavailable (null,
 * with revision.available false), never zero. Nothing is imputed.
 * Rules fixed in advance: a withdrawn original leaves the final set; a conflicting original stays in the final set
 * unchanged and its conflicting revisions are listed, not scored as corrections or harms; a phase-2 form naming no
 * frozen original is an addition to the final set. Arm comparisons are differences of session-level values within
 * complete balanced blocks, plus the per-arm lists; no significance claim is made with 5 sessions per arm.
 */
import { writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { readExecLedger, appendCheckpoint } from '../p7-exec.ts';
import { partitionReader, loadSituations, builds, type Hyp, type Sits } from '../ext/inputs.ts';
import { threeWay, loadEncoding } from '../verify.ts';
import { novelty } from '../p8-corrections.ts';
import { ROOT } from '../paths.ts';
import { MATCHED } from './params.ts';
import { executionProblems } from './integrity.ts';
import { callComplete } from './pipeline.ts';
import { evalClause } from '../ext/clauses.ts';
import { AccessRefused } from '../ext/errors.ts';
import { verifyMatchedPrereg } from './prereg.ts';
import { schedule } from './schedule.ts';
import { loadFrozen, sessionDir, type Frozen } from './sessions.ts';
import type { Arm } from './params.ts';

export const EVALUATION_SCHEMA = 'gamewatch/gw2-matched-evaluation@1';
type Score = { matching: number; contradicting: number; unknown: number; predicted: string[]; accuracy: number | null };

/** Held-out score of a set of hypotheses (all represented clauses, every build separately). */
export function score(hyps: Hyp[], sits: Sits, p: 'heldout' | 'discovery' = 'heldout'): Score {
  const s = { matching: 0, contradicting: 0, unknown: 0, predicted: new Set<string>() };
  for (const h of hyps) for (const r of h.representations) for (const c of r.clauses) for (const b of builds(sits[p])) {
    const own = (sits[p] ?? []).filter(x => x.build === b), e = evalClause(c, own);
    s.matching += e.outcomeChecks.matching; s.contradicting += e.outcomeChecks.contradicting; s.unknown += e.outcomeChecks.unknown;
    for (const id of e.predictions.keys()) s.predicted.add(id);
  }
  const n = s.matching + s.contradicting;
  return { matching: s.matching, contradicting: s.contradicting, unknown: s.unknown, predicted: [...s.predicted].sort(), accuracy: n ? Math.round(s.matching / n * 10000) / 10000 : null };
}
/** Prediction targets with a recorded outcome: key "situation|field" → contradicted by any clause of the set? */
export function targets(hyps: Hyp[], sits: Sits, p: 'heldout' | 'discovery' = 'heldout') {
  const t = new Map<string, { contradicted: boolean; situation: string }>();
  for (const h of hyps) for (const r of h.representations) for (const c of r.clauses) for (const b of builds(sits[p])) {
    for (const x of evalClause(c, (sits[p] ?? []).filter(y => y.build === b)).checks) {
      if (x.result !== 'matching' && x.result !== 'contradicting') continue;
      const k = `${x.id}|${x.field}`, prev = t.get(k);
      t.set(k, { situation: x.id, contradicted: (prev?.contradicted ?? false) || x.result === 'contradicting' });
    }
  }
  return t;
}
/** Target-level comparison of a "before" and an "after" set (original vs revision, or initial vs final). */
export function targetChange(before: Hyp[], after: Hyp[], sits: Sits, p: 'heldout' | 'discovery' = 'heldout') {
  const a = targets(before, sits, p), b = targets(after, sits, p);
  const common = [...a.keys()].filter(k => b.has(k)), onlyB = [...b.keys()].filter(k => !a.has(k)), onlyA = [...a.keys()].filter(k => !b.has(k));
  const sitsOf = (m: Map<string, { situation: string }>) => new Set([...m.values()].map(v => v.situation));
  const sa = sitsOf(a), sb = sitsOf(b);
  return {
    unit: 'prediction target = (situation, outcome field) with a recorded outcome',
    common: { total: common.length, corrected: common.filter(k => a.get(k)!.contradicted && !b.get(k)!.contradicted).length, becameIncorrect: common.filter(k => !a.get(k)!.contradicted && b.get(k)!.contradicted).length,
      stillCorrect: common.filter(k => !a.get(k)!.contradicted && !b.get(k)!.contradicted).length, stillIncorrect: common.filter(k => a.get(k)!.contradicted && b.get(k)!.contradicted).length },
    added: { total: onlyB.length, matching: onlyB.filter(k => !b.get(k)!.contradicted).length, incorrect: onlyB.filter(k => b.get(k)!.contradicted).length },
    dropped: { total: onlyA.length, matching: onlyA.filter(k => !a.get(k)!.contradicted).length, incorrect: onlyA.filter(k => a.get(k)!.contradicted).length },
    situations: { before: sa.size, after: sb.size, contraction: [...sa].filter(x => !sb.has(x)).length, expansion: [...sb].filter(x => !sa.has(x)).length },
  };
}
type TC = ReturnType<typeof targetChange>;
/** Why an accuracy changed. Narrower coverage alone is never called a correction. */
export function attribution(tc: TC, accuracyChange: number | null) {
  const newlyIncorrect = tc.common.becameIncorrect + tc.added.incorrect;
  if (tc.common.corrected && !newlyIncorrect) return 'corrections on common targets';
  if (tc.common.corrected && newlyIncorrect) return 'mixed: corrections on common targets and newly incorrect predictions';
  if (newlyIncorrect) return 'newly incorrect predictions, no correction on common targets';
  if (tc.dropped.total && !tc.added.total) return accuracyChange !== null && accuracyChange > 0 ? 'narrowing only: accuracy rose because predictions were dropped (not self-correction)' : 'narrowing only (coverage contraction)';
  if (tc.added.total) return 'expansion with correct predictions only';
  return 'no change in predictions';
}

type Usable = { rule: string; clauses: any[] }[];
/** C readings (three-way) of a set, per partition: count of each combined reading over (representation, build, rule). */
export function cReadings(hyps: Hyp[], sits: Sits, usable: Usable) {
  const out: Record<string, Record<string, number>> = {};
  const hs = hyps.filter(h => h.kind === 'hypothesis').map(h => ({ id: h.id, kind: h.kind, representations: h.representations.map(r => ({ id: r.id, author: r.author, representation: r.representation, fidelity: r.fidelity })) }));
  for (const p of ['discovery', 'heldout'] as const) {
    const tally: Record<string, number> = {}, tw = threeWay(hs, [{ partition: p, builds: builds(sits[p]), situations: sits[p] ?? [] }], { usable });
    for (const h of tw.hypotheses as any[]) {
      if (h.status !== 'evaluated') { tally[h.status] = (tally[h.status] ?? 0) + 1; continue; }
      for (const r of h.representations) for (const bp of r.byPartition ?? []) for (const x of bp.readings ?? []) tally[x.reading] = (tally[x.reading] ?? 0) + 1;
    }
    out[p] = Object.fromEntries(Object.entries(tally).sort());
  }
  return { unit: 'readings over (representation, build, encoded spec rule); hypotheses without a representation counted by status', byPartition: out,
    accurateDescriptionsOfADefect: { discovery: out.discovery['accurate-description-of-a-defect'] ?? 0, heldout: out.heldout['accurate-description-of-a-defect'] ?? 0 } };
}
/** Classes of the held-out counterexamples of a set, against the applicable discovery situations of the same build. */
export function counterexampleClasses(hyps: Hyp[], sits: Sits) {
  const classes: Record<string, number> = {}; let exemplified = 0, notExemplified = 0, total = 0;
  for (const h of hyps) for (const r of h.representations) for (const c of r.clauses) for (const b of builds(sits.heldout)) {
    const ho = evalClause(c, (sits.heldout ?? []).filter(x => x.build === b)), disc = (sits.discovery ?? []).filter(x => x.build === b), d = evalClause(c, disc);
    const pool = disc.filter(x => d.applicableIds.includes(x.id)), byId = new Map((sits.heldout ?? []).map(x => [x.id, x]));
    for (const id of new Set(ho.counter.map(x => x.id))) {
      const sit = byId.get(id)!; total++;
      const k = novelty(sit, pool).class; classes[k] = (classes[k] ?? 0) + 1;
      if (d.counter.length) exemplified++; else notExemplified++;
    }
  }
  return { unit: 'held-out situations contradicting a clause (per representation, clause and build)', total, novelty: Object.fromEntries(Object.entries(classes).sort()),
    clauseAlreadyContradictedInDiscovery: exemplified, clauseNotContradictedInDiscovery: notExemplified };
}

const represented = (h: Hyp) => h.kind === 'hypothesis' && h.representations.some(r => r.clauses.length > 0);

export function sessionOutcomes(f1: Frozen, f2: Frozen | null, sits: Sits, ctx: { usable?: Usable } = {}) {
  const totalHeldout = (sits.heldout ?? []).length;
  const originals = f1.hyps, p2 = f2?.hyps ?? [], subs2 = new Map((f2?.submissions ?? []).map(s => [s.id, s]));
  const byOriginal = new Map<string, Hyp[]>(), additions: Hyp[] = [];
  for (const h of p2) { const rv = subs2.get(h.id)?.revision; if (rv?.of) byOriginal.set(rv.of, [...(byOriginal.get(rv.of) ?? []), h]); else additions.push(h); }
  const pairs = originals.map(o => {
    const rs = byOriginal.get(o.id) ?? [];
    const action = !rs.length ? 'kept' : rs.length > 1 ? 'conflicting' : rs[0].kind === 'abstention' ? 'withdrawn' : 'revised';
    const so = score([o], sits), sr = action === 'revised' ? score([rs[0]], sits) : null;
    const effect = action !== 'revised' ? null : represented(o) && !represented(rs[0]) ? 'harmful (structured representation lost)'
      : so.accuracy === null || sr!.accuracy === null ? 'not comparable' : sr!.accuracy > so.accuracy ? 'correction' : sr!.accuracy < so.accuracy ? 'harmful' : 'unchanged';
    const tc = action === 'revised' ? targetChange([o], [rs[0]], sits) : null;
    const lost = action === 'revised' && represented(o) && !represented(rs[0]);
    // effect (final preflight): based on prediction targets, never on accuracy alone; the accuracy-only reading is kept
    const effectTargets = action !== 'revised' ? null : lost ? 'harmful (structured representation lost)' : !tc!.common.total && !tc!.added.total && !tc!.dropped.total ? 'not comparable'
      : tc!.common.corrected && !(tc!.common.becameIncorrect + tc!.added.incorrect) ? 'correction' : tc!.common.corrected ? 'mixed'
      : tc!.common.becameIncorrect + tc!.added.incorrect ? 'harmful' : tc!.dropped.total && !tc!.added.total ? 'narrowing only' : 'unchanged';
    return { original: o.ref, originalKind: o.kind, action, revisions: rs.map(r => r.ref), heldoutOriginal: { ...so, predicted: so.predicted.length }, heldoutRevision: sr ? { ...sr, predicted: sr.predicted.length } : null,
      effect: effectTargets, accuracyEffect: effect, targets: tc, representationLost: lost, withdrawn: action === 'withdrawn', conflictingRevisions: action === 'conflicting' ? rs.map(r => r.ref) : [] };
  });
  const final: Hyp[] = [...originals.filter(o => { const a = pairs.find(p => p.original === o.ref)!.action; return a === 'kept' || a === 'conflicting'; }),
    ...originals.flatMap(o => pairs.find(p => p.original === o.ref)!.action === 'revised' ? byOriginal.get(o.id)! : []), ...additions].filter(h => h.kind === 'hypothesis');
  const initial = originals.filter(h => h.kind === 'hypothesis'), si = score(initial, sits), sf = score(final, sits);
  const di = score(initial, sits, 'discovery'), df = score(final, sits, 'discovery'), tcS = targetChange(initial, final, sits);
  const chA = si.accuracy === null || sf.accuracy === null ? null : Math.round((sf.accuracy - si.accuracy) * 10000) / 10000;
  const cov = (s: Score) => totalHeldout ? Math.round(s.predicted.length / totalHeldout * 10000) / 10000 : null;
  const avail = (hs: Hyp[]) => ({ hypotheses: hs.filter(h => h.kind === 'hypothesis').length, withStructuredRepresentation: hs.filter(represented).length });
  const count = (k: string) => pairs.filter(p => p.action === k).length, eff = (k: string) => pairs.filter(p => p.effect === k).length;
  const out: any = {
    heldout: { initial: { accuracy: si.accuracy, coverage: cov(si), matching: si.matching, contradicting: si.contradicting }, final: { accuracy: sf.accuracy, coverage: cov(sf), matching: sf.matching, contradicting: sf.contradicting },
      change: { accuracy: si.accuracy === null || sf.accuracy === null ? null : Math.round((sf.accuracy - si.accuracy) * 10000) / 10000, coverage: cov(si) === null ? null : Math.round((cov(sf)! - cov(si)!) * 10000) / 10000 } },
    actions: { kept: count('kept'), revised: count('revised'), withdrawn: count('withdrawn'), conflicting: count('conflicting'), additions: additions.filter(h => h.kind === 'hypothesis').length },
    revisionEffects: { basis: 'prediction targets (situation, outcome field) with a recorded held-out outcome', corrections: eff('correction'), mixed: eff('mixed'), harmful: eff('harmful') + eff('harmful (structured representation lost)'), representationLost: eff('harmful (structured representation lost)'),
      narrowingOnly: eff('narrowing only'), unchanged: eff('unchanged'), notComparable: eff('not comparable') },
    revisionEffectsByAccuracy: { basis: 'held-out accuracy of the revision vs its original (the original measure, kept)', corrections: pairs.filter(p => p.accuracyEffect === 'correction').length, harmful: pairs.filter(p => String(p.accuracyEffect).startsWith('harmful')).length,
      unchanged: pairs.filter(p => p.accuracyEffect === 'unchanged').length, notComparable: pairs.filter(p => p.accuracyEffect === 'not comparable').length },
    targets: { heldout: tcS, attribution: attribution(tcS, chA) },
    discoveryFit: { initial: { accuracy: di.accuracy, matching: di.matching, contradicting: di.contradicting }, final: { accuracy: df.accuracy, matching: df.matching, contradicting: df.contradicting },
      change: di.accuracy === null || df.accuracy === null ? null : Math.round((df.accuracy - di.accuracy) * 10000) / 10000, targets: targetChange(initial, final, sits, 'discovery') },
    representationLoss: pairs.filter(p => p.representationLost).map(p => p.original),
    withdrawals: pairs.filter(p => p.withdrawn).map(p => p.original), abstentionsPhase1: originals.filter(h => h.kind === 'abstention').map(h => h.ref),
    counterexamples: { initial: counterexampleClasses(initial, sits), final: counterexampleClasses(final, sits) },
    ...(ctx.usable ? { cReadings: { initial: cReadings(initial, sits, ctx.usable), final: cReadings(final, sits, ctx.usable) } } : {}),
    abstentions: { phase1: originals.filter(h => h.kind === 'abstention').length, withdrawalsPhase2: count('withdrawn') },
    representationAvailability: { phase1: avail(originals), phase2: avail(p2) },
    pairs,
  };
  if (f2) return { revision: { available: true }, ...out };
  // no Freeze-2 (final preflight follow-up): nothing was revised, so every revision measure and every paired change is
  // UNAVAILABLE (null), never zero; only the Freeze-1 readings are reported
  return { ...out, revision: { available: false, reason: 'no Freeze-2: the phase-2 call was not frozen' },
    heldout: { initial: out.heldout.initial, final: null, change: { accuracy: null, coverage: null } },
    actions: null, revisionEffects: null, revisionEffectsByAccuracy: null, targets: { heldout: null, attribution: null },
    discoveryFit: { initial: out.discoveryFit.initial, final: null, change: null, targets: null },
    representationLoss: null, withdrawals: null, counterexamples: { initial: out.counterexamples.initial, final: null },
    ...(out.cReadings ? { cReadings: { initial: out.cReadings.initial, final: null } } : {}),
    abstentions: { phase1: out.abstentions.phase1, withdrawalsPhase2: null }, representationAvailability: { phase1: out.representationAvailability.phase1, phase2: null }, pairs: null };
}

/** A session is complete only with Freeze-2, two complete calls, and no recorded call-failed anywhere in it. */
export const sessionComplete = (session: string, hasFreeze2: boolean, calls: { phase: number }[], ledgerEntries: any[]) =>
  hasFreeze2 && calls.length === 2 && calls.every(callComplete) && !ledgerEntries.some(e => e.event === 'call-failed' && e.data.session === session);

export function evaluateMatched(evidence: string, run: string, rec: string, o: { root?: string; at?: string } = {}) {
  const pre = verifyMatchedPrereg(evidence, rec, { root: o.root }), L = readExecLedger(rec).entries as any[];
  if (L.some(e => e.event === 'gate-opened')) throw new AccessRefused('the final held-out evidence was already opened once; it is never opened again');
  const stopped = L.some(e => e.event === 'experiment-stopped'), frozen = (s: string, p: number) => L.some(e => e.event === `freeze-${p}` && e.data.session === s);
  const sched = schedule(), problems: string[] = [];
  for (const s of sched) for (const p of [1, 2]) {
    const started = L.some(e => e.event === 'call-start' && e.data.session === s.session && e.data.phase === p);
    const failedHere = L.some(e => e.event === 'call-failed' && e.data.session === s.session && e.data.phase === p);
    // a started call is frozen, or (after a stop) its failure is recorded; a recorded failure is reported, never hidden
    if (started && !frozen(s.session, p) && !(stopped && failedHere)) problems.push(`${s.session} phase ${p} started but is not frozen`);
    if (!stopped && !frozen(s.session, p)) problems.push(`${s.session} phase ${p} is not frozen`);
  }
  problems.push(...executionProblems(run, rec).filter(x => !(stopped && /incomplete sealing transaction \(missing revision-page\)/.test(x))));
  if (problems.length) throw new AccessRefused(`the held-out evidence stays closed: ${problems.join('; ')}`);
  const at = o.at ?? new Date().toISOString();
  appendCheckpoint(rec, 'gate-opened', { what: 'final held-out evidence (heldout, eval)', sessionsFrozen: sched.filter(s => frozen(s.session, 2)).map(s => s.session), stopped }, at);
  const reader = partitionReader(evidence, ['discovery', 'heldout', 'eval', 'spec'], { manifests: { discovery: pre.manifests.discovery, heldout: pre.manifests.heldout, eval: pre.manifests.eval, spec: pre.manifests.spec } });
  const { sits } = loadSituations(reader, ['discovery', 'heldout']);
  const rules = JSON.parse(reader.read('spec', 'spec.json')).game.rules as { id: string; text: string }[], enc = loadEncoding(join(o.root ?? ROOT, MATCHED.encoding), rules);
  const sessions = sched.filter(s => frozen(s.session, 1)).map(s => {
    const f1 = loadFrozen(run, rec, s.session, 1), f2 = frozen(s.session, 2) ? loadFrozen(run, rec, s.session, 2) : null;
    const calls = L.filter(e => e.event === 'call-end' && e.data.session === s.session).map(e => ({ phase: e.data.phase, exitCode: e.data.exitCode, timedOut: e.data.timedOut, runEndPresent: e.data.runEndPresent, runEndValid: e.data.runEndValid === true, used: e.data.used, outcome: e.data.outcome }));
    const complete = sessionComplete(s.session, !!f2, calls, L);
    return { session: s.session, arm: s.arm, block: s.block, complete, calls, ...sessionOutcomes(f1, f2, sits, { usable: enc.usable }) };
  });
  const arms = (['control', 'treatment'] as Arm[]).map(arm => {
    const ss = sessions.filter(x => x.arm === arm && x.heldout.change.accuracy !== undefined);
    const list = (f: (x: typeof sessions[number]) => number | null) => ss.map(x => ({ session: x.session, value: f(x) }));
    return { arm, sessions: ss.length, accuracyChange: list(x => x.heldout.change.accuracy), coverageChange: list(x => x.heldout.change.coverage),
      corrections: list(x => x.revisionEffects?.corrections ?? null), harmful: list(x => x.revisionEffects?.harmful ?? null), narrowingOnly: list(x => x.revisionEffects?.narrowingOnly ?? null),
      correctedOnCommonTargets: list(x => x.targets.heldout?.common.corrected ?? null), newlyIncorrectPredictions: list(x => (x.targets.heldout ? x.targets.heldout.common.becameIncorrect + x.targets.heldout.added.incorrect : null)),
      coverageContraction: list(x => x.targets.heldout?.situations.contraction ?? null), coverageExpansion: list(x => x.targets.heldout?.situations.expansion ?? null), attribution: ss.map(x => ({ session: x.session, value: x.targets.attribution })),
      discoveryFitChange: list(x => x.discoveryFit.change), representationLoss: list(x => x.representationLoss?.length ?? null), withdrawals: list(x => x.abstentions.withdrawalsPhase2), abstentionsPhase1: list(x => x.abstentions.phase1),
      representationAvailabilityPhase1: list(x => x.representationAvailability.phase1.hypotheses ? x.representationAvailability.phase1.withStructuredRepresentation / x.representationAvailability.phase1.hypotheses : null) };
  });
  const blocks = [...new Set(sched.map(s => s.block))].map(b => {
    const c = sessions.find(x => x.block === b && x.arm === 'control'), t = sessions.find(x => x.block === b && x.arm === 'treatment');
    const both = !!(c && t && c.complete && t.complete), d = (f: (x: any) => number | null) => both && f(t) !== null && f(c) !== null ? Math.round((f(t)! - f(c)!) * 10000) / 10000 : null;
    return { block: b, complete: both, treatmentMinusControl: { accuracyChange: d(x => x.heldout.change.accuracy), coverageChange: d(x => x.heldout.change.coverage), corrections: d(x => x.revisionEffects?.corrections ?? null), harmful: d(x => x.revisionEffects?.harmful ?? null),
      correctedOnCommonTargets: d(x => x.targets.heldout?.common.corrected ?? null), newlyIncorrectPredictions: d(x => (x.targets.heldout ? x.targets.heldout.common.becameIncorrect + x.targets.heldout.added.incorrect : null)),
      coverageContraction: d(x => x.targets.heldout?.situations.contraction ?? null), coverageExpansion: d(x => x.targets.heldout?.situations.expansion ?? null), discoveryFitChange: d(x => x.discoveryFit.change) } };
  });
  const failedCalls = L.filter(e => e.event === 'call-failed').map(e => ({ runId: e.data.runId, session: e.data.session, phase: e.data.phase, stage: e.data.stage, error: e.data.error, frozen: frozen(e.data.session, e.data.phase) }));
  const body = { schema: EVALUATION_SCHEMA, preregSha256: pre.preregSha256, openedAt: at, stopped, failedCalls, encoding: { file: MATCHED.encoding, sha256: enc.sha256, authoritative: enc.authoritative }, unit: 'session (outcome checks within a session are correlated and are not replications)', sessions, arms, blocks,
    claims: 'descriptive only; no improvement claim unless the pre-registered block comparison supports it' };
  const out = join(run, 'EVALUATION.json'); if (existsSync(out)) throw new AccessRefused('EVALUATION.json exists');
  writeFileSync(out, JSON.stringify(body, null, 1) + '\n', { flag: 'wx' });
  appendCheckpoint(rec, 'evaluated', { evaluationSha256: createHash('sha256').update(readFileSync(out)).digest('hex') }, at);
  return body;
}
