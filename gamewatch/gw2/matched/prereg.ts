/**
 * GW2 matched comparison: the machine-readable pre-registration (D142). Written once into an operator-controlled
 * external record (outside the repository for a real run) and anchored as the first ledger entry. It binds:
 *   - the parameters (params.ts) and the balanced-block schedule (schedule.ts);
 *   - plan.agentFeedback.runs: exactly the phase-2 runs of treatment sessions, {runId, session, arm, phase};
 *   - plan.evidence.manifests: the sha256 of every partition MANIFEST.json of the fresh evidence;
 *   - files: sha256 of the procedures, the human-readable pre-registration and procedure, the spec encoding, package.json
 *     and the COMPLETE execution dependency set: every module reachable by static import from matched/cli.ts
 *     (dependencySet(), computed, not listed by hand), including the gate, the server, the runner and the CLI probes;
 *   - commit: the exact commit the operator runs (git HEAD at pre-registration) and the reviewed disabled-gate commit it
 *     derives from (operator-supplied; final preflight, item 3).
 * verifyMatchedPrereg re-checks all of it before every call and before the single held-out opening, including that HEAD
 * is still the bound commit.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { ROOT } from '../paths.ts';
import { readExecLedger, appendCheckpoint } from '../p7-exec.ts';
import { anchoredPrereg } from '../ext/anchored.ts';
import { AccessRefused } from '../ext/errors.ts';
import { MATCHED } from './params.ts';
import { schedule, feedbackRuns } from './schedule.ts';

export const MATCHED_PREREG_SCHEMA = 'gamewatch/gw2-matched-preregistration@1';
export const PARTITIONS = ['discovery', 'heldout', 'spec', 'eval'] as const;
/** Non-code files bound in addition to the computed dependency set. */
export const MATCHED_DOCS = [
  'docs/gw2/MATCHED_PREREGISTRATION_DRAFT.md', 'docs/gw2/MATCHED_EXECUTION_PROCEDURE.md',
  'evidence/gw2/procedures/generation-matched-2.json', 'evidence/gw2/procedures/partition-matched-2.json',
  MATCHED.encoding, 'package.json',
] as const;
export const ENTRY = 'gamewatch/gw2/matched/cli.ts';

/** Every repository file reachable from the CLI by static relative import (.ts/.mjs/.js), sorted. */
export function dependencySet(root = ROOT, entry = ENTRY): string[] {
  const seen = new Set<string>(), todo = [entry];
  while (todo.length) {
    const f = todo.pop()!; if (seen.has(f)) continue;
    if (!/\.(ts|mjs|js)$/.test(f)) throw new Error(`unsupported import target ${f}`);
    seen.add(f);
    const src = readFileSync(join(root, f), 'utf8');
    const specs = [...src.matchAll(/(?:^|\n)\s*(?:import|export)\b[^;'"]*?\bfrom\s*['"](\.{1,2}\/[^'"]+)['"]/g), ...src.matchAll(/(?:^|\n)\s*import\s*['"](\.{1,2}\/[^'"]+)['"]/g), ...src.matchAll(/\bimport\(\s*['"](\.{1,2}\/[^'"]+)['"]\s*\)/g)];
    for (const m of specs) {
      const dep = relative(root, join(root, dirname(f), m[1])).replace(/\\/g, '/');
      if (!existsSync(join(root, dep))) throw new Error(`${f} imports ${m[1]}, which does not exist`);
      todo.push(dep);
    }
  }
  return [...seen].sort();
}
export const headCommit = (root = ROOT): string | null => { try { return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(); } catch { return null; } };

/** @deprecated kept for reference: the hand-written list before the final preflight (now a subset of dependencySet()). */
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

export const boundFiles = (root = ROOT) => [...new Set([...MATCHED_DOCS, ...dependencySet(root)])].sort();

export function matchedPlan(evidence: string, o: { root?: string; reviewedCommit?: string | null } = {}) {
  const root = o.root ?? ROOT;
  return {
    plan: { id: MATCHED.id, params: MATCHED, schedule: schedule(), agentFeedback: { runs: feedbackRuns(), cap: MATCHED.feedback.cap, evidence: MATCHED.feedback.evidence },
      evidence: { dir: evidence.startsWith(root) ? evidence.slice(root.length + 1).replace(/\\/g, '/') : evidence, manifests: manifestsOf(evidence) } },
    files: Object.fromEntries(boundFiles(root).map(f => { if (!existsSync(join(root, f))) throw new Error(`bound file ${f} is missing`); return [f, lfSha(join(root, f))]; })),
    commit: { head: headCommit(root), reviewed: o.reviewedCommit ?? null },
  };
}

export function preregisterMatched(evidence: string, rec: string, o: { at?: string; root?: string; reviewedCommit?: string; expectCommit?: string } = {}) {
  if (readExecLedger(rec).entries.length) throw new AccessRefused('the external record already has a ledger: a pre-registration is written once, first');
  const { plan, files, commit } = matchedPlan(evidence, o), at = o.at ?? new Date().toISOString();
  if (o.expectCommit && commit.head !== o.expectCommit) throw new AccessRefused(`HEAD is ${commit.head}, expected ${o.expectCommit}`);
  mkdirSync(rec, { recursive: true });
  writeFileSync(join(rec, 'PREREGISTRATION.json'), JSON.stringify({ schema: MATCHED_PREREG_SCHEMA, at, plan, files, commit, status: 'frozen before the first call' }, null, 1) + '\n', { flag: 'wx' });
  const preregSha256 = fsha(join(rec, 'PREREGISTRATION.json'));
  appendCheckpoint(rec, 'preregistered', { preregSha256, files, commit }, at);
  return { preregSha256, commit };
}

/** Before every call and before the held-out opening: anchored pre-registration, unchanged manifests, files and schedule. */
export function verifyMatchedPrereg(evidence: string, rec: string, o: { root?: string } = {}) {
  const { prereg, preregSha256 } = anchoredPrereg(rec), problems: string[] = [], root = o.root ?? ROOT;
  if (prereg.schema !== MATCHED_PREREG_SCHEMA) problems.push(`not a matched-comparison pre-registration (${prereg.schema})`);
  const now = manifestsOf(evidence);
  for (const p of PARTITIONS) if (prereg.plan?.evidence?.manifests?.[p] !== now[p]) problems.push(`${p}/MANIFEST.json is not the manifest bound by the pre-registration`);
  for (const [f, h] of Object.entries(prereg.files ?? {})) if (!existsSync(join(root, f)) || lfSha(join(root, f)) !== h) problems.push(`${f} changed since the pre-registration`);
  if (JSON.stringify(prereg.plan?.schedule) !== JSON.stringify(schedule())) problems.push('the schedule differs from the pre-registered one');
  const deps = dependencySet(root).filter(f => !(f in (prereg.files ?? {})));
  if (deps.length) problems.push(`execution dependencies not bound by the pre-registration: ${deps.join(', ')}`);
  if (prereg.commit?.head) { const h = headCommit(root); if (h !== prereg.commit.head) problems.push(`HEAD is ${h}, the pre-registration binds ${prereg.commit.head}`); }
  else problems.push('the pre-registration binds no commit');
  if (problems.length) throw new AccessRefused(`pre-registration check failed: ${problems.join('; ')}`);
  return { prereg, preregSha256, manifests: now };
}
