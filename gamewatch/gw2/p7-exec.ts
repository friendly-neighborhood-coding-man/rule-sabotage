/**
 * GW2 P7 preflight corrections (operator review of P6, D102–D108). Pure helpers used by kane-boundary.ts (real route),
 * p6-steps.ts (preregister / freeze / seal / integrity anchors) and the operator's ops-status view. No model, no Kane,
 * no process is started here.
 *
 *   node --experimental-strip-types --no-warnings gamewatch/gw2/p7-exec.ts ops-status <expDir>
 *   node --experimental-strip-types --no-warnings gamewatch/gw2/p7-exec.ts verify-record <recordDir>
 *
 * 1. Completion (D102): a session completed only with exit 0, no timeout AND a valid run_end (status passed|failed).
 *    Exit 0 without run_end is inconclusive and stops the pipeline.
 * 2. Budget stop (D103): CEILING_EXCEEDED or SPEND_UNKNOWN stops the pipeline at once; the gate is never cleared
 *    automatically. The cumulative research threshold (4,000 credits, a stopping threshold, not a cap) is checked
 *    before and after every call.
 * 3. Raw seal (D105): args, stdout, stderr and operational metadata of each run are hashed into RAW_SEAL.json
 *    immediately after the process ends, and the seal hash is appended to the external execution ledger.
 * 4. External anchors (Q14, D39, D106): an operator-controlled record directory OUTSIDE the repository holds the
 *    frozen pre-registration (PREREGISTRATION.json, written once) and a hash-chained execution ledger
 *    (execution-ledger.ndjson) with run identity, raw-output hashes, the hypothesis freeze, the representation seal,
 *    judgment-graph and evaluation-ledger anchors. It is as strong as the operator's control of that directory: no
 *    signature, no timestamping service.
 * 5. Monitoring vs inspection (D108): between discovery sessions only OPERATIONAL fields are shown (exit, timeout,
 *    run_end present/status/reason code, steps, elapsed ms, credits). Kane's summary, its findings and the session's
 *    submissions are semantic and are not shown until all sessions are closed, frozen and sealed.
 */
import { readFileSync, writeFileSync, existsSync, readdirSync, appendFileSync, mkdirSync, openSync, writeSync, closeSync } from 'node:fs';
import { join, relative, resolve, isAbsolute } from 'node:path';
import { createHash } from 'node:crypto';
import { ROOT } from './paths.ts';
import { canonical } from './judgments.ts';

export const RESEARCH_THRESHOLD_CREDITS = 4000;
export const RAW_SEAL_SCHEMA = 'gamewatch/gw2-raw-seal@1';
export const PREREG_SCHEMA = 'gamewatch/gw2-p7-preregistration@1';
export const EXEC_LEDGER_SCHEMA = 'gamewatch/gw2-execution-ledger@1';
const sha = (b: string | Buffer) => createHash('sha256').update(b).digest('hex');
const fileSha = (f: string) => sha(readFileSync(f));
export class PreflightError extends Error {}

// ---------------------------------------------------------------- 1. completion and operational facts
export type RunFacts = { runEnd: { present: boolean; valid: boolean; status: string | null; reasonCode: string | null; resultCode: number | null }; steps: number | null; kaneCreditsReported: number | null; kaneDurationS: number | null; cliVersion: string | null };
/** Operational facts of a kane-cli objective-mode stdout. Never returns Kane's summary or any finding text. */
export function runFacts(stdout: string): RunFacts {
  let end: Record<string, any> | null = null, start: Record<string, any> | null = null, steps: number | null = null;
  for (const l of stdout.split(/\r?\n/)) {
    const t = l.trim(); if (!t.startsWith('{')) continue;
    let e: any; try { e = JSON.parse(t); } catch { continue; }
    if (e?.type === 'run_end') end = e;
    if (e?.type === 'stream_start' && !start) start = e;
    if (Number.isInteger(e?.step) && e.type !== 'run_end') steps = Math.max(steps ?? 0, e.step);
  }
  const status = end && typeof end.status === 'string' ? end.status : null;
  if (end && Number.isInteger(end.steps)) steps = Math.max(steps ?? 0, end.steps);
  return {
    runEnd: { present: !!end, valid: status === 'passed' || status === 'failed', status, reasonCode: typeof end?.reason_code === 'string' ? end.reason_code : null, resultCode: Number.isFinite(Number(end?.result_code)) && end?.result_code !== undefined ? Number(end!.result_code) : null },
    steps, kaneCreditsReported: typeof end?.credits_consumed === 'number' ? end.credits_consumed : null, kaneDurationS: typeof end?.duration === 'number' ? end.duration : null,
    cliVersion: typeof start?.cli_version === 'string' ? start.cli_version : null,
  };
}

