/**
 * GW2 Extension V0: input layer shared by the three outputs (D121).
 *
 * Every partition read goes through a reader that is created with an explicit allow-list of partitions. A partition
 * outside the list is refused before any byte is read (AccessRefused); a file is returned only if its bytes match its
 * partition manifest, and that manifest matches the one bound by the freeze (or, for an optional `feedback` partition,
 * one that declares itself as feedback evidence, uses discovery build ids only, and whose manifest hash the externally
 * anchored pre-registration lists: anchored.ts feedbackBinding, D130). Every read is recorded, so tests
 * can check which partitions an output touched.
 *
 * Hypotheses and representations come from the judgment graph PREFIX up to the representation seal, authenticated
 * against the external record (anchored.ts): evaluation nodes appended afterwards are never read, loaded or parsed.
 */
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { type Node } from '../judgments.ts';
import { authenticatedPrefix, feedbackBinding } from './anchored.ts';
import { AccessRefused } from './errors.ts';
import { extractSituations, alignBuilds, type Situation } from '../situations.ts';
import { checkRepresentation } from '../hypothesis.ts';

export type Partition = 'discovery' | 'heldout' | 'spec' | 'eval' | 'feedback';
export { AccessRefused };
const sha = (b: Buffer | string) => createHash('sha256').update(b).digest('hex');
const json = (f: string) => JSON.parse(readFileSync(f, 'utf8'));

export function partitionReader(exp: string, allowed: readonly Partition[], o: { rec?: string; manifests?: Partial<Record<Partition, string>> } = {}) {
  // o.manifests (matched comparison, D139): manifest hashes bound by an anchored pre-registration instead of a P7 freeze
  const freeze = o.manifests ? { manifests: o.manifests } : json(join(exp, 'hypotheses/FREEZE.json')), reads: string[] = [];
  let feedbackBound = false;
  const read = (p: Partition, file: string): string => {
    if (!allowed.includes(p)) throw new AccessRefused(`partition ${p} is not authorized for this output (allowed: ${allowed.join(', ') || 'none'})`);
    const dir = join(exp, 'partitions', p), mf = join(dir, 'MANIFEST.json');
    if (!existsSync(mf)) throw new AccessRefused(`${p}: no MANIFEST.json`);
    const m = json(mf);
    if (p === 'feedback' && o.manifests) throw new AccessRefused('feedback: no feedback partition in the matched comparison (discovery-only feedback)');
    if (p === 'feedback') {
      if (m.role !== 'feedback') throw new AccessRefused('feedback: the manifest does not declare role "feedback"');
      if (!feedbackBound) { feedbackBinding(exp, o.rec); feedbackBound = true; } // D130: bound by the anchored pre-registration
    }
    else if (sha(readFileSync(mf)) !== freeze.manifests?.[p]) throw new AccessRefused(`${p}/MANIFEST.json is not the manifest bound by the freeze`);
    if (!m.files || !Object.prototype.hasOwnProperty.call(m.files, file)) throw new AccessRefused(`${p}/${file}: not in the partition manifest`);
    const buf = readFileSync(join(dir, file));
    if (sha(buf) !== m.files[file]) throw new AccessRefused(`${p}/${file}: differs from its manifest`);
    reads.push(`${p}/${file}`);
    return buf.toString('utf8');
  };
  return { read, reads, allowed };
}
export type Reader = ReturnType<typeof partitionReader>;

export type Hyp = {
  id: string; ref: string; kind: string; session: string; index: number;
  statement: string; confidence: string; evidence: string; structured: unknown; verbatim: string;
  representations: { id: string; origin: string; fidelity: string; author: string; representation: unknown; status: string; clauses: any[] }[];
};

/**
 * Frozen hypotheses and abstentions with their sealed representations, from the AUTHENTICATED graph prefix at the seal
 * (anchored.ts, D129): only the first N lines are read, N anchored externally; no later node is loaded or parsed.
 */
export function loadSubmissions(exp: string, rec?: string): { hyps: Hyp[]; graphPrefix: number; frozen: number; prefixBytes: number } {
  const p = authenticatedPrefix(exp, rec);
  return { ...submissionsFromPrefix(p.nodes, p.freeze, p.seal), graphPrefix: p.count, prefixBytes: p.bytesRead };
}

