/**
 * GW2 matched comparison: complete NON-PAID dry run (final preflight, item 6). Generation 1 (the development dataset)
 * only; never the experiment evidence. All 20 calls by test doubles that drive the real review server over HTTP,
 * treatment feedback from the test-only builder, every integrity check, then the single evaluation of that dry-run
 * record. No Kane process, no paid call, no inference, and neither gate is touched.
 *
 *   node --experimental-strip-types --no-warnings gamewatch/gw2/matched/dry-run.ts --record <dir> --run <dir> [--reviewed SHA]
 * Both directories are outside the repository and new (an existing record is refused, so nothing is overwritten).
 */
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { ROOT } from '../paths.ts';
import { recordDir, readExecLedger } from '../p7-exec.ts';
import { MATCHED } from './params.ts';
import { preregisterMatched, verifyMatchedPrereg } from './prereg.ts';
import { runMatched } from './pipeline.ts';
import { evaluateMatched } from './evaluate.ts';
import { executionProblems } from './integrity.ts';
import { doubleRunner, DRY_RUN_PROFILES } from './doubles.ts';
import { sessionFeedbackForTest } from './feedback-testonly.ts';
import { opsStatus } from './cli.ts';

export async function dryRun(rec: string, run: string, o: { reviewed?: string; at?: () => string } = {}) {
  const dev = join(ROOT, MATCHED.devEvidence);
  if (readExecLedger(rec).entries.length || existsSync(join(run, 'sessions'))) throw new Error('a dry run needs a new record and a new run directory (nothing is overwritten)');
  preregisterMatched(dev, rec, { reviewedCommit: o.reviewed ?? 'dry-run (no reviewed commit)' });
  const { prereg } = verifyMatchedPrereg(dev, rec);
  if (prereg.plan.evidence.dir !== MATCHED.devEvidence) throw new Error('a dry run uses generation 1 (the development dataset) only');
  const { runner } = doubleRunner(s => DRY_RUN_PROFILES[s]);
  const r = await runMatched({ evidence: dev, run, rec, runner, feedback: { kind: 'test-only', build: sessionFeedbackForTest }, at: o.at });
  const integrity = executionProblems(run, rec);
  const ev = evaluateMatched(dev, run, rec);
  return { evidence: MATCHED.devEvidence, profiles: DRY_RUN_PROFILES, calls: r.sessions.flatMap(x => x.phases).length, stopped: r.stopped, integrityProblems: integrity, ops: opsStatus(rec),
    evaluation: { sessions: ev.sessions.map(x => ({ session: x.session, arm: x.arm, block: x.block, complete: x.complete, heldout: x.heldout, revision: x.revision, discoveryFit: { initial: x.discoveryFit.initial.accuracy, final: x.discoveryFit.final?.accuracy ?? null },
      actions: x.actions, effects: x.revisionEffects, attribution: x.targets.attribution, targets: x.targets.heldout, cReadings: (x as any).cReadings?.final?.accurateDescriptionsOfADefect, counterexamples: x.counterexamples.final })), arms: ev.arms, blocks: ev.blocks } };
}

if (process.argv[1]?.replace(/\\/g, '/').endsWith('gw2/matched/dry-run.ts')) {
  const arg = (k: string) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : undefined; };
  try { console.log(JSON.stringify(await dryRun(recordDir(arg('--record')), recordDir(arg('--run')), { reviewed: arg('--reviewed') }), null, 1)); }
  catch (e) { console.error((e as Error).message); process.exit(3); }
}