export type Spend = { used: number | null; outcome: string } | null;
/** completed: the session may count; anything else stops the pipeline (no retry, no further session). */
export function sessionOutcome(x: { exitCode: number | null; timedOut: boolean; facts: RunFacts; spend?: Spend; cumulativeUsed?: number | null }) {
  const reasons: string[] = [];
  if (x.timedOut) reasons.push('timed out (process tree killed)');
  if (x.exitCode !== 0) reasons.push(`exit code ${x.exitCode}`);
  if (!x.facts.runEnd.present) reasons.push('no run_end event: exit code alone does not establish completion');
  else if (!x.facts.runEnd.valid) reasons.push(`run_end status ${JSON.stringify(x.facts.runEnd.status)} is not passed|failed`);
  const budget: string[] = [];
  if (x.spend && x.spend.outcome !== 'WITHIN_CEILING') budget.push(`${x.spend.outcome}: the gate refuses further calls until the operator clears it; this pipeline never clears it`);
  if (x.cumulativeUsed === null) budget.push('cumulative research spend unknown');
  else if (x.cumulativeUsed !== undefined && x.cumulativeUsed >= RESEARCH_THRESHOLD_CREDITS) budget.push(`cumulative research spend ${x.cumulativeUsed} >= ${RESEARCH_THRESHOLD_CREDITS}-credit threshold`);
  const status = budget.length ? 'budget-stop' : reasons.length ? 'inconclusive' : 'completed';
  return { status, stop: status !== 'completed', reasons: [...reasons, ...budget] };
}

/** Sum of balance deltas in a gate ledger (null when any ended call has an unknown spend). */
export function cumulativeUsed(ledger: { event: string; detail: Record<string, unknown> }[]): number | null {
  let sum = 0;
  for (const e of ledger) if (e.event === 'call-end') { if (typeof e.detail.used !== 'number') return null; sum += e.detail.used; }
  for (const e of ledger) if (e.event === 'call-start' && !ledger.some(x => x.event === 'call-end' && (x as any).runId === (e as any).runId)) return null; // a started call without an end: spend unknown
  return Math.round(sum * 1000) / 1000;
}

// ---------------------------------------------------------------- 3. raw seal
export const RAW_FILES = ['args.json', 'stdout.ndjson', 'stderr.txt', 'meta.json'] as const;
export function sealRaw(dir: string) {
  const files = Object.fromEntries(RAW_FILES.map(f => { if (!existsSync(join(dir, f))) throw new PreflightError(`raw seal: ${f} missing in ${dir}`); return [f, fileSha(join(dir, f))]; }));
  const fd = openSync(join(dir, 'RAW_SEAL.json'), 'wx');
  const body = { schema: RAW_SEAL_SCHEMA, files, note: 'sha256 of the raw, unredacted files as written when the process ended; a published redacted copy will not match and is accompanied by a redaction record' };
  try { writeSync(fd, JSON.stringify(body, null, 1) + '\n'); } finally { closeSync(fd); }
  return { ...body, sealSha256: fileSha(join(dir, 'RAW_SEAL.json')) };
}
export function verifyRawSeal(dir: string) {
  const f = join(dir, 'RAW_SEAL.json'); if (!existsSync(f)) return { ok: false, problems: ['RAW_SEAL.json missing'], sealSha256: null };
  const s = JSON.parse(readFileSync(f, 'utf8')), problems: string[] = [];
  for (const [n, h] of Object.entries(s.files as Record<string, string>)) if (!existsSync(join(dir, n)) || fileSha(join(dir, n)) !== h) problems.push(`${n} differs from its raw seal`);
  return { ok: !problems.length, problems, sealSha256: fileSha(f) };
}

