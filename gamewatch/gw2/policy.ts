/**
 * GW2 hybrid investigation policy (`gamewatch/gw2-policy@1`): validator and completeness evaluator (P1).
 *
 *   node --experimental-strip-types --no-warnings gamewatch/gw2/policy.ts <policy.json> <bundle.json> <sessionDir> <out.json>
 *
 * Only explicitly declared requirements are enforced; nothing else is required (no implicit "visit everything").
 * Each requirement is evaluated on its own:
 *   must-access    every target evidence page was SERVED to this session (server journal, GET 200 completed, content
 *                  hash equal to the page recorded at session start). Missing, disabled, invalid or ambiguous journals
 *                  never let it pass: they make it not-evaluable, with the reason.
 *   must-cite      every target id (evidence or rule) is cited, by exact identifier, in at least one counted finding.
 *   must-evaluate  always not-evaluable in P1: the deterministic verifier is P4. Citing or opening a rule's evidence is
 *                  NOT an evaluation.
 * Agent-written summaries (Kane's run_end summary, a clean report's claim) are never read as evidence of anything here.
 * Findings are reported verbatim and separately; an unsatisfied requirement never hides or changes a finding.
 * Observations stay usable on their own (an intact served record still satisfies must-access in an incomplete journal;
 * notes still satisfy must-cite without a journal), but each result states its basis, each finding is labelled
 * journal-verified or unverified-session-note, and a separate experimentalValidity status decides whether the session
 * may enter the primary verified analysis. "complete" is "verifiedComplete" only when validity is "verified".
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { loadInventory, citations, type Inventory } from './inventory.ts';
import { loadSession, servedIndex, experimentalValidity, type Session } from './session.ts';
import { assertWritableOutput } from './paths.ts';

export const POLICY_SCHEMA = 'gamewatch/gw2-policy@1';
export const KINDS = ['must-access', 'must-cite', 'must-evaluate'] as const;
export type Requirement = { id: string; kind: typeof KINDS[number]; targets: string[]; reason: string };
export type Policy = { schema: typeof POLICY_SCHEMA; id: string; requirements: Requirement[] };
export type Result = 'satisfied' | 'unsatisfied' | 'not-evaluable';

export class PolicyError extends Error {
  problems: string[];
  constructor(problems: string[]) { super(`invalid policy:\n  ${problems.join('\n  ')}`); this.problems = problems; }
}
const ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

/** Validate a policy against the evidence inventory. Throws PolicyError listing every problem; never drops anything. */
export function validatePolicy(p: unknown, inv: Inventory): Policy {
  const bad: string[] = [];
  const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
  if (!isObj(p)) throw new PolicyError(['policy is not a JSON object']);
  for (const k of Object.keys(p)) if (!['schema', 'id', 'requirements'].includes(k)) bad.push(`unknown policy field "${k}"`);
  if (p.schema !== POLICY_SCHEMA) bad.push(`schema must be "${POLICY_SCHEMA}"`);
  if (typeof p.id !== 'string' || !ID.test(p.id)) bad.push('id must match [A-Za-z0-9][A-Za-z0-9._-]{0,63}');
  if (!Array.isArray(p.requirements)) { bad.push('requirements must be an array'); throw new PolicyError(bad); }
  const seen = new Set<string>();
  p.requirements.forEach((r, i) => {
    const at = `requirements[${i}]`;
    if (!isObj(r)) { bad.push(`${at} is not an object`); return; }
    for (const k of Object.keys(r)) if (!['id', 'kind', 'targets', 'reason'].includes(k)) bad.push(`${at}: unknown field "${k}"`);
    if (typeof r.id !== 'string' || !ID.test(r.id)) bad.push(`${at}: id must match [A-Za-z0-9][A-Za-z0-9._-]{0,63}`);
    else if (seen.has(r.id)) bad.push(`${at}: duplicate id "${r.id}"`); else seen.add(r.id);
    if (!KINDS.includes(r.kind as Requirement['kind'])) bad.push(`${at}: kind must be one of ${KINDS.join(', ')}`);
    if (typeof r.reason !== 'string' || !r.reason.trim()) bad.push(`${at}: reason is required`);
    if (!Array.isArray(r.targets) || !r.targets.length) { bad.push(`${at}: targets must be a non-empty array`); return; }
    const ts = r.targets as unknown[];
    if (new Set(ts).size !== ts.length) bad.push(`${at}: duplicate targets`);
    for (const t of ts) {
      if (typeof t !== 'string') { bad.push(`${at}: target ${JSON.stringify(t)} is not a string`); continue; }
      const isEv = inv.evidence.has(t), isRule = inv.ruleSet.has(t);
      if (r.kind === 'must-access' && !isEv) bad.push(`${at}: must-access target "${t}" is not an evidence id in the inventory${isRule ? ' (it is a rule id)' : ''}`);
      if (r.kind === 'must-cite' && !isEv && !isRule) bad.push(`${at}: must-cite target "${t}" is neither an evidence id nor a rule id in the inventory`);
      if (r.kind === 'must-evaluate' && !isRule) bad.push(`${at}: must-evaluate target "${t}" is not a rule id in the inventory${isEv ? ' (it is an evidence id)' : ''}`);
    }
  });
  if (bad.length) throw new PolicyError(bad);
  return p as Policy;
}

