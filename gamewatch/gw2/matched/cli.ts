/**
 * GW2 matched comparison: operator CLI (D145). Every paid step is refused while the paid-call gate is 'disabled'.
 *
 *   node --experimental-strip-types --no-warnings gamewatch/gw2/matched/cli.ts plan
 *   ... cli.ts preregister --record <dir outside the repository>
 *   ... cli.ts next        --record <dir>                                          (which call is next; starts nothing)
 *   ... cli.ts run         --record <dir> --run <dir outside the repository>      (ONE call per invocation: Kane runner,
 *                                                                                   runtime feedback; resumable from the ledger)
 *   ... cli.ts evaluate    --record <dir> --run <dir>                              (single held-out opening)
 * The evidence is always MATCHED.evidence (matched-evidence-2). The authorization for each treatment feedback is read
 * from <run>/authorizations/<runId>.json (written by the operator; never by this tool).
 */
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from '../paths.ts';
import { recordDir } from '../p7-exec.ts';
import { MATCHED } from './params.ts';
import { matchedPlan, preregisterMatched } from './prereg.ts';
import { runMatched, nextCall } from './pipeline.ts';
import { kaneRunner } from './kane-runner.ts';
import { evaluateMatched } from './evaluate.ts';

const arg = (k: string) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : undefined; };
const evidence = join(ROOT, MATCHED.evidence);

if (process.argv[1]?.replace(/\\/g, '/').endsWith('gw2/matched/cli.ts')) {
  const cmd = process.argv[2];
  try {
    if (cmd === 'plan') console.log(JSON.stringify(matchedPlan(evidence), null, 1));
    else if (cmd === 'preregister') console.log(JSON.stringify(preregisterMatched(evidence, recordDir(arg('--record')))));
    else if (cmd === 'next') { const n = nextCall(recordDir(arg('--record'))); console.log(JSON.stringify(n ? { runId: n.runId, session: n.slot.session, arm: n.slot.arm, phase: n.phase } : { next: null, note: 'every scheduled call has started; run evaluate' })); }
    else if (cmd === 'run') {
      const rec = recordDir(arg('--record')), run = recordDir(arg('--run'));
      const authorizationFor = (s: { runs: Record<number, string> }) => { const f = join(run, 'authorizations', `${s.runs[2]}.json`); if (!existsSync(f)) throw new Error(`no authorization ${f}`); return JSON.parse(readFileSync(f, 'utf8')); };
      const r = await runMatched({ evidence, run, rec, runner: kaneRunner(run), feedback: { kind: 'runtime', authorizationFor }, maxCalls: 1 });
      console.log(JSON.stringify(r, null, 1));
    } else if (cmd === 'evaluate') console.log(JSON.stringify(evaluateMatched(evidence, recordDir(arg('--run')), recordDir(arg('--record'))).blocks, null, 1));
    else { console.error('usage: cli.ts plan | preregister --record <dir> | next --record <dir> | run --record <dir> --run <dir> | evaluate --record <dir> --run <dir>'); process.exit(2); }
  } catch (e) { console.error((e as Error).message); process.exit(3); }
}
