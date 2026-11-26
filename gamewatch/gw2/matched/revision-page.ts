/**
 * GW2 matched comparison: the phase-2 site of one session (D139). Both arms get the SAME shell:
 *   - the discovery site, unchanged, except hypothesis.html gains one field "revises" (the H-number of an earlier
 *     hypothesis of this session);
 *   - revision.html: the session's own frozen phase-1 submissions (verbatim statement, whether a structured
 *     representation was given, abstentions), then a feedback section, then how to keep, revise or withdraw.
 * Control: the feedback section reads "No observation list is provided in this session." Treatment: the capped H↔O
 * feedback (ext/feedback-core.ts renderFeedbackSection, which re-checks the cap). No spec, held-out or eval content.
 */
import { cpSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { renderFeedbackSection, type AgentFeedback } from '../ext/feedback-core.ts';
import { esc } from '../ext/html.ts';
import type { Frozen } from './sessions.ts';
import type { Arm } from './params.ts';

export const NO_FEEDBACK = 'No observation list is provided in this session.';
export const REVISES_FIELD = '<p><label>Revises (the H-number of your earlier hypothesis, if this form revises or withdraws it) <input name="revises"></label></p>';

export function revisionPage(frozen: Frozen, arm: Arm, feedback: AgentFeedback | null): string {
  if ((arm === 'treatment') !== (feedback !== null)) throw new Error(`arm ${arm} ${feedback ? 'must not' : 'must'} receive feedback`);
  const byId = new Map(frozen.nodes.map(n => [n.id, n]));
  const rows = frozen.submissions.map(s => { const b = byId.get(s.id)!.body as any;
    return `<tr><td>${esc(s.ref)}</td><td>${s.kind === 'abstention' ? 'abstention' : 'hypothesis'}</td><td>${esc(b.statement)}</td><td>${s.representations.length ? 'yes' : 'no'}</td></tr>`; }).join('');
  return `<!doctype html><meta charset="utf-8"><title>Revision</title><h1>Revision</h1>`
    + `<p>These are the forms you submitted earlier in this investigation. They are kept whatever you do now.</p>`
    + `<table><tr><th>Ref</th><th>Kind</th><th>Statement</th><th>Structured representation</th></tr>${rows || '<tr><td colspan="4">You submitted no forms.</td></tr>'}</table>`
    + `<h2>Observations that differ from your structured hypotheses</h2>${feedback ? renderFeedbackSection(feedback) : `<p>${NO_FEEDBACK}</p>`}`
    + `<h2>What you can do</h2><p>To keep a hypothesis, do nothing. To revise one, open <a href="hypothesis.html">hypothesis.html</a> and submit a new form with its H-number in "Revises". To withdraw one, submit an abstention with its H-number in "Revises". At most 8 forms.</p>`
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
