/**
 * GW2 matched comparison: the phase-2 site of one session (D139). Both arms get the SAME shell:
 *   - the discovery site, unchanged, except hypothesis.html gains one field "revises" (the H-number of an earlier
 *     hypothesis of this session);
 *   - revision.html: the session's own COMPLETE frozen phase-1 submissions (final preflight, item 4): for every form the
 *     H-number, kind, verbatim statement, confidence, cited evidence, the full submitted structured representation text
 *     and its availability (checkable / not parseable / not representable / none), and for abstentions their scope;
 *     then a feedback section, then how to keep, revise or withdraw. A separate Kane call is not assumed to remember
 *     the first one, so nothing the session submitted is left out.
 * Control: the feedback section reads "No observation list is provided in this session." Treatment: the capped H↔O
 * feedback (ext/feedback-core.ts renderFeedbackSection, which re-checks the cap). No spec, held-out or eval content.
 */
import { cpSync, readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { createHash } from 'node:crypto';
import { renderFeedbackSection, type AgentFeedback } from '../ext/feedback-core.ts';
import { esc } from '../ext/html.ts';
import { checkRepresentation } from '../hypothesis.ts';
import type { Frozen } from './sessions.ts';
import type { Arm } from './params.ts';

export const NO_FEEDBACK = 'No observation list is provided in this session.';
export const REVISES_FIELD = '<p><label>Revises (the H-number of your earlier hypothesis, if this form revises or withdraws it) <input name="revises"></label></p>';

/** Availability of the structured representation of one frozen submission, as the verifier sees it. */
export function availability(frozen: Frozen, id: string): { label: string; clauses: number } {
  const reps = frozen.nodes.filter(n => n.kind === 'representation' && n.parents[0]?.id === id);
  if (!reps.length) return { label: 'none submitted (not machine-checkable)', clauses: 0 };
  const b = reps[0].body as any;
  if (b.parseError) return { label: `submitted, not parseable as JSON (${b.parseError})`, clauses: 0 };
  const chk = checkRepresentation(b.representation), ok = chk.clauses.filter(c => c.ok).length;
  if (chk.status === 'not-representable' || !ok) return { label: `submitted, not checkable (${(chk.problems ?? []).slice(0, 3).join('; ') || 'no valid clause'})`, clauses: 0 };
  return { label: `submitted, checkable (${ok} of ${chk.clauses.length} clause${chk.clauses.length === 1 ? '' : 's'} valid)`, clauses: ok };
}

export function revisionPage(frozen: Frozen, arm: Arm, feedback: AgentFeedback | null): string {
  if ((arm === 'treatment') !== (feedback !== null)) throw new Error(`arm ${arm} ${feedback ? 'must not' : 'must'} receive feedback`);
  const byId = new Map(frozen.nodes.map(n => [n.id, n]));
  const forms = frozen.submissions.map(s => { const b = byId.get(s.id)!.body as any, abst = s.kind === 'abstention', a = availability(frozen, s.id);
    return `<section class="form" id="${esc(s.ref)}"><h3>${esc(s.ref)}: ${abst ? 'abstention' : 'hypothesis'}</h3><dl>`
      + `<dt>Statement</dt><dd>${esc(b.statement) || '<em>(empty)</em>'}</dd>`
      + (abst ? `<dt>Abstention scope</dt><dd>${esc(b.abstainScope) || '<em>(none given)</em>'}</dd>` : '')
      + `<dt>Confidence</dt><dd>${esc(b.confidence ?? '') || '<em>(none given)</em>'}</dd>`
      + `<dt>Evidence cited</dt><dd>${esc(b.evidence ?? '') || '<em>(none given)</em>'}</dd>`
      + (abst ? '' : `<dt>Structured representation</dt><dd>${esc(a.label)}</dd>`
        + (typeof b.submittedRepresentation === 'string' ? `<dt>Submitted representation (verbatim)</dt><dd><pre>${esc(b.submittedRepresentation)}</pre></dd>` : ''))
      + `</dl></section>`; }).join('');
  const nH = frozen.submissions.filter(s => s.kind !== 'abstention').length, nA = frozen.submissions.length - nH, nR = frozen.submissions.filter(s => s.kind !== 'abstention' && availability(frozen, s.id).clauses > 0).length;
  return `<!doctype html><meta charset="utf-8"><title>Revision</title><h1>Revision</h1>`
    + `<p>This is a new, separate call. Below is every form submitted in the earlier call of this investigation, in full. They are kept whatever you do now.</p>`
    + `<p>Earlier call: ${nH} hypothes${nH === 1 ? 'is' : 'es'} (${nR} with a checkable structured representation) and ${nA} abstention${nA === 1 ? '' : 's'}.</p>`
    + (forms || '<p>No forms were submitted in the earlier call.</p>')
    + `<h2>Observations that differ from the structured hypotheses</h2>${feedback ? renderFeedbackSection(feedback) : `<p>${NO_FEEDBACK}</p>`}`
    + `<h2>What you can do</h2><p>To keep a hypothesis, do nothing. To revise one, open <a href="hypothesis.html">hypothesis.html</a> and submit a new form with its H-number in "Revises". To withdraw one, submit an abstention with its H-number in "Revises". A form with no H-number in "Revises" is a new hypothesis. At most 8 forms.</p>`
    + `<p><a href="index.html">Observations</a></p>\n`;
}

/** Build the phase-2 site directory (a new directory). */
export function buildPhase2Site(discoverySite: string, out: string, page: string) {
  if (existsSync(out)) throw new Error(`refusing ${out}: exists`);
  cpSync(discoverySite, out, { recursive: true });
  const h = join(out, 'hypothesis.html'), html = readFileSync(h, 'utf8');
  const at = html.indexOf('<p><label>Confidence');
  if (at < 0) throw new Error('hypothesis.html has no confidence field to anchor the revises field');
  writeFileSync(h, html.slice(0, at) + REVISES_FIELD + html.slice(at));
  writeFileSync(join(out, 'revision.html'), page, { flag: 'wx' });
  return out;
}

/** sha256 of every file of a site directory (relative paths, sorted): the construction record anchored in the ledger. */
export function siteFiles(dir: string): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (d: string) => { for (const f of readdirSync(d).sort()) { const p = join(d, f); if (statSync(p).isDirectory()) walk(p); else out[relative(dir, p).replace(/\\/g, '/')] = createHash('sha256').update(readFileSync(p)).digest('hex'); } };
  walk(dir); return out;
}
/** Differences between a site directory and a record of its files (missing, extra, changed). */
export function siteProblems(dir: string, expected: Record<string, string>, label: string): string[] {
  if (!existsSync(dir)) return [`${label}: ${dir} is missing`];
  const now = siteFiles(dir), p: string[] = [];
  for (const [f, h] of Object.entries(expected)) if (!(f in now)) p.push(`${label}: ${f} is missing`); else if (now[f] !== h) p.push(`${label}: ${f} differs from its record`);
  for (const f of Object.keys(now)) if (!(f in expected)) p.push(`${label}: ${f} is not in its record`);
  return p;
}
