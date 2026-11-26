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
 *   - representation availability per phase.
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
const represented = (h: Hyp) => h.kind === 'hypothesis' && h.representations.some(r => r.clauses.length > 0);

export function sessionOutcomes(f1: Frozen, f2: Frozen | null, sits: Sits) {
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
    return { original: o.ref, originalKind: o.kind, action, revisions: rs.map(r => r.ref), heldoutOriginal: { ...so, predicted: so.predicted.length }, heldoutRevision: sr ? { ...sr, predicted: sr.predicted.length } : null, effect };
  });
  const final: Hyp[] = [...originals.filter(o => { const a = pairs.find(p => p.original === o.ref)!.action; return a === 'kept' || a === 'conflicting'; }),
    ...originals.flatMap(o => pairs.find(p => p.original === o.ref)!.action === 'revised' ? byOriginal.get(o.id)! : []), ...additions].filter(h => h.kind === 'hypothesis');
  const initial = originals.filter(h => h.kind === 'hypothesis'), si = score(initial, sits), sf = score(final, sits);
  const cov = (s: Score) => totalHeldout ? Math.round(s.predicted.length / totalHeldout * 10000) / 10000 : null;
  const avail = (hs: Hyp[]) => ({ hypotheses: hs.filter(h => h.kind === 'hypothesis').length, withStructuredRepresentation: hs.filter(represented).length });
  const count = (k: string) => pairs.filter(p => p.action === k).length, eff = (k: string) => pairs.filter(p => p.effect === k).length;
  return {
    heldout: { initial: { accuracy: si.accuracy, coverage: cov(si), matching: si.matching, contradicting: si.contradicting }, final: { accuracy: sf.accuracy, coverage: cov(sf), matching: sf.matching, contradicting: sf.contradicting },
      change: { accuracy: si.accuracy === null || sf.accuracy === null ? null : Math.round((sf.accuracy - si.accuracy) * 10000) / 10000, coverage: cov(si) === null ? null : Math.round((cov(sf)! - cov(si)!) * 10000) / 10000 } },
    actions: { kept: count('kept'), revised: count('revised'), withdrawn: count('withdrawn'), conflicting: count('conflicting'), additions: additions.filter(h => h.kind === 'hypothesis').length },
    revisionEffects: { corrections: eff('correction'), harmful: eff('harmful') + eff('harmful (structured representation lost)'), unchanged: eff('unchanged'), notComparable: eff('not comparable') },
    abstentions: { phase1: originals.filter(h => h.kind === 'abstention').length, withdrawalsPhase2: count('withdrawn') },
    representationAvailability: { phase1: avail(originals), phase2: avail(p2) },
    pairs,
  };
}

export function evaluateMatched(evidence: string, run: string, rec: string, o: { root?: string; at?: string } = {}) {
  const pre = verifyMatchedPrereg(evidence, rec, { root: o.root }), L = readExecLedger(rec).entries as any[];
  if (L.some(e => e.event === 'gate-opened')) throw new AccessRefused('the final held-out evidence was already opened once; it is never opened again');
  const stopped = L.some(e => e.event === 'experiment-stopped'), frozen = (s: string, p: number) => L.some(e => e.event === `freeze-${p}` && e.data.session === s);
  const sched = schedule(), problems: string[] = [];
  for (const s of sched) for (const p of [1, 2]) {
    const started = L.some(e => e.event === 'call-start' && e.data.session === s.session && e.data.phase === p);
    if (started && !frozen(s.session, p)) problems.push(`${s.session} phase ${p} started but is not frozen`);
    if (!stopped && !frozen(s.session, p)) problems.push(`${s.session} phase ${p} is not frozen`);
  }
  if (problems.length) throw new AccessRefused(`the held-out evidence stays closed: ${problems.join('; ')}`);
  const at = o.at ?? new Date().toISOString();
  appendCheckpoint(rec, 'gate-opened', { what: 'final held-out evidence (heldout, eval)', sessionsFrozen: sched.filter(s => frozen(s.session, 2)).map(s => s.session), stopped }, at);
  const reader = partitionReader(evidence, ['discovery', 'heldout', 'eval'], { manifests: { discovery: pre.manifests.discovery, heldout: pre.manifests.heldout, eval: pre.manifests.eval } });
  const { sits } = loadSituations(reader, ['discovery', 'heldout']);
  const sessions = sched.filter(s => frozen(s.session, 1)).map(s => {
    const f1 = loadFrozen(run, rec, s.session, 1), f2 = frozen(s.session, 2) ? loadFrozen(run, rec, s.session, 2) : null;
    const calls = L.filter(e => e.event === 'call-end' && e.data.session === s.session).map(e => ({ phase: e.data.phase, exitCode: e.data.exitCode, timedOut: e.data.timedOut, runEndPresent: e.data.runEndPresent, used: e.data.used, outcome: e.data.outcome }));
    const complete = !!f2 && calls.length === 2 && calls.every(c => c.exitCode === 0 && !c.timedOut && c.runEndPresent);
    return { session: s.session, arm: s.arm, block: s.block, complete, calls, ...sessionOutcomes(f1, f2, sits) };
  });
  const arms = (['control', 'treatment'] as Arm[]).map(arm => {
    const ss = sessions.filter(x => x.arm === arm && x.heldout.change.accuracy !== undefined);
    const list = (f: (x: typeof sessions[number]) => number | null) => ss.map(x => ({ session: x.session, value: f(x) }));
    return { arm, sessions: ss.length, accuracyChange: list(x => x.heldout.change.accuracy), coverageChange: list(x => x.heldout.change.coverage),
      corrections: list(x => x.revisionEffects.corrections), harmful: list(x => x.revisionEffects.harmful), withdrawals: list(x => x.abstentions.withdrawalsPhase2), abstentionsPhase1: list(x => x.abstentions.phase1),
      representationAvailabilityPhase1: list(x => x.representationAvailability.phase1.hypotheses ? x.representationAvailability.phase1.withStructuredRepresentation / x.representationAvailability.phase1.hypotheses : null) };
  });
  const blocks = [...new Set(sched.map(s => s.block))].map(b => {
    const c = sessions.find(x => x.block === b && x.arm === 'control'), t = sessions.find(x => x.block === b && x.arm === 'treatment');
    const both = !!(c && t && c.complete && t.complete), d = (f: (x: any) => number | null) => both && f(t) !== null && f(c) !== null ? Math.round((f(t)! - f(c)!) * 10000) / 10000 : null;
    return { block: b, complete: both, treatmentMinusControl: { accuracyChange: d(x => x.heldout.change.accuracy), coverageChange: d(x => x.heldout.change.coverage), corrections: d(x => x.revisionEffects.corrections), harmful: d(x => x.revisionEffects.harmful) } };
  });
  const body = { schema: EVALUATION_SCHEMA, preregSha256: pre.preregSha256, openedAt: at, stopped, unit: 'session (outcome checks within a session are correlated and are not replications)', sessions, arms, blocks,
    claims: 'descriptive only; no improvement claim unless the pre-registered block comparison supports it' };
  const out = join(run, 'EVALUATION.json'); if (existsSync(out)) throw new AccessRefused('EVALUATION.json exists');
  writeFileSync(out, JSON.stringify(body, null, 1) + '\n', { flag: 'wx' });
  appendCheckpoint(rec, 'evaluated', { evaluationSha256: createHash('sha256').update(readFileSync(out)).digest('hex') }, at);
  return body;
}