// ---------------------------------------------------------------- 4. external operator record (Q14)
export function recordDir(p: string | undefined): string {
  if (!p) throw new PreflightError('no external operator record given (Q14): pass --record <dir outside the repository>');
  const abs = resolve(p), rel = relative(ROOT, abs);
  if (!rel || (!rel.startsWith('..') && !isAbsolute(rel))) throw new PreflightError(`the external record ${p} is inside the repository; Q14 requires an operator-controlled location outside it`);
  return abs;
}
const ledgerFile = (rec: string) => join(rec, 'execution-ledger.ndjson');
export function readExecLedger(rec: string) {
  const f = ledgerFile(rec); if (!existsSync(f)) return { ok: true, entries: [] as Record<string, any>[], problems: [] as string[] };
  const raw = readFileSync(f, 'utf8'), lines = raw.split('\n'), problems: string[] = [], entries: Record<string, any>[] = [];
  if (raw.length && !raw.endsWith('\n')) problems.push('unterminated last line');
  let prev: string | null = null;
  lines.filter(Boolean).forEach((l, i) => {
    let e: any; try { e = JSON.parse(l); } catch { problems.push(`line ${i + 1}: not JSON`); return; }
    if (canonical(e) !== l) problems.push(`line ${i + 1}: not canonical`);
    if (e.schema !== EXEC_LEDGER_SCHEMA || e.seq !== i + 1 || e.prev !== prev) problems.push(`line ${i + 1}: schema, seq or prev hash broken`);
    prev = sha(l); entries.push(e);
  });
  return { ok: !problems.length, entries, problems };
}
export function appendCheckpoint(rec: string, event: string, data: Record<string, unknown>, at = new Date().toISOString()) {
  const l = readExecLedger(rec); if (!l.ok) throw new PreflightError(`external execution ledger invalid: ${l.problems.join('; ')}`);
  const raw = existsSync(ledgerFile(rec)) ? readFileSync(ledgerFile(rec), 'utf8').split('\n').filter(Boolean) : [];
  const line = canonical({ schema: EXEC_LEDGER_SCHEMA, seq: raw.length + 1, prev: raw.length ? sha(raw[raw.length - 1]) : null, at, event, data });
  mkdirSync(rec, { recursive: true }); appendFileSync(ledgerFile(rec), line + '\n');
  return { seq: raw.length + 1, lineSha256: sha(line) };
}

/** The files whose bytes the pre-registration freezes (repository-relative, or experiment-relative with exp:). */
export const PREREG_FILES = ['docs/gw2/P7_PREREGISTRATION.md', 'docs/gw2/P7_OPERATOR_CHECKLIST.md', 'gamewatch/gw2/book-p7.json', 'gamewatch/gw2/p7-plan.ts', 'gamewatch/gw2/kane-boundary.ts', 'gamewatch/gw2/p7-exec.ts', 'server/balance/v4/kanebudget.ts', 'evidence/gw2/procedures/generation-p7-1.json', 'evidence/gw2/procedures/partition-p7-1.json', 'evidence/gw2/p7-evidence/generated/bundle.json', 'exp:partitions/PARTITION.json', 'exp:SESSIONS.json', 'exp:LEAK_CHECK.json'];
const resolveFile = (exp: string, f: string) => f.startsWith('exp:') ? join(exp, f.slice(4)) : join(ROOT, f);
const lfSha = (f: string) => sha(readFileSync(f, 'utf8').replace(/\r\n/g, '\n')); // line endings do not change a frozen text (Windows checkouts)

/** Evidence is unopened: no session, graph, freeze, evaluation or paid call exists yet. */
export function unopened(exp: string) {
  const problems: string[] = [];
  if (existsSync(join(exp, 'sessions')) && readdirSync(join(exp, 'sessions')).length) problems.push('sessions exist');
  for (const f of ['judgments.ndjson', 'hypotheses/FREEZE.json', 'evaluation-ledger.ndjson', 'INVESTIGATORS.json']) if (existsSync(join(exp, f))) problems.push(`${f} exists`);
  if (existsSync(join(exp, 'evaluations')) && readdirSync(join(exp, 'evaluations')).length) problems.push('evaluations exist');
  if (existsSync(join(exp, 'kane-ledger.ndjson')) && /"call-start"/.test(readFileSync(join(exp, 'kane-ledger.ndjson'), 'utf8'))) problems.push('a paid call has already started');
  return problems;
}

