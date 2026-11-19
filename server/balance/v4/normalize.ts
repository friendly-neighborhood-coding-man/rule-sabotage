/**
 * Balance Designer V4: deterministic normalization of raw Kane notebook submissions into typed proposals.
 *
 *   RAW_SUBMISSION  ->  NORMALIZED_CANDIDATE  ->  VALIDATED_PROPOSAL | REJECTED_AMBIGUOUS | REJECTED_INVALID
 *
 * Rules (each application is logged with the original words):
 *  - metric: an exact id is kept; otherwise the text must equal ONE metric's display label (case, spacing and
 *    trailing punctuation ignored). Near misses (an invented id such as `conveyor_moves`) are NEVER resolved: they are
 *    listed as candidates for an operator decision and the entry is REJECTED_AMBIGUOUS.
 *  - cause: an exact key, or text equal to ONE cause's display label (a leading "The" ignored). Anything else is not
 *    guessed. Required for hypotheses; for a conclusion an unresolved cause is kept as raw text (contract V4).
 *  - verdict: an exact value, or a description that STARTS with one known phrase ("more evidence is needed", "no
 *    change is justified", "a change is justified"). Two different phrases = contradiction = ambiguous.
 *  - intervention: an exact catalog id, or text equal to ONE catalog description; its value must pass the catalog's
 *    own bounds. Unknown ids and out-of-bounds values are REJECTED_INVALID.
 *  - game ids must exist in the dataset Kane was shown.
 *  - nothing is invented: a missing prediction, size or direction stays missing. One unresolvable prediction rejects
 *    the whole entry (dropping it would change what Kane claimed).
 *  - free text is stored and compared as strings only; nothing is evaluated or executed.
 *
 * Provenance is three separate facts: kaneAuthored (raw file + sha256 + note id, checked), systemNormalized
 * (normalizer version + source hash + transformation log), humanApprovedExperiment (null until an operator approves a
 * prospective experiment; V3's completed games can never be one).
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { CATALOG, CAUSES, PROPOSAL_METRICS, expandStructured, checkProposal, type Proposal, type ProposalPrediction } from '../v3/proposals.ts';
import { type Provenance } from '../v2/contracts.ts';

export const NORMALIZER_VERSION = 'kane-normalizer-v4.1';
export const normalizerHash = () => createHash('sha256').update(readFileSync(fileURLToPath(import.meta.url), 'utf8').replace(/\r\n/g, '\n')).digest('hex').slice(0, 16);

export type Status = 'VALIDATED_PROPOSAL' | 'REJECTED_AMBIGUOUS' | 'REJECTED_INVALID';
export type Step = { field: string; original: string; normalized: string | number | null; rule: string };
export type Issue = { field: string; original: string; kind: 'ambiguous' | 'invalid' | 'missing'; detail: string; operatorCandidates?: string[] };
export type RawSubmission = { stage: 'RAW_SUBMISSION'; noteId: string; callId: string; receivedAt: string; rawBody: string; rawBodySha256: string; fields: Record<string, string>; predictionsText: string[] };
export type NormalizedRecord = {
  noteId: string; raw: RawSubmission;
  candidate: { stage: 'NORMALIZED_CANDIDATE'; proposal: Proposal; steps: Step[]; issues: Issue[] };
  status: Status; validated: Proposal | null;
  provenance: { kaneAuthored: Provenance; systemNormalized: { normalizer: string; sourceHash: string; steps: number }; humanApprovedExperiment: null };
  testablePredictions: ProposalPrediction[]; operatorDecisions: string[];
};

const squash = (s: string) => s.toLowerCase().replace(/[\s_]+/g, ' ').replace(/[.;:,!]+$/, '').trim();
const tokens = (s: string) => new Set(squash(s).replace(/[^a-z0-9 ]/g, ' ').split(' ').filter(t => t.length > 2));
/** Overlap coefficient: shared words / words of the shorter text. Only used to LIST candidates, never to substitute. */
const overlap = (a: Set<string>, b: Set<string>) => { const i = [...a].filter(x => b.has(x)).length; return i < 2 ? 0 : i / (Math.min(a.size, b.size) || 1); }; // at least two shared words
function nearMisses(text: string, table: Record<string, string>): string[] {
  const t = tokens(text);
  return Object.entries(table).map(([id, label]) => ({ id, s: Math.max(overlap(t, tokens(id)), overlap(t, tokens(label))) })).filter(x => x.s >= 0.5).sort((a, b) => b.s - a.s || a.id.localeCompare(b.id)).slice(0, 3).map(x => x.id);
}
/** Exact id, or text equal to exactly one label. */
function resolve(text: string, table: Record<string, string>, stripArticle = false): { id: string; rule: string } | { id: null; matches: string[] } {
  const raw = text.trim();
  if (table[raw]) return { id: raw, rule: 'exact-id' };
  const norm = (x: string) => { const q = squash(x); return stripArticle ? q.replace(/^the /, '') : q; };
  const m = Object.entries(table).filter(([, label]) => norm(label) === norm(raw)).map(([id]) => id);
  if (m.length === 1) return { id: m[0], rule: 'exact-display-label' };
  return { id: null, matches: m };
}
const VERDICT_PHRASES: [Proposal['verdict'] & string, RegExp][] = [
  ['more-evidence-needed', /^more evidence (is )?needed\b/i],
  ['no-change-justified', /^no change is justified\b/i],
  ['change-justified', /^(a )?change is justified\b/i],
];

