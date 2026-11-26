/**
 * GW2 Extension V1: authenticated inputs for anything agent-facing (D129, D130).
 *
 * authenticatedPrefix(exp, rec): the frozen, pre-evaluation judgment-graph prefix, authenticated against the external
 * record before a single node is used.
 *   1. The external execution ledger verifies as a hash chain and starts with the pre-registration it names.
 *   2. FREEZE.json and REPRESENTATIONS.json equal the hashes anchored by the ledger's hypothesis-freeze and
 *      representation-seal events, and the seal names the freeze it seals.
 *   3. The prefix length N is the seal's graphHead.count, which must equal the ledger's representation-seal anchor.
 *   4. Exactly the first N lines of judgments.ndjson are read, byte by byte, stopping at the N-th newline: no byte after
 *      the prefix is read, so no later node (evaluation results carry held-out outcomes) is loaded or parsed.
 *   5. The prefix is verified on its own (structure, hash chain, anchor at line N and at the freeze line), and refused if
 *      it contains an evaluation node or an `evaluates` relation, or if it is shorter than the freeze prefix.
 *
 * feedbackBinding(exp, rec): an OPTIONAL feedback partition is accepted only if the externally anchored
 * pre-registration lists its MANIFEST.json under "exp:partitions/feedback/MANIFEST.json" with the manifest's exact hash.
 * A feedback partition that the pre-registration does not bind (P7 has none) is refused.
 */
