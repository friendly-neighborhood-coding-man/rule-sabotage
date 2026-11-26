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
import { join, relative } from 'node:path';
import { createHash } from 'node:crypto';
import { startGw2Server } from '../serve.ts';
import { runFacts, sessionOutcome, sealRaw, readExecLedger, appendCheckpoint, PreflightError } from '../p7-exec.ts';
import { blindSiteProblems } from '../ext/serving-guard.ts';
import { sessionClosure } from '../session-close.ts';
import { readJournal } from '../journal.ts';
import { executionProblems, discoverySiteProblems } from './integrity.ts';
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
import { revisionPage, buildPhase2Site, siteFiles } from './revision-page.ts';

const sha = (s: string | Buffer) => createHash('sha256').update(s).digest('hex');
export type CallRequest = { runId: string; session: string; arm: Arm; phase: Phase; objective: string; maxSteps: number; timeoutS: number; port: number; url: string; ceilingCredits: number };
export type Spend = { used: number | null; outcome: 'WITHIN_CEILING' | 'CEILING_EXCEEDED' | 'SPEND_UNKNOWN'; before: number | null; after: number | null };
export type CallResult = { exitCode: number | null; timedOut: boolean; stdout: string; stderr?: string; spend: Spend; args?: unknown };
export type Runner = { kind: 'test-double' | 'kane'; gateMode?: 'disabled' | 'per-run-approval'; preflight?: (r: Omit<CallRequest, 'port' | 'url'>) => Promise<string | null>; run: (r: CallRequest) => Promise<CallResult> };
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

/** The next scheduled call that has not started (null = none left), or why no call may start. Resumable: the ledger decides.
 * Refuses after a stop, after any incomplete sealing transaction and on any integrity problem of what already ran. */
export function nextCall(run: string, rec: string, sessions: Slot[] = schedule()): { slot: Slot; phase: Phase; runId: string } | null {
  const L = readExecLedger(rec).entries as any[];
  if (L.some(e => e.event === 'experiment-stopped')) throw new AccessRefused('the experiment was stopped; no further call starts');
  const dangling = L.filter(e => e.event === 'call-start' && !L.some(x => x.event === 'call-end' && x.data.runId === e.data.runId));
  if (dangling.length) throw new AccessRefused(`${dangling.map(e => e.data.runId).join(', ')} started but has no call-end; a started call is never repeated (report it, do not continue)`);
  const problems = executionProblems(run, rec);
  if (problems.length) throw new AccessRefused(`integrity check failed; no further call starts: ${problems.join('; ')}`);
  for (const slot of sessions) for (const phase of [1, 2] as Phase[]) {
    const runId = slot.runs[phase];
    if (L.some(e => e.event === 'call-start' && e.data.runId === runId)) continue;
    if (phase === 2 && !L.some(e => e.event === 'revision-page' && e.data.session === slot.session))
      throw new AccessRefused(`${slot.session}: Freeze-1 or its phase-2 site is missing; phase 2 cannot start (report it, do not continue)`);
    return { slot, phase, runId };
  }
  return null;
}

/** A call is complete only with exit 0, no timeout and a VALID run_end (not merely a present one). */
export const callComplete = (c: { exitCode: number | null; timedOut: boolean; runEndValid?: boolean }) => c.exitCode === 0 && !c.timedOut && c.runEndValid === true;

