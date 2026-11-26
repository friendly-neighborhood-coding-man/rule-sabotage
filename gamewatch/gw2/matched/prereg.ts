/**
 * GW2 matched comparison: the machine-readable pre-registration (D142). Written once into an operator-controlled
 * external record (outside the repository for a real run) and anchored as the first ledger entry. It binds:
 *   - the parameters (params.ts) and the balanced-block schedule (schedule.ts);
 *   - plan.agentFeedback.runs: exactly the phase-2 runs of treatment sessions, {runId, session, arm, phase};
 *   - plan.evidence.manifests: the sha256 of every partition MANIFEST.json of the fresh evidence;
 *   - files: sha256 of the procedures, the code of the comparison and the human-readable pre-registration.
 * verifyMatchedPrereg re-checks all of it before every call and before the single held-out opening.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { ROOT } from '../paths.ts';
import { readExecLedger, appendCheckpoint } from '../p7-exec.ts';
import { anchoredPrereg } from '../ext/anchored.ts';
import { AccessRefused } from '../ext/errors.ts';
import { MATCHED } from './params.ts';
import { schedule, feedbackRuns } from './schedule.ts';

export const MATCHED_PREREG_SCHEMA = 'gamewatch/gw2-matched-preregistration@1';
export const PARTITIONS = ['discovery', 'heldout', 'spec', 'eval'] as const;
export const MATCHED_FILES = [
  'docs/gw2/MATCHED_PREREGISTRATION_DRAFT.md', 'docs/gw2/MATCHED_EXECUTION_PROCEDURE.md',
  'evidence/gw2/procedures/generation-matched-2.json', 'evidence/gw2/procedures/partition-matched-2.json',
  'gamewatch/gw2/matched/params.ts', 'gamewatch/gw2/matched/schedule.ts', 'gamewatch/gw2/matched/prereg.ts', 'gamewatch/gw2/matched/sessions.ts',
  'gamewatch/gw2/matched/feedback.ts', 'gamewatch/gw2/matched/revision-page.ts', 'gamewatch/gw2/matched/pipeline.ts', 'gamewatch/gw2/matched/evaluate.ts', 'gamewatch/gw2/matched/kane-runner.ts', 'gamewatch/gw2/matched/cli.ts',
  'gamewatch/gw2/ext/feedback-core.ts', 'gamewatch/gw2/ext/feedback.ts', 'gamewatch/gw2/ext/anchored.ts', 'gamewatch/gw2/ext/inputs.ts', 'gamewatch/gw2/ext/contradictions.ts',
  'gamewatch/gw2/ext/comparison-plan.ts', 'gamewatch/gw2/ext/serving-guard.ts', 'gamewatch/gw2/serve.ts', 'gamewatch/gw2/blind-site.ts', 'server/balance/v4/kanebudget.ts',
] as const;
const lfSha = (f: string) => createHash('sha256').update(readFileSync(f, 'utf8').replace(/\r\n/g, '\n')).digest('hex');
const fsha = (f: string) => createHash('sha256').update(readFileSync(f)).digest('hex');

export const manifestsOf = (evidence: string) => Object.fromEntries(PARTITIONS.map(p => [p, fsha(join(evidence, 'partitions', p, 'MANIFEST.json'))])) as Record<typeof PARTITIONS[number], string>;

export function matchedPlan(evidence: string, o: { root?: string } = {}) {
  const root = o.root ?? ROOT;
  return {
    plan: { id: MATCHED.id, params: MATCHED, schedule: schedule(), agentFeedback: { runs: feedbackRuns(), cap: MATCHED.feedback.cap, evidence: MATCHED.feedback.evidence },
      evidence: { dir: evidence.startsWith(root) ? evidence.slice(root.length + 1).replace(/\\/g, '/') : evidence, manifests: manifestsOf(evidence) } },
    files: Object.fromEntries(MATCHED_FILES.filter(f => existsSync(join(root, f))).map(f => [f, lfSha(join(root, f))])),
  };
}

export function preregisterMatched(evidence: string, rec: string, o: { at?: string; root?: string } = {}) {
  if (readExecLedger(rec).entries.length) throw new AccessRefused('the external record already has a ledger: a pre-registration is written once, first');
  const { plan, files } = matchedPlan(evidence, o), at = o.at ?? new Date().toISOString();
  mkdirSync(rec, { recursive: true });
  writeFileSync(join(rec, 'PREREGISTRATION.json'), JSON.stringify({ schema: MATCHED_PREREG_SCHEMA, at, plan, files, status: 'frozen before the first call' }, null, 1) + '\n', { flag: 'wx' });
  const preregSha256 = fsha(join(rec, 'PREREGISTRATION.json'));
  appendCheckpoint(rec, 'preregistered', { preregSha256, files }, at);
  return { preregSha256 };
}

/** Before every call and before the held-out opening: anchored pre-registration, unchanged manifests, files and schedule. */
export function verifyMatchedPrereg(evidence: string, rec: string, o: { root?: string } = {}) {
  const { prereg, preregSha256 } = anchoredPrereg(rec), problems: string[] = [], root = o.root ?? ROOT;
  if (prereg.schema !== MATCHED_PREREG_SCHEMA) problems.push(`not a matched-comparison pre-registration (${prereg.schema})`);
  const now = manifestsOf(evidence);
  for (const p of PARTITIONS) if (prereg.plan?.evidence?.manifests?.[p] !== now[p]) problems.push(`${p}/MANIFEST.json is not the manifest bound by the pre-registration`);
  for (const [f, h] of Object.entries(prereg.files ?? {})) if (!existsSync(join(root, f)) || lfSha(join(root, f)) !== h) problems.push(`${f} changed since the pre-registration`);
  if (JSON.stringify(prereg.plan?.schedule) !== JSON.stringify(schedule())) problems.push('the schedule differs from the pre-registered one');
  if (problems.length) throw new AccessRefused(`pre-registration check failed: ${problems.join('; ')}`);
  return { prereg, preregSha256, manifests: now };
}
