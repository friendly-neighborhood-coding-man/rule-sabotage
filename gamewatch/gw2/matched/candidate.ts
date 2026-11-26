/**
 * GW2 matched comparison: enabled-candidate execution check (final preflight, item 6). PREPARED; nothing here enables a
 * gate. Two commits are involved, and they are tested separately:
 *   - the REVIEWED commit: both gates closed; the whole regression suite (including every historical "the gate is
 *     disabled" assertion) must pass there, unchanged;
 *   - the CANDIDATE commit: the reviewed commit plus exactly three line changes and nothing else:
 *       server/balance/v4/kanebudget.ts  PAID_RESEARCH_EXECUTION 'disabled' → 'per-run-approval'
 *                                        PAID_RESEARCH_SCOPE  P7 pilot ids → ^GW2-M(0[1-9]|10)-P[12]$
 *       gamewatch/gw2/ext/feedback.ts    AGENT_FEEDBACK_ENABLED false → true
 *     The historical tests are not edited to pass on the candidate; the candidate is checked by candidateProblems()
 *     instead (a line-exact diff against the reviewed commit), and the execution runs only there.
 */
import { execFileSync } from 'node:child_process';
import { ROOT } from '../paths.ts';

export const GATE_FILE = 'server/balance/v4/kanebudget.ts';
export const FEEDBACK_FILE = 'gamewatch/gw2/ext/feedback.ts';
export const EDITS: Record<string, [string, string][]> = {
  [GATE_FILE]: [
    ["export const PAID_RESEARCH_EXECUTION: 'disabled' | 'per-run-approval' = 'disabled';", "export const PAID_RESEARCH_EXECUTION: 'disabled' | 'per-run-approval' = 'per-run-approval';"],
    ['export const PAID_RESEARCH_SCOPE: RegExp | null = /^GW2-P7-pilot-[123]$/;', 'export const PAID_RESEARCH_SCOPE: RegExp | null = /^GW2-M(0[1-9]|10)-P[12]$/;'],
  ],
  [FEEDBACK_FILE]: [['export const AGENT_FEEDBACK_ENABLED = false;', 'export const AGENT_FEEDBACK_ENABLED = true;']],
};
const norm = (t: string) => t.replace(/\r\n/g, '\n');

/** The candidate text a reviewed file must become (throws if the reviewed file is not in the expected disabled state). */
export function candidateText(file: string, reviewed: string): string {
  let t = norm(reviewed);
  for (const [from, to] of EDITS[file] ?? []) {
    const lines = t.split('\n'), i = lines.indexOf(from);
    if (i < 0 || lines.lastIndexOf(from) !== i) throw new Error(`${file}: the reviewed commit does not hold exactly one line "${from}"`);
    lines[i] = to; t = lines.join('\n');
  }
  return t;
}

/** Problems of a candidate against its reviewed commit; [] = the candidate is exactly the reviewed commit + the gate edits. */
export function candidateProblems(changedFiles: string[], read: (rev: 'reviewed' | 'candidate', file: string) => string): string[] {
  const p: string[] = [], want = Object.keys(EDITS).sort(), got = [...changedFiles].sort();
  if (JSON.stringify(got) !== JSON.stringify(want)) p.push(`the candidate must change exactly ${want.join(' and ')} (it changes: ${got.join(', ') || 'nothing'})`);
  for (const f of want) {
    try { if (candidateText(f, read('reviewed', f)) !== norm(read('candidate', f))) p.push(`${f}: the candidate differs from the reviewed commit by more than the gate lines`); }
    catch (e) { p.push((e as Error).message); }
  }
  return p;
}

const git = (args: string[], root: string) => execFileSync('git', args, { cwd: root, encoding: 'utf8' });
/** Check HEAD (the candidate) against a reviewed commit with git. */
export function checkCandidate(reviewed: string, root = ROOT) {
  const p: string[] = [];
  try { git(['merge-base', '--is-ancestor', reviewed, 'HEAD'], root); } catch { p.push(`the reviewed commit ${reviewed} is not an ancestor of HEAD`); }
  const changed = git(['diff', '--name-only', reviewed, 'HEAD'], root).split('\n').map(x => x.trim()).filter(Boolean);
  p.push(...candidateProblems(changed, (rev, f) => rev === 'reviewed' ? git(['show', `${reviewed}:${f}`], root) : git(['show', `HEAD:${f}`], root)));
  return { head: git(['rev-parse', 'HEAD'], root).trim(), reviewed, changed, problems: p, ok: !p.length };
}