export function preregister(exp: string, rec: string, o: { committedPartition: string; plan: Record<string, unknown>; at?: string }) {
  const problems = unopened(exp);
  const mine = JSON.parse(readFileSync(join(exp, 'partitions/PARTITION.json'), 'utf8')).manifests, committed = JSON.parse(readFileSync(o.committedPartition, 'utf8')).manifests;
  if (canonical(mine) !== canonical(committed)) problems.push('partition manifests differ from the committed, unopened P7 partition');
  const leak = JSON.parse(readFileSync(join(exp, 'LEAK_CHECK.json'), 'utf8')); if (leak.ok !== true) problems.push('leak check did not pass');
  if (existsSync(join(rec, 'PREREGISTRATION.json'))) problems.push('the external record already holds a pre-registration (it is written once)');
  if (problems.length) throw new PreflightError(`pre-registration refused: ${problems.join('; ')}`);
  const files = Object.fromEntries(PREREG_FILES.map(f => [f, lfSha(resolveFile(exp, f))]));
  const body = { schema: PREREG_SCHEMA, at: o.at ?? new Date().toISOString(), exp: relative(ROOT, exp).split('\\').join('/'), files, plan: o.plan,
    status: { evidence: 'unopened', encoding2: 'provisional, exploratory only (U2, D94)', externalTranslation: 'none (U3, D95)' },
    guarantee: 'Operator-controlled copy outside the repository and outside the agent input boundary (Q14, D39). No signature or timestamping service: it detects later edits of the frozen files only as far as the operator controls this directory.' };
  mkdirSync(rec, { recursive: true });
  const fd = openSync(join(rec, 'PREREGISTRATION.json'), 'wx'); try { writeSync(fd, JSON.stringify(body, null, 1) + '\n'); } finally { closeSync(fd); }
  const preregSha256 = fileSha(join(rec, 'PREREGISTRATION.json'));
  appendCheckpoint(rec, 'preregistered', { preregSha256, files });
  return { preregSha256, files };
}

/** Before every paid call: the frozen pre-registration exists, the ledger chain holds, and no frozen file changed. */
export function verifyPrereg(exp: string, rec: string) {
  const problems: string[] = [], f = join(rec, 'PREREGISTRATION.json');
  if (!existsSync(f)) return { ok: false, problems: ['no frozen pre-registration in the external record'] };
  const p = JSON.parse(readFileSync(f, 'utf8')), l = readExecLedger(rec);
  if (!l.ok) problems.push(...l.problems.map(x => `execution ledger: ${x}`));
  const first = l.entries[0];
  if (!first || first.event !== 'preregistered' || first.data.preregSha256 !== fileSha(f)) problems.push('execution ledger does not start with this pre-registration');
  for (const [k, h] of Object.entries(p.files as Record<string, string>)) { const x = resolveFile(exp, k); if (!existsSync(x) || lfSha(x) !== h) problems.push(`${k} changed since the pre-registration`); }
  return { ok: !problems.length, problems };
}

// ---------------------------------------------------------------- 5. operational status (no semantic content)
export const OPERATIONAL_FIELDS = ['session', 'runId', 'route', 'status', 'stopReasons', 'exitCode', 'timedOut', 'ms', 'runEnd', 'steps', 'kaneCreditsReported', 'spend', 'cumulativeUsed', 'rawSealSha256'] as const;
export function opsStatus(exp: string) {
  const f = join(exp, 'INVESTIGATORS.json'), sessions = existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')).sessions as Record<string, unknown>[] : [];
  return sessions.map(s => Object.fromEntries(OPERATIONAL_FIELDS.filter(k => k in s).map(k => [k, s[k]])));
}

if (process.argv[1]?.replace(/\\/g, "/").endsWith('gw2/p7-exec.ts')) {
  const [cmd, p] = process.argv.slice(2);
  if (cmd === 'ops-status' && p) { console.log(JSON.stringify(opsStatus(resolve(p)), null, 1)); process.exit(0); }
  if (cmd === 'verify-record' && p) { const l = readExecLedger(resolve(p)); console.log(JSON.stringify({ ok: l.ok, entries: l.entries.length, events: l.entries.map(e => e.event), problems: l.problems }, null, 1)); process.exit(l.ok ? 0 : 1); }
  console.error('usage: p7-exec.ts ops-status <expDir> | verify-record <recordDir>'); process.exit(2);
}
