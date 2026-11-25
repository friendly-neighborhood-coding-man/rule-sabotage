/**
 * GW2 P5: structured representations of frozen hypotheses (Q20 SUBMITTER-FIRST, D70) and the representation seal.
 *
 *   node --experimental-strip-types --no-warnings gamewatch/gw2/representations.ts submitter <expDir> [--at ISO]
 *   node --experimental-strip-types --no-warnings gamewatch/gw2/representations.ts seal <expDir> [--at ISO]
 *   node --experimental-strip-types --no-warnings gamewatch/gw2/representations.ts verify <expDir>
 *
 * Two origins, always reported separately, never merged or repaired:
 *   submitter              the optional `representation` field the submitter typed with the free text (stored verbatim
 *                          in the frozen hypothesis). Extracted mechanically: JSON.parse of the stored string and
 *                          nothing else. Unreadable JSON is recorded as such (the verifier then reports it as not
 *                          representable); the free text remains the hypothesis.
 *   external-translation   a translation by someone other than the submitter (an operator; no model in P5–P6), with
 *                          provenance, declared fidelity, and a declaration that the translator had no access to the
 *                          spec, held-out or eval partitions. Recorded as its own node; the hypothesis is never edited.
 * The SEAL (hypotheses/REPRESENTATIONS.json, gamewatch/gw2-representation-seal@1) closes the representation set before
 * any evaluation is opened: it lists every representation node of a frozen hypothesis with the graph head at sealing.
 * Held-out scoring and discrimination use exactly the sealed set and refuse when the seal is missing, broken, or was
 * written after an evaluation opening.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, assertWritableOutput } from './paths.ts';
import { verify, append, sha256, fileSha256, canonical, type Node, type NodeInput } from './judgments.ts';
import { verifyFreeze, verifyLedger, FreezeError } from './freeze.ts';

export const REPRESENTATION_SCHEMA = 'gamewatch/gw2-representation@1';
export const SEAL_SCHEMA = 'gamewatch/gw2-representation-seal@1';
export const ORIGINS = ['submitter', 'external-translation'] as const;
export type Origin = typeof ORIGINS[number];
const P = (exp: string) => ({ graph: join(exp, 'judgments.ndjson'), seal: join(exp, 'hypotheses', 'REPRESENTATIONS.json'), ledger: join(exp, 'evaluation-ledger.ndjson') });

const frozenHypotheses = (exp: string, root: string) => {
  const f = verifyFreeze(exp, { root });
  if (!f.ok) throw new FreezeError(`representations need a valid hypothesis freeze: ${f.problems.join('; ')}`);
  const nodes = verify(P(exp).graph, { root }).nodes, ids = new Set(f.frozen);
  return { freeze: f, nodes, hyps: nodes.filter(n => ids.has(n.id) && n.kind === 'hypothesis') };
};
const notOpened = (exp: string) => {
  const L = verifyLedger(P(exp).ledger);
  if (!L.ok) throw new FreezeError(`the evaluation ledger is invalid: ${L.problems.join('; ')}`);
  if (L.entries.some(e => e.event === 'opened')) throw new FreezeError('an evaluation has already been opened: representations can no longer be added or sealed for this experiment');
  if (existsSync(P(exp).seal)) throw new FreezeError('the representation set is already sealed (hypotheses/REPRESENTATIONS.json)');
};

/** Q20: one representation node per frozen hypothesis that carries a submitter-typed representation. */
export function appendSubmitterRepresentations(exp: string, o: { at?: string; root?: string } = {}) {
  const root = o.root ?? ROOT; notOpened(exp);
  const { nodes, hyps } = frozenHypotheses(exp, root), out: string[] = [];
  for (const h of hyps) {
    const raw = h.body.submittedRepresentation;
    if (typeof raw !== 'string' || !raw.trim()) continue;
    if (nodes.some(n => n.kind === 'representation' && n.parents[0]?.id === h.id && (n.body as Record<string, unknown>).origin === 'submitter')) continue;
    let representation: unknown = null, parseError: string | null = null;
    try { representation = JSON.parse(raw); } catch (e) { parseError = (e as Error).message; }
    const node: NodeInput = {
      kind: 'representation', parents: [{ id: h.id, relation: 'represents' }], author: h.author, ...(h.provenance ? { provenance: h.provenance } : {}), origin: 'live', at: o.at ?? new Date().toISOString(), evidenceRefs: h.evidenceRefs,
      reason: 'structured representation submitted by the hypothesis author with the free text (Q20); extracted verbatim, not repaired',
      body: { schema: REPRESENTATION_SCHEMA, origin: 'submitter', representation, ...(parseError ? { parseError } : {}), rawSha256: sha256(raw), fidelity: { declared: 'faithful', notes: 'authored by the submitter together with the free text' },
        translatedFrom: { ref: h.body.ref, statementSha256: sha256(String(h.body.statement ?? '')) }, method: 'JSON.parse of the stored submission field; nothing added, removed or corrected',
        // a Kane-authored submission keeps its Kane provenance, which requires the note line verbatim (P7 preflight, D104)
        ...(h.provenance && typeof h.body.verbatim === 'string' ? { verbatim: h.body.verbatim } : {}) },
    };
    out.push(append(P(exp).graph, node, { root }).id);
  }
  return out;
}