export function evaluate(policy: Policy, inv: Inventory, s: Session) {
  const j = s.journal, { served, mismatched } = servedIndex(j);
  const counted = s.findings.filter(f => f.counts);
  const cites = counted.map(f => citations(f.note, inv));
  const validity = experimentalValidity(s);
  const citeBasis = (t: string[]) => counted.filter((f, k) => t.some(x => cites[k].evidence.includes(x) || cites[k].rules.includes(x))).every(f => f.verification === 'journal-verified') ? 'journal-verified findings' : 'includes unverified session-note findings';
  const accessBasis = j.status === 'valid' ? 'server journal (valid)' : j.status === 'incomplete' ? 'server journal (incomplete: intact positive records only)' : `server journal ${j.status}`;
  const cited = new Set(cites.flatMap(c => [...c.evidence, ...c.rules]));
  const accessUsable = (j.status === 'valid' || j.status === 'incomplete') && j.attribution !== 'uncertain';
  const requirements = policy.requirements.map(r => {
    if (r.kind === 'must-evaluate') return { ...r, result: 'not-evaluable' as Result, why: 'rule evaluation is the deterministic verifier of P4; it does not exist in P1. Citing a rule or opening its evidence is not an evaluation.' };
    if (r.kind === 'must-cite') {
      const missing = r.targets.filter(t => !cited.has(t));
      if (!s.findings.length && !counted.length) return { ...r, result: 'unsatisfied' as Result, missing, why: 'no findings were submitted in this session' };
      return { ...r, result: (missing.length ? 'unsatisfied' : 'satisfied') as Result, missing, basis: citeBasis(r.targets), why: missing.length ? `not cited by any counted finding: ${missing.join(', ')}` : 'every target cited by at least one counted finding (exact identifier match)' };
    }
    // must-access
    const have = r.targets.filter(t => served.has(t)), missing = r.targets.filter(t => !served.has(t));
    const firstServedSeq = Object.fromEntries(have.map(t => [t, served.get(t)!.firstSeq])), basis = accessBasis;
    if (j.status === 'unavailable' || j.status === 'invalid') return { ...r, result: 'not-evaluable' as Result, missing, basis, why: `access journal ${j.status}: ${j.reasons.join('; ')}. Missing instrumentation is not evidence that a page was not accessed.` };
    if (j.attribution === 'uncertain') return { ...r, result: 'not-evaluable' as Result, missing, firstServedSeq, basis, why: `access attribution uncertain: ${j.clients.length} different clients made requests in this session` };
    if (!missing.length) return { ...r, result: 'satisfied' as Result, missing, firstServedSeq, basis, why: `every target served to this session${j.status === 'incomplete' ? ' (journal incomplete, but each served record is intact)' : ''}` };
    if (j.status === 'incomplete') return { ...r, result: 'not-evaluable' as Result, missing, firstServedSeq, basis, why: `journal incomplete (${j.reasons.join('; ')}): ${missing.join(', ')} not recorded, which does not prove they were not served` };
    return { ...r, result: 'unsatisfied' as Result, missing, firstServedSeq, basis, why: `not served to this session: ${missing.join(', ')}` };
  });
  const res = requirements.map(r => r.result);
  const completeness = !policy.requirements.length ? 'not-declared' : res.includes('unsatisfied') ? 'incomplete' : res.includes('not-evaluable') ? 'undetermined' : 'complete';
  return {
    schema: 'gamewatch/gw2-completeness@1', policy: policy.id, exp: s.meta.exp, session: s.meta.session,
    note: 'Separate dimensions. Completeness concerns only the declared requirements; experimental validity says whether this session may enter the primary verified analysis. Neither says whether the findings are right, and findings are never changed, dropped or rewritten by either.',
    findings: s.findings.map(f => ({ noteIndex: f.noteIndex, seq: f.seq, counted: f.counts, verification: f.verification, join: f.join, verbatim: f.line })),
    investigationCompleteness: { completeness, verifiedComplete: completeness === 'complete' && validity.status === 'verified', requirements },
    experimentalValidity: validity,
    accessCoverage: {
      journal: { status: j.status, reasons: j.reasons, attribution: j.attribution, clients: j.clients.length },
      usable: accessUsable, servedEvidence: [...served.keys()].sort(), servedCount: served.size, evidenceInInventory: inv.evidence.size,
      duplicateRequests: [...served.values()].reduce((a, v) => a + v.requests - 1, 0), contentMismatchSeqs: mismatched,
      meaning: 'served by the server to this session; not proof that the page was rendered, read or understood',
    },
    citationCoverage: { countedFindings: counted.length, evidenceCited: [...new Set(cites.flatMap(c => c.evidence))].sort(), rulesCited: [...new Set(cites.flatMap(c => c.rules))].sort(), unknownIdLike: [...new Set(cites.flatMap(c => c.unknownIdLike))].sort() },
    evaluationAvailability: { ruleEvaluation: 'not-available', reason: 'P4 (deterministic three-way verifier) is not implemented; must-evaluate requirements are not-evaluable' },
  };
}

if (process.argv[1]?.endsWith('gw2/policy.ts')) {
  const [pf, bf, sd, outF] = process.argv.slice(2);
  if (!outF) { console.error('usage: policy.ts <policy.json> <bundle.json> <sessionDir> <out.json>'); process.exit(2); }
  const out = assertWritableOutput(outF), inv = loadInventory(bf);
  let policy: Policy;
  try { policy = validatePolicy(JSON.parse(readFileSync(pf, 'utf8')), inv); } catch (e) { console.error((e as Error).message); process.exit(5); }
  const r = evaluate(policy, inv, loadSession(sd));
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(r, null, 1) + '\n');
  console.log(`validity: ${r.experimentalValidity.status}; completeness: ${r.investigationCompleteness.completeness}${r.investigationCompleteness.verifiedComplete ? ' (verified)' : ''} (${r.investigationCompleteness.requirements.map(x => `${x.id}=${x.result}`).join(', ') || 'no requirements'}); journal ${r.accessCoverage.journal.status}; findings ${r.findings.length}`);
}
