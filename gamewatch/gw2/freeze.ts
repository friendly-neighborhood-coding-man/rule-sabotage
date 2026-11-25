/**
 * GW2 P3: hypothesis freeze and the evaluation gate.
 *
 *   node --experimental-strip-types --no-warnings gamewatch/gw2/freeze.ts freeze <expDir> [--at <ISO time>]
 *   node --experimental-strip-types --no-warnings gamewatch/gw2/freeze.ts verify <expDir>
 *
 * Layout: <expDir>/judgments.ndjson (the experiment's graph), <expDir>/sessions/* (review sessions),
 * <expDir>/partitions/ (partition.ts), <expDir>/hypotheses/FREEZE.json, <expDir>/evaluation-ledger.ndjson.
 *
 * freeze   Refuses unless: the partitions match their manifests; the graph passes structural, reference and
 *          execution-provenance verification; EVERY session directory under sessions/ is fully imported into the graph
 *          (so the import step cannot be skipped); and no evaluation has been opened. Writes FREEZE.json once (never
 *          overwritten): the graph anchor {count, lastLineSha256}, the ids of every hypothesis and abstention node, the
 *          imported sessions and the partition record hash. Nothing is scored.
 * verify   A freeze is violated when the graph no longer verifies against the anchor (a frozen hypothesis edited,
 *          removed or reordered, or the tail rewritten), the frozen hypothesis set differs from the anchored prefix,
 *          the partitions changed, or a referenced session line changed. Hypotheses appended after the freeze are
 *          listed as NOT covered; they are kept but excluded from evaluation.
 * openEvaluation  The only sanctioned reader of heldout/ and eval/: refuses (and records the refusal in the ledger)
 *          when the freeze is missing, invalid or violated; otherwise records the opening and returns the frozen set and
 *          a reader that checks each file against its partition manifest.
 * Per Q14, P7 anchors and freeze hashes are also recorded in an operator-controlled record outside the repository;
 * FREEZE.json in the experiment directory is the in-repository copy and is only as strong as the repository.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync, appendFileSync, openSync, closeSync, writeSync } from 'node:fs';
import { join, relative } from 'node:path';
import { ROOT, assertWritableOutput } from './paths.ts';
import { verify, fileSha256, sha256, canonical, parseAnchor, type Anchor } from './judgments.ts';
import { verifyPartitions, verifyManifest } from './partition.ts';
import { sessionImportStatus } from './import-session.ts';

export const FREEZE_SCHEMA = 'gamewatch/gw2-freeze@1';
export class FreezeError extends Error {}
const HYP = new Set(['hypothesis', 'abstention']);
const paths = (exp: string) => ({ graph: join(exp, 'judgments.ndjson'), sessions: join(exp, 'sessions'), partitions: join(exp, 'partitions'), freeze: join(exp, 'hypotheses', 'FREEZE.json'), ledger: join(exp, 'evaluation-ledger.ndjson') });
const sessionDirs = (dir: string) => existsSync(dir) ? readdirSync(dir).sort().map(n => join(dir, n)).filter(d => statSync(d).isDirectory()) : [];

function ledgerLines(file: string): Record<string, unknown>[] { return existsSync(file) ? readFileSync(file, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)) : []; }
function ledger(file: string, entry: Record<string, unknown>) {
  const out = assertWritableOutput(file), raw = existsSync(out) ? readFileSync(out, 'utf8').split('\n').filter(Boolean) : [];
  const line = canonical({ seq: raw.length + 1, prev: raw.length ? sha256(raw[raw.length - 1]) : null, at: new Date().toISOString(), ...entry });
  appendFileSync(out, line + '\n');
}

export function freezeHypotheses(exp: string, opts: { at?: string; root?: string } = {}) {
  const P = paths(exp), bad: string[] = [];
  if (existsSync(P.freeze)) throw new FreezeError(`a freeze already exists and is never overwritten: ${P.freeze}`);
  if (ledgerLines(P.ledger).some(l => l.event === 'opened')) throw new FreezeError('evaluation was already opened for this experiment; a freeze after evaluation is not a freeze');
  if (!existsSync(join(P.partitions, 'PARTITION.json'))) bad.push('no partitions (partition.ts) in this experiment');
  else bad.push(...verifyPartitions(exp).map(x => `partitions: ${x}`));
  const v = verify(P.graph, { checkRefs: true, root: opts.root });
  if (!existsSync(P.graph)) bad.push('no judgment graph (judgments.ndjson)');
  else if (!v.ok) bad.push(`graph fails verification at line ${v.firstBadLine} (${v.problems[0].level}): ${v.problems[0].problem}`);
  const sessions = sessionDirs(P.sessions).map(d => sessionImportStatus(d, P.graph));
  for (const s of sessions) if (!s.complete) bad.push(`session ${s.session} is not fully imported (${s.missing.join(', ')}); run import-session.ts first`);
  if (bad.length) throw new FreezeError(`freeze refused:\n  ${bad.join('\n  ')}`);
  const hyps = v.nodes.filter(n => HYP.has(n.kind));
  const rec = {
    schema: FREEZE_SCHEMA, exp: relative(opts.root ?? ROOT, exp).startsWith('..') ? exp : relative(opts.root ?? ROOT, exp), frozenAt: opts.at ?? new Date().toISOString(),
    graph: { file: 'judgments.ndjson', anchor: v.head },
    hypotheses: hyps.map(n => ({ id: n.id, kind: n.kind, session: n.body.session ?? null, ref: n.body.ref ?? null })),
    counts: { hypotheses: hyps.filter(n => n.kind === 'hypothesis').length, abstentions: hyps.filter(n => n.kind === 'abstention').length, nodes: v.count },
    sessions: sessions.map(s => s.session),
    partition: { file: 'partitions/PARTITION.json', sha256: fileSha256(join(P.partitions, 'PARTITION.json')) },
    statement: 'Frozen before any held-out or evaluation file was read through freeze.ts. Nothing in P3 scores hypotheses. Record the anchor and this file\'s hash in the operator-controlled record outside the repository (Q14).',
  };
  const out = assertWritableOutput(P.freeze);
  mkdirSync(join(exp, 'hypotheses'), { recursive: true });
  const fd = openSync(out, 'wx'); try { writeSync(fd, JSON.stringify(rec, null, 1) + '\n'); } finally { closeSync(fd); }
  return { ...rec, freezeSha256: fileSha256(out) };
}

export function verifyFreeze(exp: string, opts: { root?: string } = {}) {
  const P = paths(exp), problems: string[] = [];
  if (!existsSync(P.freeze)) return { ok: false, problems: ['no hypothesis freeze (hypotheses/FREEZE.json)'], frozen: [] as string[], notCovered: [] as string[] };
  let f: Record<string, any>;
  try { f = JSON.parse(readFileSync(P.freeze, 'utf8')); } catch { return { ok: false, problems: ['FREEZE.json is not valid JSON'], frozen: [], notCovered: [] }; }
  let anchor: Anchor | null = null;
  if (f.schema !== FREEZE_SCHEMA) problems.push(`FREEZE.json schema is not ${FREEZE_SCHEMA}`);
  try { anchor = parseAnchor(`${f.graph?.anchor?.count}:${f.graph?.anchor?.lastLineSha256 ?? ''}`); } catch (e) { problems.push(`FREEZE.json anchor: ${(e as Error).message}`); }
  if (!Array.isArray(f.hypotheses)) problems.push('FREEZE.json has no hypothesis list');
  if (problems.length) return { ok: false, problems, frozen: [], notCovered: [] };
  const v = verify(P.graph, { checkRefs: true, anchor: anchor!, root: opts.root });
  for (const p of v.problems) problems.push(`graph line ${p.line} [${p.level}]: ${p.problem}`);
  const frozen = (f.hypotheses as { id: string }[]).map(h => h.id);
  const prefix = v.nodes.slice(0, anchor!.count).filter(n => HYP.has(n.kind)).map(n => n.id);
  if (v.ok && canonical(prefix) !== canonical(frozen)) problems.push('the frozen hypothesis list differs from the hypotheses in the anchored prefix of the graph');
  if (!existsSync(join(P.partitions, 'PARTITION.json')) || fileSha256(join(P.partitions, 'PARTITION.json')) !== f.partition?.sha256) problems.push('partitions/PARTITION.json differs from the freeze record');
  else problems.push(...verifyPartitions(exp).map(x => `partitions: ${x}`));
  const notCovered = v.nodes.slice(anchor!.count).filter(n => HYP.has(n.kind)).map(n => n.id);
  return { ok: !problems.length, problems, frozen, notCovered, freezeSha256: fileSha256(P.freeze) };
}

/** The evaluation gate (P4's evaluator must go through it). */
export function openEvaluation(exp: string, evaluator: { id: string; version: string }, opts: { root?: string } = {}) {
  const P = paths(exp), r = verifyFreeze(exp, opts);
  if (!r.ok) {
    ledger(P.ledger, { event: 'refused', evaluator, reasons: r.problems });
    throw new FreezeError(`evaluation refused: ${r.problems.join('; ')}`);
  }
  ledger(P.ledger, { event: 'opened', evaluator, freezeSha256: r.freezeSha256, frozen: r.frozen.length, notCovered: r.notCovered });
  const read = (partition: 'spec' | 'heldout' | 'eval', file: string) => {
    const dir = join(P.partitions, partition), m = JSON.parse(readFileSync(join(dir, 'MANIFEST.json'), 'utf8'));
    const problems = verifyManifest(dir);
    if (problems.length || !(file in m.files)) throw new FreezeError(`${partition}/${file}: ${problems.join('; ') || 'not in the partition manifest'}`);
    return readFileSync(join(dir, file), 'utf8');
  };
  return { frozen: r.frozen, notCovered: r.notCovered, freezeSha256: r.freezeSha256, read };
}

if (process.argv[1]?.endsWith('gw2/freeze.ts')) {
  const [cmd, exp] = process.argv.slice(2), ai = process.argv.indexOf('--at');
  if (!cmd || !exp) { console.error('usage: freeze.ts freeze|verify <expDir> [--at ISO]'); process.exit(2); }
  try {
    if (cmd === 'freeze') { const r = freezeHypotheses(exp, { at: ai > 0 ? process.argv[ai + 1] : undefined }); console.log(`frozen: ${r.counts.hypotheses} hypotheses, ${r.counts.abstentions} abstentions; graph anchor ${r.graph.anchor.count}:${r.graph.anchor.lastLineSha256}; FREEZE.json sha256 ${r.freezeSha256}`); }
    else if (cmd === 'verify') { const r = verifyFreeze(exp); console.log(r.ok ? `freeze OK: ${r.frozen.length} frozen, ${r.notCovered.length} submitted after the freeze (not covered)` : `freeze INVALID or VIOLATED:\n  ${r.problems.join('\n  ')}`); process.exit(r.ok ? 0 : 1); }
    else { console.error(`unknown command ${cmd}`); process.exit(2); }
  } catch (e) { console.error((e as Error).message); process.exit(5); }
}