export function rawSubmission(e: { noteId: string; callId?: string; receivedAt: string; rawBody: string }): RawSubmission {
  const f0 = new URLSearchParams(e.rawBody);
  const structured = f0.get('structured') ?? '';
  const fields = structured ? expandStructured(structured) : Object.fromEntries([...f0].filter(([k]) => k !== 'nonce'));
  const predictionsText = structured ? [...structured.replace(/\r/g, '').matchAll(/^[ \t]*prediction([12])[ \t]*[:=][ \t]*(.*)$/gim)].map(m => m[2].trim()).filter(Boolean) : [];
  for (const k of Object.keys(fields)) if (/^p[12](metric|dir|size)$/.test(k)) delete fields[k]; // V3's own prediction split is not reused
  return { stage: 'RAW_SUBMISSION', noteId: e.noteId, callId: e.callId ?? '', receivedAt: e.receivedAt, rawBody: e.rawBody, rawBodySha256: createHash('sha256').update(e.rawBody).digest('hex'), fields, predictionsText };
}

export function normalizeEntry(e: { noteId: string; callId?: string; receivedAt: string; rawBody: string }, o: { provenance: Provenance; gameIds: Set<string>; datasetHash: string; id: string }): NormalizedRecord {
  const raw = rawSubmission(e), f = raw.fields;
  const steps: Step[] = [], issues: Issue[] = [], decisions: string[] = [];
  const kind: Proposal['kind'] = (f.entry ?? '').trim().toLowerCase() === 'conclusion' ? 'conclusion' : 'hypothesis';
  // predictions
  const preds: ProposalPrediction[] = [];
  raw.predictionsText.forEach((p, i) => {
    const m = /^(.+?)\s+(increase|decrease|no-change|no change)\s+(-?\d+(?:\.\d+)?)\s*$/i.exec(p);
    if (!m) { issues.push({ field: `prediction${i + 1}`, original: p, kind: 'invalid', detail: 'not "<metric> <increase|decrease|no-change> <size>"' }); return; }
    const r = resolve(m[1], PROPOSAL_METRICS);
    if (r.id === null) {
      const cands = r.matches.length > 1 ? r.matches : nearMisses(m[1], PROPOSAL_METRICS);
      issues.push({ field: `prediction${i + 1}.metric`, original: m[1], kind: cands.length ? 'ambiguous' : 'invalid', detail: r.matches.length > 1 ? 'matches several labels' : cands.length ? 'not an id or label; similar metrics exist but are not substituted' : 'unknown metric', ...(cands.length ? { operatorCandidates: cands } : {}) });
      if (cands.length) decisions.push(`prediction${i + 1}: does "${m[1]}" mean ${cands.join(' or ')}?`);
      return;
    }
    if (r.rule !== 'exact-id') steps.push({ field: `prediction${i + 1}.metric`, original: m[1], normalized: r.id, rule: r.rule });
    const size = Number(m[3]);
    if (!(size > 0)) { issues.push({ field: `prediction${i + 1}.size`, original: m[3], kind: 'invalid', detail: 'needs a positive minimum effect size' }); return; }
    const dir = m[2].toLowerCase().replace(' ', '-') as ProposalPrediction['direction'];
    if (dir !== m[2]) steps.push({ field: `prediction${i + 1}.direction`, original: m[2], normalized: dir, rule: 'spelling' });
    preds.push({ metric: r.id, direction: dir, minEffect: size });
  });
  if (kind === 'hypothesis' && !raw.predictionsText.length) issues.push({ field: 'predictions', original: '', kind: 'missing', detail: 'no prediction written (none is invented)' });
  // cause
  const causeRaw = (f.cause ?? '').trim();
  let cause = '';
  const rc = resolve(causeRaw, CAUSES, true);
  if (rc.id) { cause = rc.id; if (rc.rule !== 'exact-id') steps.push({ field: 'cause', original: causeRaw, normalized: rc.id, rule: rc.rule }); }
  else if (kind === 'hypothesis') { const c = nearMisses(causeRaw, CAUSES); issues.push({ field: 'cause', original: causeRaw, kind: causeRaw ? 'ambiguous' : 'missing', detail: causeRaw ? 'free-text cause; not classified by guesswork' : 'no cause', ...(c.length ? { operatorCandidates: c } : {}) }); if (causeRaw) decisions.push(`cause: classify "${causeRaw}"${c.length ? ` (candidates ${c.join(', ')})` : ''}`); }
  else { cause = causeRaw; steps.push({ field: 'cause', original: causeRaw, normalized: null, rule: 'conclusion: free-text cause kept verbatim, unclassified' }); }
  // verdict
  const vRaw = (f.verdict ?? '').trim();
  let verdict: Proposal['verdict'] = null;
  if (['change-justified', 'no-change-justified', 'more-evidence-needed'].includes(vRaw)) verdict = vRaw as Proposal['verdict'];
  else if (vRaw) {
    const hits = VERDICT_PHRASES.filter(([, re]) => re.test(vRaw)).map(([v]) => v);
    // a second, different verdict phrase anywhere after the leading one = contradiction ("no change is justified" itself is not read as "change is justified")
    const rest = hits.length === 1 ? vRaw.replace(VERDICT_PHRASES.find(([v]) => v === hits[0])![1], ' ') : vRaw;
    const elsewhere = VERDICT_PHRASES.filter(([v, re]) => !hits.includes(v) && new RegExp(v === 'change-justified' ? '(^|[^o]\\s)(a )?change is justified' : re.source.slice(1), 'i').test(rest)).map(([v]) => v);
    if (hits.length === 1 && !elsewhere.length) { verdict = hits[0]; steps.push({ field: 'verdict', original: vRaw.slice(0, 300), normalized: verdict, rule: 'verdict description starts with a known phrase' }); }
    else issues.push({ field: 'verdict', original: vRaw.slice(0, 300), kind: 'ambiguous', detail: hits.length + elsewhere.length > 1 ? 'contradictory verdict phrases' : 'no known verdict phrase at the start' });
  }
  if (kind === 'conclusion' && !verdict && !issues.some(i => i.field === 'verdict')) issues.push({ field: 'verdict', original: vRaw, kind: 'missing', detail: 'a conclusion needs a verdict' });
  // intervention
  let intervention: Proposal['intervention'] = null;
  const ivRaw = (f.intervention ?? '').trim();
  if (ivRaw && ivRaw !== 'none') {
    const ri = resolve(ivRaw, Object.fromEntries(Object.entries(CATALOG).map(([k, c]) => [k, c.description])));
    if (!ri.id) issues.push({ field: 'intervention', original: ivRaw, kind: 'invalid', detail: 'not a catalog intervention' });
    else {
      if (ri.rule !== 'exact-id') steps.push({ field: 'intervention', original: ivRaw, normalized: ri.id, rule: ri.rule });
      const v = CATALOG[ri.id].parse(f.value ?? '');
      if (v.ok) intervention = { id: ri.id, value: v.value }; else issues.push({ field: 'value', original: f.value ?? '', kind: 'invalid', detail: `${ri.id}: ${v.reason}` });
    }
  }
  // games
  const ids = (s: string) => s.split(/[\s,;]+/).filter(Boolean);
  const evidence = ids(f.evidence ?? '');
  for (const g of evidence) if (!o.gameIds.has(g)) issues.push({ field: 'evidence', original: g, kind: 'invalid', detail: 'not a game of the dataset Kane was shown' });
  const cx = (f.counterexample ?? '').trim() || null;
  if (cx && !o.gameIds.has(cx)) issues.push({ field: 'counterexample', original: cx, kind: 'invalid', detail: 'not a game id' });
  const proposal: Proposal = {
    schema: 'rule-sabotage/proposal@1', id: o.id, kind, provenance: o.provenance, title: (f.title ?? '').slice(0, 160), cause, explanation: f.explanation ?? '', evidenceGames: evidence, predictions: preds, intervention,
    sideEffects: f.sideEffects ?? '', competing: f.competing ?? '', counterexample: cx, acceptance: f.acceptance ?? '', disproof: f.disproof ?? '', verdict, datasetHash: o.datasetHash,
  };
  // contract V4: a conclusion may keep an unclassified cause; everything else is the frozen V3 structural check
  const structural = checkProposal(proposal).filter(x => !(kind === 'conclusion' && /cause/.test(x)));
  // "no falsifiable prediction" that only follows from an AMBIGUOUS prediction is not a separate defect
  const ambiguousPred = issues.some(i => i.kind === 'ambiguous' && i.field.startsWith('prediction'));
  for (const x of structural) if (!issues.some(i => x.includes(i.field)) && !(ambiguousPred && /prediction/.test(x))) issues.push({ field: 'structure', original: '', kind: 'invalid', detail: x });
  const status: Status = issues.some(i => i.kind === 'invalid' || i.kind === 'missing') ? 'REJECTED_INVALID' : issues.length ? 'REJECTED_AMBIGUOUS' : 'VALIDATED_PROPOSAL';
  return {
    noteId: e.noteId, raw, candidate: { stage: 'NORMALIZED_CANDIDATE', proposal, steps, issues }, status, validated: status === 'VALIDATED_PROPOSAL' ? proposal : null,
    provenance: { kaneAuthored: o.provenance, systemNormalized: { normalizer: NORMALIZER_VERSION, sourceHash: normalizerHash(), steps: steps.length }, humanApprovedExperiment: null },
    testablePredictions: status === 'VALIDATED_PROPOSAL' ? preds : [], operatorDecisions: decisions,
  };
}
