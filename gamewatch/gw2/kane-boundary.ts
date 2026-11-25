/**
 * GW2 P6: the Kane CLI invocation boundary for blind discovery sessions (AC-P6.1, AC-P6.2). No model is called here.
 *
 *   node --experimental-strip-types --no-warnings gamewatch/gw2/kane-boundary.ts <expDir> --route real|test-double
 *        [--run-id ID] [--profiles a,b,...] [--shim gamewatch/gw2/doubles/kane-shim.mjs] [--max-steps N] [--timeout S]
 *
 * route real         the paid-call gate (server/balance/v4/kanebudget.ts runPaidCall, unchanged) decides BEFORE any
 *                    process is started. While PAID_RESEARCH_EXECUTION is 'disabled' (every commit) it refuses: exit 2,
 *                    no server, no Kane process. P6 never gets further. The code after the gate is prepared for P7 and
 *                    is reachable only after the operator explicitly changes the gate; it is not exercised in P6.
 * route test-double  one session per profile: a GW2 review server (journal on) serves the experiment's discovery site,
 *                    and the deterministic shim gamewatch/gw2/doubles/kane-shim.mjs is started through the SAME process
 *                    boundary a real call uses (server/kane.ts runCapture, KANE_CLI = the shim) with the P7 argv
 *                    (p7-plan.ts kaneArgv). The shim path must be the repository's own shim file: a real kane-cli is
 *                    never started on this route. The session is labelled test-double, closed and sealed by the server.
 * Writes <exp>/INVESTIGATORS.json (operator record, outside the agent's input boundary): per session the profile, the
 * route, argv, CLI path, exit code, run_end and stdout hash; raw stdout/args under <exp>/kane-runs/<session>/.
 * Exit codes: 0 every session ran and closed · 2 refused before any process · 3 a session failed.
 */
import { writeFileSync, mkdirSync, readFileSync, existsSync, readdirSync, appendFileSync } from 'node:fs';
import { join, resolve, relative, isAbsolute } from 'node:path';
import { createHash } from 'node:crypto';
import { ROOT, assertWritableOutput } from './paths.ts';
import { startGw2Server } from './serve.ts';
import { kaneArgv, P7_KILL_AFTER_S, P7_MAX_STEPS, P7_TIMEOUT_S, P7_EXPECTED_CLI_VERSION } from './p7-plan.ts';
import { strictVersion, strictBalance } from '../../scripts/kane-single-call.ts';
import { runCapture, parseKaneOutput } from '../../server/kane.ts';
import { runPaidCall, checkPaidCall, readLedger, PaidCallRefused, PAID_RESEARCH_EXECUTION, type Deps, type PaidApproval } from '../../server/balance/v4/kanebudget.ts';
import { runFacts, sessionOutcome, cumulativeUsed, sealRaw, appendCheckpoint, recordDir, verifyPrereg, RESEARCH_THRESHOLD_CREDITS } from './p7-exec.ts';

export const PROFILES = ['accurate', 'careless', 'over-abstaining', 'confident-wrong', 'defect-describer'] as const;
export const SHIM = 'gamewatch/gw2/doubles/kane-shim.mjs';
export class BoundaryRefused extends Error {}
const sha = (s: string) => createHash('sha256').update(s).digest('hex');

/**
 * The real route (P7, D99, corrected by D102–D108): ONE paid objective-mode call per invocation, decided by the gate.
 * Order: (1) while PAID_RESEARCH_EXECUTION is 'disabled' the gate refuses before a server or any process exists;
 * (2) preflight before any process: the external operator record (Q14) holds the frozen pre-registration and no frozen
 * file changed; no other approval is active at the same time; no earlier session stopped the pipeline; the cumulative
 * research spend is below its threshold; (3) the review server is started and runPaidCall re-checks the approval file
 * <exp>/approvals/<runId>.json, KANE_PAID_RUN_AUTH = runId, the real CLI version, the balance and the ceiling;
 * (4) after the process ends: raw args/stdout/stderr/meta are sealed by hash and the seal is appended to the external
 * execution ledger before anything else; completion needs exit 0, no timeout AND a valid run_end; CEILING_EXCEEDED,
 * SPEND_UNKNOWN or the cumulative threshold stop the pipeline (exit 3). Only operational fields are recorded in
 * INVESTIGATORS.json and printed (D108).
 * `harness` exists for tests only: it is accepted only when KANE_CLI is the repository shim, so it can never start a
 * real kane-cli; it lets the tests drive the post-gate path with the gate in per-run-approval mode.
 */