/** An external translation (operator; never a model in P5–P6). `access` must declare no spec / held-out / eval access. */
export function appendTranslation(exp: string, hypothesisId: string, t: { representation: unknown; author: Node['author']; fidelity: string; notes: string; access: { spec: boolean; heldout: boolean; eval: boolean }; method: string; at?: string }, o: { root?: string } = {}) {
  const root = o.root ?? ROOT; notOpened(exp);
  const { hyps } = frozenHypotheses(exp, root), h = hyps.find(x => x.id === hypothesisId);
  if (!h) throw new FreezeError(`${hypothesisId} is not a frozen hypothesis`);
  if (t.access.spec || t.access.heldout || t.access.eval) throw new FreezeError('an external translation must be made without access to the spec, held-out or eval partitions (D70)');
  return append(P(exp).graph, {
    kind: 'representation', parents: [{ id: h.id, relation: 'represents' }], author: t.author, origin: 'live', at: t.at ?? new Date().toISOString(), evidenceRefs: h.evidenceRefs,
    reason: 'external translation of a frozen hypothesis, recorded separately; the hypothesis node is unchanged',
    body: { schema: REPRESENTATION_SCHEMA, origin: 'external-translation', representation: t.representation, fidelity: { declared: t.fidelity, notes: t.notes }, translatorAccess: t.access,
      translatedFrom: { ref: h.body.ref, statementSha256: sha256(String(h.body.statement ?? '')) }, method: t.method },
  }, { root }).id;
}

/** Seal the representation set before any evaluation opening. */
export function sealRepresentations(exp: string, o: { at?: string; root?: string } = {}) {
  const root = o.root ?? ROOT; notOpened(exp);
  const { freeze, nodes } = frozenHypotheses(exp, root), frozen = new Set(freeze.frozen);
  const reps = nodes.filter(n => n.kind === 'representation' && frozen.has(n.parents[0]?.id)).map(n => {
    const b = n.body as Record<string, any>;
    return { id: n.id, hypothesis: n.parents[0].id, origin: (ORIGINS as readonly string[]).includes(b.origin) ? b.origin : 'external-translation', authorKind: n.author.kind, authorId: n.author.id, fidelity: b.fidelity?.declared ?? 'unknown' };
  });
  const bad = nodes.filter(n => n.kind === 'representation' && (n.body as Record<string, any>).origin === 'external-translation' && canonical((n.body as Record<string, any>).translatorAccess) !== canonical({ spec: false, heldout: false, eval: false }));
  if (bad.length) throw new FreezeError(`external translations without a no-access declaration cannot be sealed: ${bad.map(n => n.id.slice(0, 12)).join(', ')}`);
  const g = verify(P(exp).graph, { root });
  const seal = { schema: SEAL_SCHEMA, at: o.at ?? new Date().toISOString(), freezeSha256: freeze.freezeSha256, graphHead: g.head, ledgerEntriesAtSeal: verifyLedger(P(exp).ledger).count, representations: reps,
    counts: { submitter: reps.filter(r => r.origin === 'submitter').length, externalTranslation: reps.filter(r => r.origin === 'external-translation').length, frozenHypotheses: freeze.frozen.length },
    note: 'Only these representations are used by held-out scoring and discrimination. Written before any evaluation opening.' };
  writeFileSync(assertWritableOutput(P(exp).seal), JSON.stringify(seal, null, 1) + '\n');
  return { ...seal, sealSha256: fileSha256(P(exp).seal) };
}