import { openSync, readSync, closeSync, readFileSync, existsSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { verify as verifyGraph, type Node } from '../judgments.ts';
import { readExecLedger } from '../p7-exec.ts';
import { AccessRefused } from './errors.ts';

const sha = (b: Buffer | string) => createHash('sha256').update(b).digest('hex');
const fsha = (f: string) => sha(readFileSync(f));
export const FEEDBACK_MANIFEST_KEY = 'exp:partitions/feedback/MANIFEST.json';
export const PREFIX_NODE_KINDS = ['hypothesis', 'abstention', 'representation'] as const;
export const defaultRecord = (exp: string) => join(exp, '..', 'external-record');

/** Read exactly the first `n` newline-terminated lines of a file; never reads a byte past the n-th newline. */
export function readLinePrefix(file: string, n: number): { lines: string[]; bytesRead: number } {
  const fd = openSync(file, 'r'), one = Buffer.alloc(1), chunks: number[] = [];
  let newlines = 0, pos = 0;
  try {
    while (newlines < n) {
      if (readSync(fd, one, 0, 1, pos) !== 1) throw new AccessRefused(`${file}: ends after ${newlines} lines, the anchored prefix has ${n}`);
      pos++; chunks.push(one[0]); if (one[0] === 0x0a) newlines++;
    }
  } finally { closeSync(fd); }
  const text = Buffer.from(chunks).toString('utf8');
  return { lines: text.split('\n').slice(0, n), bytesRead: pos };
}

function ledger(rec: string) {
  if (!existsSync(join(rec, 'execution-ledger.ndjson'))) throw new AccessRefused(`no external execution ledger in ${rec}`);
  const l = readExecLedger(rec);
  if (!l.ok) throw new AccessRefused(`external execution ledger fails: ${l.problems.join('; ')}`);
  const one = (e: string) => { const x = (l.entries as any[]).filter(y => y.event === e); if (x.length !== 1) throw new AccessRefused(`external ledger: expected exactly one ${e} event, found ${x.length}`); return x[0]; };
  return { entries: l.entries as any[], one };
}

/** The pre-registration file, authenticated as the one the external ledger starts with. */
export function anchoredPrereg(rec: string) {
  const { entries } = ledger(rec), f = join(rec, 'PREREGISTRATION.json');
  if (!existsSync(f)) throw new AccessRefused('no PREREGISTRATION.json in the external record');
  const first = entries[0];
  if (first?.event !== 'preregistered' || first.data?.preregSha256 !== fsha(f)) throw new AccessRefused('the external ledger does not start with this pre-registration');
  return { prereg: JSON.parse(readFileSync(f, 'utf8')), preregSha256: first.data.preregSha256 as string };
}

export type Prefix = { nodes: Node[]; count: number; freezeCount: number; bytesRead: number; freeze: any; seal: any; preregSha256: string; checks: string[] };

export function authenticatedPrefix(exp: string, rec = defaultRecord(exp)): Prefix {
  const checks: string[] = [];
  const { one } = ledger(rec); checks.push('external execution ledger: hash chain verifies');
  const { preregSha256 } = anchoredPrereg(rec); checks.push('pre-registration equals the ledger\'s first entry');
  const fz = one('hypothesis-freeze'), sl = one('representation-seal');
  const freezeF = join(exp, 'hypotheses/FREEZE.json'), sealF = join(exp, 'hypotheses/REPRESENTATIONS.json');
  if (fsha(freezeF) !== fz.data.freezeSha256) throw new AccessRefused('FREEZE.json differs from its external anchor');
  if (fsha(sealF) !== sl.data.sealSha256) throw new AccessRefused('REPRESENTATIONS.json differs from its external anchor');
  checks.push('FREEZE.json and REPRESENTATIONS.json equal their external anchors');
  const freeze = JSON.parse(readFileSync(freezeF, 'utf8')), seal = JSON.parse(readFileSync(sealF, 'utf8'));
  if (seal.freezeSha256 !== fz.data.freezeSha256) throw new AccessRefused('the representation seal does not name the anchored freeze');
  const head = seal.graphHead ?? {}, anchor = sl.data.graph ?? {}, fanchor = fz.data.graph ?? {};
  const count = Number(head.count);
  if (!Number.isInteger(count) || count < 1 || count !== anchor.count || head.lastLineSha256 !== anchor.lastLineSha256) throw new AccessRefused('the seal\'s graph head differs from the externally anchored seal prefix');
  if (!Number.isInteger(fanchor.count) || fanchor.count > count) throw new AccessRefused('the freeze prefix is not inside the seal prefix');
  const { lines, bytesRead } = readLinePrefix(join(exp, 'judgments.ndjson'), count);
  checks.push(`read only the first ${count} graph lines (${bytesRead} bytes)`);
  if (sha(lines[fanchor.count - 1]) !== fanchor.lastLineSha256) throw new AccessRefused(`graph line ${fanchor.count} differs from the external freeze anchor`);
  const tmp = mkdtempSync(join(tmpdir(), 'gw2-prefix-'));
  try {
    const f = join(tmp, 'prefix.ndjson'); writeFileSync(f, lines.join('\n') + '\n');
    const v = verifyGraph(f, { checkRefs: false, anchor: { count, lastLineSha256: anchor.lastLineSha256 } });
    if (!v.ok) throw new AccessRefused(`graph prefix fails verification at line ${v.firstBadLine}: ${v.problems[0]?.problem}`);
    checks.push('graph prefix: structure, hash chain and external anchors verify');
    const bad = v.nodes.filter(n => !(PREFIX_NODE_KINDS as readonly string[]).includes(n.kind) || (n.parents ?? []).some(p => p.relation === 'evaluates'));
    if (bad.length) throw new AccessRefused(`the pre-evaluation prefix contains ${bad.length} node(s) that are not submissions or representations (${[...new Set(bad.map(n => n.kind))].join(', ')})`);
    checks.push(`prefix holds only ${PREFIX_NODE_KINDS.join(', ')} nodes`);
    return { nodes: v.nodes, count, freezeCount: fanchor.count, bytesRead, freeze, seal, preregSha256, checks };
  } finally { rmSync(tmp, { recursive: true, force: true }); }
}

/** An optional feedback partition, bound to the anchored pre-registration by its manifest hash; otherwise refused. */
export function feedbackBinding(exp: string, rec = defaultRecord(exp)) {
  const { prereg, preregSha256 } = anchoredPrereg(rec), mf = join(exp, 'partitions/feedback/MANIFEST.json');
  const bound = prereg.files?.[FEEDBACK_MANIFEST_KEY];
  if (!bound) throw new AccessRefused('feedback: the externally anchored pre-registration binds no feedback partition');
  if (!existsSync(mf)) throw new AccessRefused('feedback: no MANIFEST.json');
  if (fsha(mf) !== bound) throw new AccessRefused('feedback: MANIFEST.json is not the manifest bound by the pre-registration');
  return { manifestSha256: bound as string, preregSha256 };
}
