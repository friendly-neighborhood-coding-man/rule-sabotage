/**
 * GW2 matched comparison: the complete pipeline (D139-D143). PREPARED, NOT EXECUTED.
 *
 * For each scheduled session, strictly one after another (no parallel paid calls, no retries):
 *   phase 1  preflight (pre-registration unchanged, budget rules) → serve the discovery site → one call → close and seal
 *            the server session → raw seal of the call → import every stored form → Freeze-1 (anchored)
 *   between  build the phase-2 site from the session's OWN Freeze-1: same shell in both arms; treatment adds the capped
 *            H↔O feedback (discovery only), control the fixed "no observation list" sentence
 *   phase 2  preflight → serve the phase-2 site (hypothesis form gains "revises") → one call → close, seal → import
 *            (revisions and withdrawals link to their originals; originals untouched) → Freeze-2 (anchored)
 * Budget (operational thresholds, not provider caps; accounting by balance delta):
 *   - a call is not started if its local estimate (steps x 3.1) exceeds its ceiling (300 phase 1, 150 phase 2), if the
 *     cumulative research spend is unknown, or if cumulative + the call's ceiling would exceed 4,000 credits;
 *   - CEILING_EXCEEDED, SPEND_UNKNOWN or reaching 4,000 stops the WHOLE experiment after that call is imported and
 *     frozen ("budget-stop"); nothing is retried and no further call starts.
 * Early termination of one call (timeout, non-zero exit, no valid run_end) is recorded ("inconclusive"): whatever was
 * submitted is imported and frozen, and the session continues, so both arms are treated alike (D143).
 * Runners: a test-double runner (doubles drive the real review server over HTTP), or kaneRunner, which goes through the
 * unchanged paid-call gate (server/balance/v4/kanebudget.ts) and is refused while that gate is 'disabled'.
 * Feedback: 'runtime' (matched/feedback.ts activateSessionFeedback; refused while AGENT_FEEDBACK_ENABLED is false) or a
 * test-only builder, which is accepted only together with a test-double runner.
 */
import { writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { startGw2Server } from '../serve.ts';
import { runFacts, sessionOutcome, sealRaw, readExecLedger, appendCheckpoint, PreflightError } from '../p7-exec.ts';
import { blindSiteProblems } from '../ext/serving-guard.ts';
import { partitionReader } from '../ext/inputs.ts';
import { AccessRefused } from '../ext/errors.ts';
import type { AgentFeedback } from '../ext/feedback-core.ts';
import type { Authorization } from '../ext/feedback.ts';
import { PAID_RESEARCH_EXECUTION } from '../../../server/balance/v4/kanebudget.ts';
import { MATCHED, estimate, type Arm, type Phase } from './params.ts';
import { schedule, type Slot } from './schedule.ts';
import { verifyMatchedPrereg } from './prereg.ts';
import { importPhase, freezeSession, loadFrozen, sessionDir } from './sessions.ts';
import { activateSessionFeedback } from './feedback.ts';
import { revisionPage, buildPhase2Site } from './revision-page.ts';

const sha = (s: string | Buffer) => createHash('sha256').update(s).digest('hex');
export type CallRequest = { runId: string; session: string; arm: Arm; phase: Phase; objective: string; maxSteps: number; timeoutS: number; port: number; url: string; ceilingCredits: number };
export type Spend = { used: number | null; outcome: 'WITHIN_CEILING' | 'CEILING_EXCEEDED' | 'SPEND_UNKNOWN'; before: number | null; after: number | null };
export type CallResult = { exitCode: number | null; timedOut: boolean; stdout: string; stderr?: string; spend: Spend; args?: unknown };
export type Runner = { kind: 'test-double' | 'kane'; preflight?: (r: Omit<CallRequest, 'port' | 'url'>) => Promise<string | null>; run: (r: CallRequest) => Promise<CallResult> };
export type FeedbackSource = { kind: 'runtime'; authorizationFor: (s: Slot) => Authorization } | { kind: 'test-only'; build: (evidence: string, run: string, rec: string, session: string) => AgentFeedback & { testOnly: true } };

export const spendOf = (before: number | null, after: number | null, ceiling: number): Spend => {
  const used = before === null || after === null ? null : Math.round((before - after) * 1000) / 1000;
  return { used, before, after, outcome: used === null ? 'SPEND_UNKNOWN' : used > ceiling ? 'CEILING_EXCEEDED' : 'WITHIN_CEILING' };
};

/** Cumulative research spend: P7 (prior) + every matched call-end in the external ledger; null if any spend is unknown. */
export function cumulative(rec: string): number | null {
  let sum = MATCHED.priorResearchCredits;
  const L = readExecLedger(rec).entries as any[];
  for (const e of L) if (e.event === 'call-end') { if (typeof e.data.used !== 'number') return null; sum += e.data.used; }
  if (L.some(e => e.event === 'call-start' && !L.some(x => x.event === 'call-end' && x.data.runId === e.data.runId))) return null;
  return Math.round(sum * 1000) / 1000;
}

/** Why a call must not start (null = it may). */
export function budgetPreflight(rec: string, phase: Phase): string | null {
  const p = MATCHED.phases[phase], est = estimate(phase), cum = cumulative(rec);
  if (est > p.ceilingCredits) return `local estimate ${est} exceeds the phase-${phase} ceiling ${p.ceilingCredits}`;
  if (cum === null) return 'cumulative research spend is unknown';
  if (cum >= MATCHED.researchThresholdCredits) return `cumulative research spend ${cum} has reached the ${MATCHED.researchThresholdCredits}-credit threshold`;
  if (cum + p.ceilingCredits > MATCHED.researchThresholdCredits) return `cumulative ${cum} + the phase-${phase} ceiling ${p.ceilingCredits} would exceed the ${MATCHED.researchThresholdCredits}-credit threshold`;
  return null;
}

export type SessionReport = { session: string; arm: Arm; block: number; phases: { phase: Phase; runId: string; status: string; reasons: string[]; used: number | null; submissions: number }[] };

/** The next scheduled call that has not started (null = none left), or why no call may start. Resumable: the ledger decides. */
export function nextCall(rec: string, sessions: Slot[] = schedule()): { slot: Slot; phase: Phase; runId: string } | null {
  const L = readExecLedger(rec).entries as any[];
  if (L.some(e => e.event === 'experiment-stopped')) throw new AccessRefused('the experiment was stopped; no further call starts');
  const dangling = L.filter(e => e.event === 'call-start' && !L.some(x => x.event === 'call-end' && x.data.runId === e.data.runId));
  if (dangling.length) throw new AccessRefused(`${dangling.map(e => e.data.runId).join(', ')} started but has no call-end; a started call is never repeated (report it, do not continue)`);
  for (const slot of sessions) for (const phase of [1, 2] as Phase[]) {
    const runId = slot.runs[phase];
    if (L.some(e => e.event === 'call-start' && e.data.runId === runId)) continue;
    if (phase === 2 && !L.some(e => e.event === 'revision-page' && e.data.session === slot.session))
      throw new AccessRefused(`${slot.session}: Freeze-1 or its phase-2 site is missing; phase 2 cannot start (report it, do not continue)`);
    return { slot, phase, runId };
  }
  return null;
}

export async function runMatched(o: { evidence: string; run: string; rec: string; runner: Runner; feedback: FeedbackSource; root?: string; sessions?: Slot[]; at?: () => string; maxCalls?: number }) {
  if (o.feedback.kind === 'test-only' && o.runner.kind !== 'test-double') throw new AccessRefused('test-only feedback is accepted only with a test-double runner');
  if (o.runner.kind === 'kane' && o.feedback.kind !== 'runtime') throw new AccessRefused('a Kane run needs the runtime feedback path');
  if (o.runner.kind === 'kane' && PAID_RESEARCH_EXECUTION === 'disabled') throw new PreflightError('the paid-call gate is disabled: no matched-comparison call can start');
  const pre = verifyMatchedPrereg(o.evidence, o.rec, { root: o.root });
  const spec = JSON.parse(partitionReader(o.evidence, ['spec'], { manifests: { spec: pre.manifests.spec } }).read('spec', 'spec.json'));
  const ruleTexts: string[] = spec.game.rules.map((r: any) => r.text), discoverySite = join(o.evidence, 'partitions/discovery/site');
  const at = o.at ?? (() => new Date().toISOString()), reports: SessionReport[] = [];
  let stopped: string | null = null, calls = 0;
  nextCall(o.rec, o.sessions ?? schedule());
  const startedRun = (runId: string) => (readExecLedger(o.rec).entries as any[]).some(e => e.event === 'call-start' && e.data.runId === runId);
  outer: for (const slot of o.sessions ?? schedule()) {
    if (stopped) break;
    const rep: SessionReport = { session: slot.session, arm: slot.arm, block: slot.block, phases: [] };
    for (const phase of [1, 2] as Phase[]) {
      if (startedRun(slot.runs[phase])) continue;
      if (o.maxCalls !== undefined && calls >= o.maxCalls) break outer;
      if (phase === 2) nextCall(o.rec, [slot]);
      calls++; if (!rep.phases.length && !reports.includes(rep)) reports.push(rep);
      verifyMatchedPrereg(o.evidence, o.rec, { root: o.root });
      const P = MATCHED.phases[phase], runId = slot.runs[phase], base = { runId, session: slot.session, arm: slot.arm, phase, objective: P.objective, maxSteps: P.maxSteps, timeoutS: P.timeoutS, ceilingCredits: P.ceilingCredits };
      const refusal = budgetPreflight(o.rec, phase) ?? (o.runner.preflight ? await o.runner.preflight(base) : null);
      if (refusal) { appendCheckpoint(o.rec, 'call-refused', { runId, session: slot.session, phase, reason: refusal }, at()); stopped = `${runId} not started: ${refusal}`; break; }
      const site = phase === 1 ? discoverySite : join(sessionDir(o.run, slot.session), 'site-2');
      const leaks = blindSiteProblems(site, ruleTexts);
      if (leaks.length) throw new AccessRefused(`${runId}: the served site holds operator content: ${leaks.join('; ')}`);
      appendCheckpoint(o.rec, 'call-start', { runId, session: slot.session, arm: slot.arm, phase, estimate: estimate(phase), ceiling: P.ceilingCredits, maxSteps: P.maxSteps, timeoutS: P.timeoutS, objectiveSha256: P.objectiveSha256 }, at());
      const srv = await startGw2Server({ exp: runId, out: join(sessionDir(o.run, slot.session), `phase-${phase}`), site, label: o.runner.kind, extraHypothesisFields: phase === 2 ? ['revises'] : [] });
      let res: CallResult;
      try { res = await o.runner.run({ ...base, port: srv.port, url: `http://127.0.0.1:${srv.port}/index.html` }); }
      catch (e) { res = { exitCode: null, timedOut: false, stdout: '', stderr: (e as Error).message, spend: spendOf(null, null, P.ceilingCredits) }; }
      finally { await srv.close(); }
      const raw = join(sessionDir(o.run, slot.session), `raw-${phase}`); mkdirSync(raw, { recursive: true });
      writeFileSync(join(raw, 'args.json'), JSON.stringify({ runId, args: res.args ?? null, serverSession: srv.session }, null, 1) + '\n');
      writeFileSync(join(raw, 'stdout.ndjson'), res.stdout); writeFileSync(join(raw, 'stderr.txt'), res.stderr ?? '');
      const facts = runFacts(res.stdout);
      appendCheckpoint(o.rec, 'call-end', { runId, session: slot.session, arm: slot.arm, phase, used: res.spend.used, outcome: res.spend.outcome, before: res.spend.before, after: res.spend.after, exitCode: res.exitCode, timedOut: res.timedOut, runEndPresent: facts.runEnd.present, steps: facts.steps }, at());
      const outcome = sessionOutcome({ exitCode: res.exitCode, timedOut: res.timedOut, facts, spend: res.spend, cumulativeUsed: cumulative(o.rec) });
      writeFileSync(join(raw, 'meta.json'), JSON.stringify({ runId, session: slot.session, arm: slot.arm, phase, serverSession: srv.session, status: outcome.status, reasons: outcome.reasons, spend: res.spend, facts }, null, 1) + '\n');
      const seal = sealRaw(raw);
      appendCheckpoint(o.rec, 'raw-seal', { runId, rawSealSha256: seal.sealSha256, files: seal.files }, at());
      importPhase(o.run, o.rec, slot, phase, srv.dir);
      const fz = freezeSession(o.run, o.rec, slot, phase, { at: at(), status: outcome.status, reasons: outcome.reasons });
      rep.phases.push({ phase, runId, status: outcome.status, reasons: outcome.reasons, used: res.spend.used, submissions: fz.submissions.length });
      if (outcome.status === 'budget-stop') { stopped = `${runId}: ${outcome.reasons.join('; ')}`; appendCheckpoint(o.rec, 'experiment-stopped', { after: runId, reasons: outcome.reasons }, at()); break; }
      if (phase === 1) {
        const frozen = loadFrozen(o.run, o.rec, slot.session, 1);
        const fb = slot.arm !== 'treatment' ? null : o.feedback.kind === 'runtime'
          ? activateSessionFeedback(o.evidence, o.run, o.rec, { session: slot.session, authorization: o.feedback.authorizationFor(slot) })
          : o.feedback.build(o.evidence, o.run, o.rec, slot.session);
        const page = revisionPage(frozen, slot.arm, fb);
        buildPhase2Site(discoverySite, join(sessionDir(o.run, slot.session), 'site-2'), page);
        appendCheckpoint(o.rec, 'revision-page', { session: slot.session, arm: slot.arm, freeze1Sha256: frozen.freezeSha256, pageSha256: sha(page),
          feedback: fb ? { digest: fb.digest, cap: fb.cap, shown: fb.totals.shown, differing: fb.totals.differing, testOnly: !!(fb as any).testOnly } : null }, at());
      }
    }
  }
  if (stopped && !(readExecLedger(o.rec).entries as any[]).some(e => e.event === 'experiment-stopped')) appendCheckpoint(o.rec, 'experiment-stopped', { reason: stopped }, at());
  return { sessions: reports, stopped, cumulative: cumulative(o.rec) };
}