export type RealRouteResult = { refused: string } | { session: string; status: string; stop: boolean; reasons: string[]; spend: unknown; exitCode: number | null; timedOut: boolean; rawSealSha256: string };
export async function realRoute(exp: string, o: { runId?: string; record?: string; harness?: { mode: 'per-run-approval'; expectVersion: string } } = {}): Promise<RealRouteResult> {
  const ledgerFile = join(exp, 'kane-ledger.ndjson');
  const mode = o.harness ? o.harness.mode : PAID_RESEARCH_EXECUTION;
  const gateSeams = o.harness ? { mode, scope: null } : {}; // only the shim harness may inject gate settings
  if (o.harness) checkShim(process.env.KANE_CLI ?? '');
  let started = false;
  const refusedEarly: Deps = { ledgerFile, env: process.env, ...gateSeams, isRealCli: async () => { started = true; return false; }, balance: async () => { started = true; return null; }, exec: async () => { started = true; throw new Error('unreachable'); } };
  if (mode === 'disabled') {
    try { await runPaidCall(null, { maxSteps: P7_MAX_STEPS, timeoutS: P7_TIMEOUT_S }, refusedEarly); }
    catch (e) { if (e instanceof PaidCallRefused) { if (started) throw new Error('the gate consulted the CLI before refusing'); return { refused: e.reason }; } throw e; }
    throw new Error('the paid-call gate did not refuse while disabled; stopping');
  }
  // ---- preflight (before any server or process) ----
  const runId = o.runId ?? '';
  const refuse = (reason: string) => { appendFileSync(ledgerFile, JSON.stringify({ at: new Date().toISOString(), runId: runId || '-', event: 'refused', detail: { reason, stage: 'p7-preflight' } }) + '\n'); return { refused: reason }; };
  let rec: string;
  try { rec = recordDir(o.record); } catch (e) { return refuse((e as Error).message); }
  const pre = verifyPrereg(exp, rec); if (!pre.ok) return refuse(`pre-registration: ${pre.problems.join('; ')}`);
  const ledger = readLedger(ledgerFile), startedIds = new Set(ledger.filter(e => e.event === 'call-start').map(e => e.runId));
  const active = existsSync(join(exp, 'approvals')) ? readdirSync(join(exp, 'approvals')).filter(f => f.endsWith('.json')).map(f => f.slice(0, -5)).filter(id => id !== runId && !startedIds.has(id)) : [];
  if (active.length) return refuse(`approvals must be activated one at a time, immediately before their run; also active: ${active.join(', ')}`);
  const invF = join(exp, 'INVESTIGATORS.json'), prevInv = existsSync(invF) ? JSON.parse(readFileSync(invF, 'utf8')).sessions as Record<string, any>[] : [];
  const stopped = prevInv.find(x => x.route === 'real' && x.status !== 'completed');
  if (stopped) return refuse(`an earlier session (${stopped.runId}) ended ${stopped.status}: the pipeline stops; no further session`);
  const cum = cumulativeUsed(ledger);
  if (cum === null || cum >= RESEARCH_THRESHOLD_CREDITS) return refuse(`cumulative research spend ${cum ?? 'unknown'} is not below the ${RESEARCH_THRESHOLD_CREDITS}-credit threshold`);
  // ---- the call ----
  const approvalF = join(exp, 'approvals', `${runId}.json`);
  const approval = runId && existsSync(approvalF) ? JSON.parse(readFileSync(approvalF, 'utf8')) as PaidApproval : null;
  const expectVersion = o.harness?.expectVersion ?? P7_EXPECTED_CLI_VERSION;
  let version: string | null = null;
  const probe = {
    isRealCli: async () => { const r = await runCapture(['--version'], 60_000); version = r.code === 0 ? strictVersion(r.stdout) : null; return version === expectVersion; },
    balance: async () => { const r = await runCapture(['balance'], 60_000); return r.code === 0 ? strictBalance(r.stdout, version) : null; },
  };
  // every gate check passes BEFORE the review server (and its session directory) exists; runPaidCall re-checks
  try { await checkPaidCall(approval, { maxSteps: P7_MAX_STEPS, timeoutS: P7_TIMEOUT_S }, { ledgerFile, env: process.env, ...gateSeams, ...probe, exec: async () => { throw new Error('unreachable'); } }); }
  catch (e) { if (e instanceof PaidCallRefused) return { refused: e.reason }; throw e; }
  const s = await startGw2Server({ exp: 'p7', out: exp, site: join(exp, 'partitions/discovery/site'), label: 'kane' });
  let closed = false; const close = async () => { if (!closed) { closed = true; await s.close(); } };
  const dir = assertWritableOutput(join(exp, 'kane-runs', s.session)); mkdirSync(dir, { recursive: true });
  const out = { stdout: '', stderr: '', code: null as number | null, timedOut: false, ms: 0 };
  const deps: Deps = {
    ledgerFile, env: process.env, ...gateSeams, ...probe,
    exec: async () => {
      const args = kaneArgv(s.port);
      // cli is the logical CLI name the importer checks (judgments.ts kaneExecution); the resolved path is kept apart
      writeFileSync(join(dir, 'args.json'), JSON.stringify({ cli: 'kane-cli', cliPath: process.env.KANE_CLI || 'kane-cli', version, args, runId, nonce: s.nonce, session: s.session, ...(o.harness ? { testHarness: 'repository shim, not kane-cli' } : {}), startedAt: new Date().toISOString() }, null, 1) + '\n');
      const r = await runCapture(args, P7_KILL_AFTER_S * 1000);
      Object.assign(out, { stdout: r.stdout, stderr: r.stderr, code: r.code, timedOut: r.timedOut, ms: r.ms });
      writeFileSync(join(dir, 'stdout.ndjson'), r.stdout); writeFileSync(join(dir, 'stderr.txt'), r.stderr);
      return { timedOut: r.timedOut, exitCode: r.code };
    },
  };
  let spend: Awaited<ReturnType<typeof runPaidCall>>;
  try { spend = await runPaidCall(approval, { maxSteps: P7_MAX_STEPS, timeoutS: P7_TIMEOUT_S }, deps); }
  catch (e) { if (e instanceof PaidCallRefused) return { refused: e.reason }; throw e; }
  finally { await close(); } // closes and seals the session (CLOSED.json)
  if (!existsSync(join(dir, 'args.json'))) writeFileSync(join(dir, 'args.json'), JSON.stringify({ cli: 'kane-cli', version, runId, error: 'the call raised before args were written' }, null, 1) + '\n');
  for (const f of ['stdout.ndjson', 'stderr.txt']) if (!existsSync(join(dir, f))) writeFileSync(join(dir, f), f === 'stderr.txt' ? String(spend.error ?? '') : '');
  // ---- immediately after the process: operational record, raw seal, external anchor ----
  const facts = runFacts(out.stdout), cumAfter = cumulativeUsed(readLedger(ledgerFile));
  const outcome = sessionOutcome({ exitCode: out.code, timedOut: out.timedOut, facts, spend, cumulativeUsed: cumAfter });
  const meta = { runId, session: s.session, route: 'real', ...(o.harness ? { testHarness: true } : {}), maxSteps: P7_MAX_STEPS, timeoutS: P7_TIMEOUT_S, killAfterS: P7_KILL_AFTER_S, exitCode: out.code, timedOut: out.timedOut, ms: out.ms, cliVersion: version, runEnd: facts.runEnd, steps: facts.steps, kaneCreditsReported: facts.kaneCreditsReported, kaneDurationS: facts.kaneDurationS, spend, cumulativeUsed: cumAfter, status: outcome.status, stopReasons: outcome.reasons };
  writeFileSync(join(dir, 'meta.json'), JSON.stringify(meta, null, 1) + '\n');
  const seal = sealRaw(dir);
  appendCheckpoint(rec, 'session-end', { runId, session: s.session, rawSeal: seal.files, rawSealSha256: seal.sealSha256, status: outcome.status, exitCode: out.code, timedOut: out.timedOut, runEndPresent: facts.runEnd.present, steps: facts.steps, ms: out.ms, used: spend.used, outcome: spend.outcome, cumulativeUsed: cumAfter });
  writeFileSync(assertWritableOutput(invF), JSON.stringify({ schema: 'gamewatch/gw2-investigators@2', note: 'operator record, operational fields only (D108); outside the agent input boundary', sessions: [...prevInv,
    { session: s.session, profile: 'kane', route: 'real', ...(o.harness ? { testHarness: true } : {}), runId, cli: 'kane-cli', version, argv: kaneArgv(s.port), status: outcome.status, stopReasons: outcome.reasons, exitCode: out.code, timedOut: out.timedOut, ms: out.ms, runEnd: facts.runEnd, steps: facts.steps, kaneCreditsReported: facts.kaneCreditsReported, spend, cumulativeUsed: cumAfter, rawSealSha256: seal.sealSha256, stdoutSha256: sha(out.stdout) }] }, null, 1) + '\n');
  return { session: s.session, status: outcome.status, stop: outcome.stop, reasons: outcome.reasons, spend, exitCode: out.code, timedOut: out.timedOut, rawSealSha256: seal.sealSha256 };
}