export async function runMatched(o: { evidence: string; run: string; rec: string; runner: Runner; feedback: FeedbackSource; root?: string; sessions?: Slot[]; at?: () => string; maxCalls?: number }) {
  if (o.feedback.kind === 'test-only' && o.runner.kind !== 'test-double') throw new AccessRefused('test-only feedback is accepted only with a test-double runner');
  if (o.runner.kind === 'kane' && o.feedback.kind !== 'runtime') throw new AccessRefused('a Kane run needs the runtime feedback path');
  if (o.runner.kind === 'kane' && (o.runner.gateMode ?? PAID_RESEARCH_EXECUTION) === 'disabled') throw new PreflightError('the paid-call gate is disabled: no matched-comparison call can start');
  const pre = verifyMatchedPrereg(o.evidence, o.rec, { root: o.root });
  const spec = JSON.parse(partitionReader(o.evidence, ['spec'], { manifests: { spec: pre.manifests.spec } }).read('spec', 'spec.json'));
  const ruleTexts: string[] = spec.game.rules.map((r: any) => r.text), discoverySite = join(o.evidence, 'partitions/discovery/site');
  const at = o.at ?? (() => new Date().toISOString()), reports: SessionReport[] = [];
  let stopped: string | null = null, calls = 0;
  const sessions = o.sessions ?? schedule();
  nextCall(o.run, o.rec, sessions);
  const startedRun = (runId: string) => (readExecLedger(o.rec).entries as any[]).some(e => e.event === 'call-start' && e.data.runId === runId);
  outer: for (const slot of sessions) {
    if (stopped) break;
    const rep: SessionReport = { session: slot.session, arm: slot.arm, block: slot.block, phases: [] };
    for (const phase of [1, 2] as Phase[]) {
      if (startedRun(slot.runs[phase])) continue;
      if (o.maxCalls !== undefined && calls >= o.maxCalls) break outer;
      nextCall(o.run, o.rec, [slot]); // stop, incomplete transaction, integrity: re-checked before every call
      calls++; if (!reports.includes(rep)) reports.push(rep);
      verifyMatchedPrereg(o.evidence, o.rec, { root: o.root });
      const P = MATCHED.phases[phase], runId = slot.runs[phase], base = { runId, session: slot.session, arm: slot.arm, phase, objective: P.objective, maxSteps: P.maxSteps, timeoutS: P.timeoutS, ceilingCredits: P.ceilingCredits };
      const refusal = budgetPreflight(o.rec, phase) ?? (o.runner.preflight ? await o.runner.preflight(base) : null);
      if (refusal) { appendCheckpoint(o.rec, 'call-refused', { runId, session: slot.session, phase, reason: refusal }, at()); stopped = `${runId} not started: ${refusal}`; break; }
      const site = phase === 1 ? discoverySite : join(sessionDir(o.run, slot.session), 'site-2');
      const siteCheck = phase === 1 ? discoverySiteProblems(o.evidence, pre.manifests.discovery) : [];
      const leaks = [...siteCheck, ...blindSiteProblems(site, ruleTexts)];
      if (leaks.length) { appendCheckpoint(o.rec, 'call-refused', { runId, session: slot.session, phase, reason: leaks.join('; ') }, at()); appendCheckpoint(o.rec, 'experiment-stopped', { reason: `${runId} not started: the site to serve fails its checks` }, at()); throw new AccessRefused(`${runId}: the site to serve fails its checks: ${leaks.join('; ')}`); }
      const servedSite = siteFiles(site);
      appendCheckpoint(o.rec, 'call-start', { runId, session: slot.session, arm: slot.arm, phase, estimate: estimate(phase), ceiling: P.ceilingCredits, maxSteps: P.maxSteps, timeoutS: P.timeoutS, objectiveSha256: P.objectiveSha256, runner: o.runner.kind }, at());
      let stage = 'serve';
      try {
        const srv = await startGw2Server({ exp: runId, out: join(sessionDir(o.run, slot.session), `phase-${phase}`), site, label: o.runner.kind, extraHypothesisFields: phase === 2 ? ['revises'] : [] });
        let res: CallResult;
        stage = 'call';
        try { res = await o.runner.run({ ...base, port: srv.port, url: `http://127.0.0.1:${srv.port}/index.html` }); }
        catch (e) { res = { exitCode: null, timedOut: false, stdout: '', stderr: (e as Error).message, spend: spendOf(null, null, P.ceilingCredits) }; }
        finally { stage = 'server-close'; await srv.close(); }
        stage = 'raw';
        const raw = join(sessionDir(o.run, slot.session), `raw-${phase}`); mkdirSync(raw, { recursive: true });
        // a Kane call stores the CLI, its version, the exact argv and the run nonce at top level (judgments.ts kaneExecution)
        writeFileSync(join(raw, 'args.json'), JSON.stringify(o.runner.kind === 'kane' ? { runId, runner: 'kane', ...(res.args as object), nonce: srv.nonce, serverSession: srv.session }
          : { runId, runner: o.runner.kind, args: res.args ?? null, serverSession: srv.session }, null, 1) + '\n');
        writeFileSync(join(raw, 'stdout.ndjson'), res.stdout); writeFileSync(join(raw, 'stderr.txt'), res.stderr ?? '');
        const facts = runFacts(res.stdout);
        appendCheckpoint(o.rec, 'call-end', { runId, session: slot.session, arm: slot.arm, phase, used: res.spend.used, outcome: res.spend.outcome, before: res.spend.before, after: res.spend.after, exitCode: res.exitCode, timedOut: res.timedOut,
          runEndPresent: facts.runEnd.present, runEndValid: facts.runEnd.valid, runEndStatus: facts.runEnd.status, steps: facts.steps, complete: callComplete({ exitCode: res.exitCode, timedOut: res.timedOut, runEndValid: facts.runEnd.valid }) }, at());
        const outcome = sessionOutcome({ exitCode: res.exitCode, timedOut: res.timedOut, facts, spend: res.spend, cumulativeUsed: cumulative(o.rec) });
        writeFileSync(join(raw, 'meta.json'), JSON.stringify({ runId, session: slot.session, arm: slot.arm, phase, serverSession: srv.session, status: outcome.status, reasons: outcome.reasons, spend: res.spend, facts }, null, 1) + '\n');
        stage = 'raw-seal';
        const seal = sealRaw(raw);
        appendCheckpoint(o.rec, 'raw-seal', { runId, rawSealSha256: seal.sealSha256, files: seal.files }, at());
        stage = 'server-closed';
        const cl = sessionClosure(srv.dir);
        if (cl.status !== 'closed') throw new Error(`server session not closed: ${cl.problems.join('; ')}`);
        const jf = join(srv.dir, 'access.ndjson'), meta = JSON.parse(readFileSync(join(srv.dir, 'session.json'), 'utf8')), j = readJournal(jf, { logging: 'on', session: meta.session });
        appendCheckpoint(o.rec, 'server-closed', { runId, session: slot.session, phase, dir: relative(o.run, srv.dir).replace(/\\/g, '/'), closureSealSha256: cl.sealSha256, journalSha256: sha(readFileSync(jf)), journalStatus: j.status,
          servedSite: (j.lines.find((l: any) => l.type === 'session-start') as any)?.site?.files ?? null, servedSiteFiles: servedSite, label: meta.label }, at());
        stage = 'import';
        const version = (res.args as any)?.version;
        importPhase(o.run, o.rec, slot, phase, srv.dir, o.runner.kind === 'kane' ? { kane: { stdout: join(raw, 'stdout.ndjson'), args: join(raw, 'args.json'), version: typeof version === 'string' ? version : '' } } : {});
        stage = 'freeze';
        const fz = freezeSession(o.run, o.rec, slot, phase, { at: at(), status: outcome.status, reasons: outcome.reasons });
        rep.phases.push({ phase, runId, status: outcome.status, reasons: outcome.reasons, used: res.spend.used, submissions: fz.submissions.length });
        if (outcome.status === 'budget-stop') { stopped = `${runId}: ${outcome.reasons.join('; ')}`; appendCheckpoint(o.rec, 'experiment-stopped', { after: runId, reasons: outcome.reasons }, at()); break; }
        if (phase === 1) {
          stage = 'revision-page';
          const frozen = loadFrozen(o.run, o.rec, slot.session, 1);
          const fb = slot.arm !== 'treatment' ? null : o.feedback.kind === 'runtime'
            ? activateSessionFeedback(o.evidence, o.run, o.rec, { session: slot.session, authorization: o.feedback.authorizationFor(slot) })
            : o.feedback.build(o.evidence, o.run, o.rec, slot.session);
          const page = revisionPage(frozen, slot.arm, fb), site2 = join(sessionDir(o.run, slot.session), 'site-2');
          buildPhase2Site(discoverySite, site2, page);
          appendCheckpoint(o.rec, 'revision-page', { session: slot.session, arm: slot.arm, freeze1Sha256: frozen.freezeSha256, pageSha256: sha(page), siteFiles: siteFiles(site2),
            feedback: fb ? { digest: fb.digest, cap: fb.cap, shown: fb.totals.shown, differing: fb.totals.differing, testOnly: !!(fb as any).testOnly } : null }, at());
        }
      } catch (e) {
        // recorded explicitly; the call is never retried and nothing further starts
        appendCheckpoint(o.rec, 'call-failed', { runId, session: slot.session, phase, stage, error: (e as Error).message }, at());
        appendCheckpoint(o.rec, 'experiment-stopped', { reason: `${runId} failed at ${stage}: ${(e as Error).message}` }, at());
        throw new AccessRefused(`${runId} failed at ${stage} (recorded; not retried): ${(e as Error).message}`);
      }
    }
  }
  if (stopped && !(readExecLedger(o.rec).entries as any[]).some(e => e.event === 'experiment-stopped')) appendCheckpoint(o.rec, 'experiment-stopped', { reason: stopped }, at());
  return { sessions: reports, stopped, cumulative: cumulative(o.rec) };
}
