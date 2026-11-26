/**
 * GW2 matched comparison: operator CLI (D145, final preflight). Every paid step is refused while the paid-call gate is
 * 'disabled'. Run from the repository root; N = node --experimental-strip-types --no-warnings gamewatch/gw2/matched/cli.ts
 *
 *   N plan                                                   the machine-readable plan (no file written)
 *   N preregister --record R --reviewed SHA [--commit SHA]   write the pre-registration once, binding HEAD and SHA
 *   N next        --record R --run D                         the next call; integrity re-checked; starts nothing
 *   N verify      --record R --run D                         pre-registration + integrity of everything so far
 *   N ops-status  --record R                                 OPERATIONAL fields only (no submission content)
 *   N candidate-check --reviewed SHA                         HEAD = reviewed commit + exactly the gate lines
 *   N run         --record R --run D                         ONE Kane call (runtime feedback), resumable
 *   N evaluate    --record R --run D                         the single held-out opening
 * The experiment evidence is always MATCHED.evidence (matched-evidence-2). The non-paid dry run is a separate entry
 * point (matched/dry-run.ts, generation 1 only) so that this CLI never imports a test double or the test-only builder. Each
 * treatment feedback authorization is read from <run>/authorizations/<runId>.json (written by the operator).
 */
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from '../paths.ts';
import { recordDir, readExecLedger } from '../p7-exec.ts';
import { MATCHED } from './params.ts';
import { matchedPlan, preregisterMatched, verifyMatchedPrereg } from './prereg.ts';
import { runMatched, nextCall, cumulative } from './pipeline.ts';
import { kaneRunner } from './kane-runner.ts';
import { evaluateMatched } from './evaluate.ts';
import { executionProblems } from './integrity.ts';
import { checkCandidate } from './candidate.ts';

const arg = (k: string) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : undefined; };
const need = (k: string) => { const v = arg(k); if (!v) throw new Error(`${k} is required`); return v; };
const evidence = join(ROOT, MATCHED.evidence);
const out = (x: unknown) => console.log(JSON.stringify(x, null, 1));

export function opsStatus(rec: string) {
  const L = readExecLedger(rec).entries as any[];
  return { ledgerOk: readExecLedger(rec).ok, cumulativeResearchCredits: cumulative(rec), stopped: L.filter(e => e.event === 'experiment-stopped').map(e => e.data),
    refused: L.filter(e => e.event === 'call-refused').map(e => e.data), failed: L.filter(e => e.event === 'call-failed').map(e => ({ runId: e.data.runId, stage: e.data.stage, error: e.data.error })),
    calls: L.filter(e => e.event === 'call-end').map(e => ({ runId: e.data.runId, session: e.data.session, arm: e.data.arm, phase: e.data.phase, exitCode: e.data.exitCode, timedOut: e.data.timedOut,
      runEndPresent: e.data.runEndPresent, runEndValid: e.data.runEndValid, steps: e.data.steps, used: e.data.used, outcome: e.data.outcome, complete: e.data.complete,
      frozen: L.some(f => f.event === `freeze-${e.data.phase}` && f.data.session === e.data.session) })) };
}

if (process.argv[1]?.replace(/\\/g, '/').endsWith('gw2/matched/cli.ts')) {
  const cmd = process.argv[2];
  try {
    if (cmd === 'plan') out(matchedPlan(evidence, { reviewedCommit: arg('--reviewed') ?? null }));
    else if (cmd === 'preregister') out(preregisterMatched(evidence, recordDir(arg('--record')), { reviewedCommit: need('--reviewed'), expectCommit: arg('--commit') }));
    else if (cmd === 'next') { const n = nextCall(recordDir(arg('--run')), recordDir(arg('--record'))); out(n ? { runId: n.runId, session: n.slot.session, arm: n.slot.arm, phase: n.phase, maxSteps: MATCHED.phases[n.phase].maxSteps, ceilingCredits: MATCHED.phases[n.phase].ceilingCredits } : { next: null, note: 'every scheduled call has started; run evaluate' }); }
    else if (cmd === 'verify') {
      const rec = recordDir(arg('--record')), run = recordDir(arg('--run')), pre = verifyMatchedPrereg(evidence, rec), p = executionProblems(run, rec);
      out({ preregSha256: pre.preregSha256, commit: pre.prereg.commit, integrityProblems: p }); if (p.length) process.exit(4);
    } else if (cmd === 'ops-status') out(opsStatus(recordDir(arg('--record'))));
    else if (cmd === 'candidate-check') { const r = checkCandidate(need('--reviewed')); out(r); if (!r.ok) process.exit(4); }
    else if (cmd === 'run') {
      const rec = recordDir(arg('--record')), run = recordDir(arg('--run'));
      const authorizationFor = (s: { runs: Record<number, string> }) => { const f = join(run, 'authorizations', `${s.runs[2]}.json`); if (!existsSync(f)) throw new Error(`no authorization ${f}`); return JSON.parse(readFileSync(f, 'utf8')); };
      out(await runMatched({ evidence, run, rec, runner: kaneRunner(run), feedback: { kind: 'runtime', authorizationFor }, maxCalls: 1 }));
    } else if (cmd === 'evaluate') out(evaluateMatched(evidence, recordDir(arg('--run')), recordDir(arg('--record'))).blocks);
    else { console.error('usage: cli.ts plan | preregister | next | verify | ops-status | candidate-check | run | evaluate (see the header)'); process.exit(2); }
  } catch (e) { console.error((e as Error).message); process.exit(3); }
}