/** Refuse anything but the repository's own shim before a process can start. */
export function checkShim(path: string) {
  const abs = resolve(ROOT, path);
  if (relative(ROOT, abs).split('\\').join('/') !== SHIM || !existsSync(abs)) throw new BoundaryRefused(`test-double route needs the repository shim ${SHIM}; got ${path}`);
  return abs;
}

export async function testDoubleRoute(exp: string, profiles: string[], o: { shim?: string; maxSteps?: number; timeoutS?: number } = {}) {
  for (const p of profiles) if (!(PROFILES as readonly string[]).includes(p)) throw new BoundaryRefused(`unknown profile ${p}`);
  const shim = checkShim(o.shim ?? SHIM), site = join(exp, 'partitions/discovery/site');
  if (!existsSync(site)) throw new BoundaryRefused(`no discovery site in ${exp}`);
  const prevCli = process.env.KANE_CLI, prevProfile = process.env.GW2_DOUBLE_PROFILE, out: Record<string, unknown>[] = [];
  process.env.KANE_CLI = shim;
  try {
    for (const profile of profiles) {
      const s = await startGw2Server({ exp: 'p6', out: exp, site, label: 'test-double' });
      const argv = kaneArgv(s.port, { maxSteps: o.maxSteps, timeoutS: o.timeoutS });
      let r: Awaited<ReturnType<typeof runCapture>>;
      try { process.env.GW2_DOUBLE_PROFILE = profile; r = await runCapture(argv, P7_KILL_AFTER_S * 1000); }
      finally { await s.close(); }
      const dir = assertWritableOutput(join(exp, 'kane-runs', s.session));
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, 'args.json'), JSON.stringify({ cli: relative(ROOT, shim).split('\\').join('/'), route: 'test-double', profile, args: argv }, null, 1) + '\n');
      writeFileSync(join(dir, 'stdout.ndjson'), r.stdout); writeFileSync(join(dir, 'stderr.txt'), r.stderr);
      const p = parseKaneOutput(r.stdout, 1, 'objective'), facts = runFacts(r.stdout), outcome = sessionOutcome({ exitCode: r.code, timedOut: r.timedOut, facts });
      out.push({ session: s.session, profile, route: 'test-double', label: 'TEST DOUBLE: measures no agent', cli: relative(ROOT, shim).split('\\').join('/'), argv,
        status: outcome.status, stopReasons: outcome.reasons, exitCode: r.code, timedOut: r.timedOut, ms: r.ms, steps: facts.steps, runEnd: { ...facts.runEnd, verdict: p.verdict, summary: p.reasons[0] ?? null, detail: p.detail }, stdoutSha256: sha(r.stdout) });
    }
  } finally {
    if (prevCli === undefined) delete process.env.KANE_CLI; else process.env.KANE_CLI = prevCli;
    if (prevProfile === undefined) delete process.env.GW2_DOUBLE_PROFILE; else process.env.GW2_DOUBLE_PROFILE = prevProfile;
  }
  const f = assertWritableOutput(join(exp, 'INVESTIGATORS.json'));
  const prev = existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')).sessions as unknown[] : [];
  writeFileSync(f, JSON.stringify({ schema: 'gamewatch/gw2-investigators@1', note: 'operator record: which profile ran in which session; outside the agent input boundary', sessions: [...prev, ...out] }, null, 1) + '\n');
  return out;
}