export function submissionsFromPrefix(nodes: Node[], freeze: any, seal: any): { hyps: Hyp[]; frozen: number } {
  const byId = new Map(nodes.map(n => [n.id, n]));
  const frozen = new Set<string>(freeze.hypotheses.map((h: any) => h.id));
  const hyps = nodes.filter(n => frozen.has(n.id)).map(n => {
    const b = n.body as any;
    return { id: n.id, ref: String(b.ref ?? ''), kind: n.kind, session: String(b.session ?? ''), index: Number(b.index ?? -1),
      statement: String(b.statement ?? ''), confidence: String(b.confidence ?? ''), evidence: String(b.evidence ?? ''), structured: b.structured ?? null, verbatim: String(b.verbatim ?? ''),
      representations: (seal.representations as any[]).filter(r => r.hypothesis === n.id).map(r => {
        const x = byId.get(r.id); if (!x) throw new Error(`sealed representation ${r.id} is not in the graph prefix`);
        const rb = x.body as any, chk = checkRepresentation(rb.representation);
        return { id: r.id, origin: r.origin, fidelity: rb.fidelity?.declared ?? 'unknown', author: `${x.author.kind}:${x.author.id}`, representation: rb.representation, status: chk.status, clauses: chk.clauses.flatMap(c => c.ok ? [c.clause] : []) };
      }) };
  });
  if (hyps.length !== frozen.size) throw new Error(`the graph prefix holds ${hyps.length} of ${frozen.size} frozen submissions`);
  return { hyps, frozen: frozen.size };
}

export type Sits = Partial<Record<'discovery' | 'heldout' | 'feedback', Situation[]>>;
export type BuildLabels = Record<string, { label: string | null; heldoutIds: string[] }>;

/**
 * Situations per partition. Discovery and feedback keep the build ids the agent saw. Held-out builds are aligned to
 * discovery ids through eval/ (operator side only: needs 'eval' in the allow-list).
 */
export function loadSituations(reader: Reader, partitions: ('discovery' | 'heldout' | 'feedback')[]): { sits: Sits; labels: BuildLabels } {
  const sits: Sits = {}, labels: BuildLabels = {};
  const disc = JSON.parse(reader.read('discovery', 'observations.json'));
  const discBuilds = new Set<string>(disc.builds);
  for (const b of disc.builds) labels[b] = { label: null, heldoutIds: [] };
  let evalMap: any = null;
  if (partitions.includes('heldout') || reader.allowed.includes('eval')) evalMap = JSON.parse(reader.read('eval', 'eval.json')).idMaps;
  if (evalMap) for (const [b, l] of Object.entries(evalMap.discovery?.builds ?? {})) if (labels[b]) labels[b].label = String(l);
  for (const p of partitions) {
    if (p === 'discovery') { sits.discovery = extractSituations(disc); continue; }
    const obs = JSON.parse(reader.read(p, 'observations.json'));
    if (p === 'feedback') {
      const foreign = (obs.builds as string[]).filter(b => !discBuilds.has(b));
      if (foreign.length) throw new AccessRefused(`feedback evidence names builds the agent never saw: ${foreign.join(', ')}`);
      sits.feedback = extractSituations(obs); continue;
    }
    const al = alignBuilds(extractSituations(obs), evalMap[p]?.builds ?? {}, evalMap.discovery?.builds ?? {});
    for (const [orig, a] of Object.entries(al.alignment as Record<string, { discoveryId?: string }>)) if (a.discoveryId && labels[a.discoveryId]) labels[a.discoveryId].heldoutIds.push(orig);
    sits.heldout = al.sits;
  }
  for (const l of Object.values(labels)) l.heldoutIds.sort();
  return { sits, labels };
}

export const builds = (sits: Situation[] | undefined) => [...new Set((sits ?? []).map(s => s.build))].sort();
export const unitOf = (s: Situation) => s.source.id;
export const canon = (x: unknown): string => JSON.stringify(x, (_k, v) => v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.keys(v).sort().map(k => [k, v[k]])) : v);
export const idOf = (x: unknown) => sha(canon(x)).slice(0, 16);
