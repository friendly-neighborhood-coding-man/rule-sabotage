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
import { writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { join, resolve, relative, isAbsolute } from 'node:path';
import { createHash } from 'node:crypto';
import { ROOT, assertWritableOutput } from './paths.ts';
import { startGw2Server } from './serve.ts';
import { kaneArgv, P7_KILL_AFTER_S, P7_MAX_STEPS, P7_TIMEOUT_S, P7_EXPECTED_CLI_VERSION } from './p7-plan.ts';
import { strictVersion, strictBalance } from '../../scripts/kane-single-call.ts';
import { runCapture, parseKaneOutput } from '../../server/kane.ts';
import { runPaidCall, PaidCallRefused, PAID_RESEARCH_EXECUTION, type Deps, type PaidApproval } from '../../server/balance/v4/kanebudget.ts';

export const PROFILES = ['accurate', 'careless', 'over-abstaining', 'confident-wrong', 'defect-describer'] as const;
export const SHIM = 'gamewatch/gw2/doubles/kane-shim.mjs';
export class BoundaryRefused extends Error {}
const sha = (s: string) => createHash('sha256').update(s).digest('hex');

/**
 * The real route (prepared for P7, D99): ONE paid objective-mode call per invocation, decided by the unchanged gate.
 * Order: (1) while PAID_RESEARCH_EXECUTION is 'disabled' the gate refuses before a server or any process exists;
 * (2) otherwise the review server is started and runPaidCall re-checks everything (approval file
 * <exp>/approvals/<runId>.json, KANE_PAID_RUN_AUTH = runId, real CLI version, balance, ceiling) before the one call.
 * Raw args, stdout and stderr are stored under <exp>/kane-runs/<session>/ for import with Kane provenance.
 */
export async function realRoute(exp: string, o: { runId?: string } = {}): Promise<{ refused: string } | { session: string; spend: unknown; exitCode: number | null; timedOut: boolean }> {
  const ledgerFile = join(exp, 'kane-ledger.ndjson');
  let started = false;
  const refusedEarly: Deps = { ledgerFile, env: process.env, isRealCli: async () => { started = true; return false; }, balance: async () => { started = true; return null; }, exec: async () => { started = true; throw new Error('unreachable'); } };
  if (PAID_RESEARCH_EXECUTION === 'disabled') {
    try { await runPaidCall(null, { maxSteps: P7_MAX_STEPS, timeoutS: P7_TIMEOUT_S }, refusedEarly); }
    catch (e) { if (e instanceof PaidCallRefused) { if (started) throw new Error('the gate consulted the CLI before refusing'); return { refused: e.reason }; } throw e; }
    throw new Error('the paid-call gate did not refuse while disabled; stopping');
  }
  // ---- reachable only after the operator has explicitly changed the gate (not in P6) ----
  const runId = o.runId ?? '';
  const approvalF = join(exp, 'approvals', `${runId}.json`);
  const approval = runId && existsSync(approvalF) ? JSON.parse(readFileSync(approvalF, 'utf8')) as PaidApproval : null;
  const s = await startGw2Server({ exp: 'p7', out: exp, site: join(exp, 'partitions/discovery/site'), label: 'kane' });
  const dir = assertWritableOutput(join(exp, 'kane-runs', s.session)); mkdirSync(dir, { recursive: true });
  let version: string | null = null;
  const out = { stdout: '', stderr: '', code: null as number | null, timedOut: false, ms: 0 };
  const deps: Deps = {
    ledgerFile, env: process.env,
    isRealCli: async () => { const r = await runCapture(['--version'], 60_000); version = r.code === 0 ? strictVersion(r.stdout) : null; return version === P7_EXPECTED_CLI_VERSION; },
    balance: async () => { const r = await runCapture(['balance'], 60_000); return r.code === 0 ? strictBalance(r.stdout, version) : null; },
    exec: async () => {
      const args = kaneArgv(s.port);
      writeFileSync(join(dir, 'args.json'), JSON.stringify({ cli: process.env.KANE_CLI || 'kane-cli', version, args, runId, startedAt: new Date().toISOString() }, null, 1) + '\n');
      const r = await runCapture(args, P7_KILL_AFTER_S * 1000);
      Object.assign(out, { stdout: r.stdout, stderr: r.stderr, code: r.code, timedOut: r.timedOut, ms: r.ms });
      writeFileSync(join(dir, 'stdout.ndjson'), r.stdout); writeFileSync(join(dir, 'stderr.txt'), r.stderr);
      return { timedOut: r.timedOut, exitCode: r.code };
    },
  };
  try {
    const spend = await runPaidCall(approval, { maxSteps: P7_MAX_STEPS, timeoutS: P7_TIMEOUT_S }, deps);
    const p = parseKaneOutput(out.stdout, 1, 'objective'), f = assertWritableOutput(join(exp, 'INVESTIGATORS.json'));
    const prev = existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')).sessions as unknown[] : [];
    writeFileSync(f, JSON.stringify({ schema: 'gamewatch/gw2-investigators@1', note: 'operator record: which investigator ran in which session; outside the agent input boundary', sessions: [...prev,
      { session: s.session, profile: 'kane', route: 'real', runId, cli: process.env.KANE_CLI || 'kane-cli', version, argv: kaneArgv(s.port), exitCode: out.code, timedOut: out.timedOut, ms: out.ms, spend, runEnd: { verdict: p.verdict, summary: p.reasons[0] ?? null, detail: p.detail }, stdoutSha256: sha(out.stdout) }] }, null, 1) + '\n');
    return { session: s.session, spend, exitCode: out.code, timedOut: out.timedOut };
  } catch (e) { if (e instanceof PaidCallRefused) return { refused: e.reason }; throw e; }
  finally { await s.close(); }
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
      const p = parseKaneOutput(r.stdout, 1, 'objective');
      out.push({ session: s.session, profile, route: 'test-double', label: 'TEST DOUBLE: measures no agent', cli: relative(ROOT, shim).split('\\').join('/'), argv,
        exitCode: r.code, timedOut: r.timedOut, ms: r.ms, runEnd: { verdict: p.verdict, summary: p.reasons[0] ?? null, detail: p.detail }, stdoutSha256: sha(r.stdout) });
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

if (process.argv[1]?.endsWith('gw2/kane-boundary.ts')) {
  const a = process.argv.slice(2), arg = (k: string) => { const i = a.indexOf(k); return i >= 0 ? a[i + 1] : undefined; };
  const expArg = a.find((x, i) => !x.startsWith('--') && !a[i - 1]?.startsWith('--')), route = arg('--route');
  if (!expArg || !['real', 'test-double'].includes(route ?? '')) { console.error('usage: kane-boundary.ts <expDir> --route real|test-double [--profiles a,b] [--shim f]'); process.exit(2); }
  const exp = isAbsolute(expArg) ? expArg : join(process.cwd(), expArg);
  try {
    if (route === 'real') {
      const r = await realRoute(exp, { runId: arg('--run-id') });
      if ('refused' in r) { console.log(`REFUSED by the paid-call gate: ${r.refused}`); process.exit(2); }
      console.log(JSON.stringify(r, null, 1)); process.exit(!r.timedOut && r.exitCode === 0 ? 0 : 3);
    }
    const r = await testDoubleRoute(exp, (arg('--profiles') ?? PROFILES.join(',')).split(',').filter(Boolean), { shim: arg('--shim'), maxSteps: arg('--max-steps') ? Number(arg('--max-steps')) : undefined, timeoutS: arg('--timeout') ? Number(arg('--timeout')) : undefined });
    for (const x of r) console.log(`${x.profile}: session ${x.session} exit ${x.exitCode} ${JSON.stringify(x.runEnd)}`);
    process.exit(r.every(x => x.exitCode === 0 && !x.timedOut) ? 0 : 3);
  } catch (e) { console.error((e as Error).message); process.exit(e instanceof BoundaryRefused ? 2 : 3); }
}