if (process.argv[1]?.replace(/\\/g, "/").endsWith('gw2/kane-boundary.ts')) {
  const a = process.argv.slice(2), arg = (k: string) => { const i = a.indexOf(k); return i >= 0 ? a[i + 1] : undefined; };
  const expArg = a.find((x, i) => !x.startsWith('--') && !a[i - 1]?.startsWith('--')), route = arg('--route');
  if (!expArg || !['real', 'test-double'].includes(route ?? '')) { console.error('usage: kane-boundary.ts <expDir> --route real|test-double [--profiles a,b] [--shim f]'); process.exit(2); }
  const exp = isAbsolute(expArg) ? expArg : join(process.cwd(), expArg);
  try {
    if (route === 'real') {
      const r = await realRoute(exp, { runId: arg('--run-id'), record: arg('--record') });
      if ('refused' in r) { console.log(`REFUSED before any Kane process: ${r.refused}`); process.exit(2); }
      // operational fields only (D108): no Kane summary, no findings
      console.log(JSON.stringify(r, null, 1)); process.exit(r.stop ? 3 : 0);
    }
    const r = await testDoubleRoute(exp, (arg('--profiles') ?? PROFILES.join(',')).split(',').filter(Boolean), { shim: arg('--shim'), maxSteps: arg('--max-steps') ? Number(arg('--max-steps')) : undefined, timeoutS: arg('--timeout') ? Number(arg('--timeout')) : undefined });
    for (const x of r) console.log(`${x.profile}: session ${x.session} ${x.status} exit ${x.exitCode} ${JSON.stringify(x.runEnd)}`);
    process.exit(r.every(x => x.status === 'completed') ? 0 : 3); // exit 0 alone is not completion: a valid run_end is required (D102)
  } catch (e) { console.error((e as Error).message); process.exit(e instanceof BoundaryRefused ? 2 : 3); }
}