/** Check the seal: present, written before the first opening, its graph prefix unchanged, every listed node present. */
export function verifyRepresentationSeal(exp: string, o: { root?: string } = {}) {
  const root = o.root ?? ROOT, problems: string[] = [];
  if (!existsSync(P(exp).seal)) return { ok: false, problems: ['no representation seal (hypotheses/REPRESENTATIONS.json): seal the representation set before evaluation'], representations: [] as { id: string; hypothesis: string; origin: Origin }[] };
  const s = JSON.parse(readFileSync(P(exp).seal, 'utf8'));
  if (s.schema !== SEAL_SCHEMA) problems.push(`seal schema must be ${SEAL_SCHEMA}`);
  const f = verifyFreeze(exp, { root });
  if (!f.ok) problems.push(...f.problems); else if (f.freezeSha256 !== s.freezeSha256) problems.push('the seal names another hypothesis freeze');
  const v = verify(P(exp).graph, { root, anchor: s.graphHead });
  if (!v.ok) problems.push(`the graph no longer matches the sealed head ${s.graphHead?.count}: ${v.problems[0]?.problem}`);
  const prefix = v.nodes.slice(0, s.graphHead?.count ?? 0), frozen = new Set(f.frozen);
  const expected = prefix.filter(n => n.kind === 'representation' && frozen.has(n.parents[0]?.id)).map(n => n.id);
  if (canonical(expected) !== canonical((s.representations ?? []).map((r: { id: string }) => r.id))) problems.push('the sealed list differs from the representation nodes in the sealed graph prefix');
  if (s.ledgerEntriesAtSeal !== 0) problems.push('the seal was written after the evaluation ledger had entries');
  const firstOpen = verifyLedger(P(exp).ledger).entries.find(e => e.event === 'opened');
  if (firstOpen && Number(firstOpen.graphHead?.count) < Number(s.graphHead?.count)) problems.push('the seal covers graph lines appended after the first evaluation opening');
  return { ok: !problems.length, problems, representations: s.representations as { id: string; hypothesis: string; origin: Origin }[], sealSha256: fileSha256(P(exp).seal), graphHead: s.graphHead };
}

if (process.argv[1]?.endsWith('gw2/representations.ts')) {
  const [cmd, exp] = process.argv.slice(2), ai = process.argv.indexOf('--at'), at = ai > 0 ? process.argv[ai + 1] : undefined;
  try {
    if (cmd === 'submitter' && exp) console.log(`${appendSubmitterRepresentations(exp, { at }).length} submitter representation node(s) appended`);
    else if (cmd === 'seal' && exp) { const s = sealRepresentations(exp, { at }); console.log(`sealed ${s.representations.length} representation(s) (${s.counts.submitter} submitter, ${s.counts.externalTranslation} external) at graph head ${s.graphHead.count}`); }
    else if (cmd === 'verify' && exp) { const r = verifyRepresentationSeal(exp); console.log(r.ok ? `seal OK: ${r.representations.length} representation(s)` : `seal INVALID:\n  ${r.problems.join('\n  ')}`); process.exit(r.ok ? 0 : 1); }
    else { console.error('usage: representations.ts submitter|seal|verify <expDir> [--at ISO]'); process.exit(2); }
  } catch (e) { console.error((e as Error).message); process.exit(5); }
}
