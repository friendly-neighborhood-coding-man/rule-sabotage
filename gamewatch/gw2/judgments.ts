/**
 * GW2 judgment and hypothesis graph (`gamewatch/gw2-judgment@1`), P2. Append, read, verify; nothing else.
 *
 *   node --experimental-strip-types --no-warnings gamewatch/gw2/judgments.ts verify <judgments.ndjson> [--check-refs] [--anchor <count>:<lineSha256>]
 *   node --experimental-strip-types --no-warnings gamewatch/gw2/judgments.ts head   <judgments.ndjson>
 *   node --experimental-strip-types --no-warnings gamewatch/gw2/judgments.ts append <judgments.ndjson> <node.json>
 *
 * One NDJSON file per experiment. Each line is `{schema, seq, prev, node}`:
 *   seq   1, 2, 3, ... in file order
 *   prev  SHA-256 of the previous line's bytes (without its newline); null on line 1
 *   node  { id, kind, parents: [{id, relation}], author: {kind, id, version}, origin, at, evidenceRefs, criteria?,
 *           reason?, body, provenance? }; id = SHA-256 of the canonical JSON of the node without `id`.
 *
 * Rules (each refused with a reason, never repaired):
 *  - append-only: an append re-verifies the whole file first, refuses to extend a file that fails verification, and
 *    only ever adds bytes at the end (the existing bytes are never rewritten);
 *  - every parent must already exist in the file (so a cycle cannot be built); ids are unique;
 *  - closed sets: node kinds, relations (supersedes, challenges, refines, alternative-to, evaluates), author kinds
 *    (agent, verifier, operator, test-double), origins (historical-import, live);
 *  - a node with an `evaluates` parent must carry author id and version, evidence refs, criteria and reason; a node
 *    with any other parent relation must carry a reason;
 *  - Kane attribution: an author id naming Kane must be kind `agent` and carry provenance that references a stored
 *    kane-cli output (stdout with stream_start/run_end and args.json, both by hash, both naming the author's version)
 *    and the verbatim submitted note (source "kane", nonceValid). A test-double author can never name Kane, and a note
 *    whose source is not "kane" can never be attributed to Kane.
 *
 * What the integrity checks mean. The content-hash id makes an edited node a different node (its children then point
 * at an id that no longer exists); the per-line chain makes an edited, deleted, inserted or reordered line detectable
 * and `verify` names the first bad line. Both DETECT accidental or naive changes. Neither PREVENTS a deliberate
 * rewrite: someone who can write the file can recompute every id and hash. Removing lines from the END of the file
 * leaves a valid shorter chain and is undetectable from the file alone; it is detected only against an anchor kept
 * elsewhere (`head()` → {count, lastLineSha256}, checked with `verify(..., {anchor})`). There are no signatures.
 *
 * Nothing here decides which judgment is true. The read-only `view()` lists relations (evaluated by, challenged by,
 * superseded by, ...) and never ranks, resolves or hides a node. There is no delete or update API.
 */
import { readFileSync, existsSync, appendFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, isAbsolute, join } from 'node:path';
import { ROOT, assertWritableOutput } from './paths.ts';

export const JUDGMENT_SCHEMA = 'gamewatch/gw2-judgment@1';
export const NODE_KINDS = ['finding', 'hypothesis', 'evaluation', 'label', 'challenge', 'correction'] as const;
export const RELATIONS = ['supersedes', 'challenges', 'refines', 'alternative-to', 'evaluates'] as const;
export const AUTHOR_KINDS = ['agent', 'verifier', 'operator', 'test-double'] as const;
export const ORIGINS = ['historical-import', 'live'] as const;

export type Relation = typeof RELATIONS[number];
export type EvidenceRef = { path: string; sha256: string; line?: number; lineSha256?: string; pointer?: string };
export type Author = { kind: typeof AUTHOR_KINDS[number]; id: string; version: string };
export type KaneProvenance = { kaneStdout: EvidenceRef; kaneArgs: EvidenceRef; note: EvidenceRef };
export type NodeInput = {
  kind: typeof NODE_KINDS[number]; parents: { id: string; relation: Relation }[]; author: Author;
  origin: typeof ORIGINS[number]; at: string; evidenceRefs: EvidenceRef[]; criteria?: string; reason?: string;
  body: Record<string, unknown>; provenance?: KaneProvenance;
};
export type Node = NodeInput & { id: string };
export type Line = { schema: typeof JUDGMENT_SCHEMA; seq: number; prev: string | null; node: Node };
export type Anchor = { count: number; lastLineSha256: string | null };

export class JudgmentError extends Error {
  problems: string[];
  constructor(problems: string[]) { super(`judgment refused:\n  ${problems.join('\n  ')}`); this.problems = problems; }
}

export const sha256 = (b: string | Buffer) => createHash('sha256').update(b).digest('hex');
/** Same convention as the GW1 freeze records and the baseline manifest's sha256LF. */
export const fileSha256 = (abs: string) => { const b = readFileSync(abs); return sha256(b.includes(0) ? b : Buffer.from(b.toString('utf8').replace(/\r\n/g, '\n'), 'utf8')); };
const textLines = (abs: string) => readFileSync(abs, 'utf8').replace(/\r\n/g, '\n').split('\n');

/** Canonical JSON: object keys sorted, no whitespace. */
export function canonical(x: unknown): string {
  if (Array.isArray(x)) return `[${x.map(canonical).join(',')}]`;
  if (x && typeof x === 'object') return `{${Object.keys(x).sort().filter(k => (x as Record<string, unknown>)[k] !== undefined).map(k => `${JSON.stringify(k)}:${canonical((x as Record<string, unknown>)[k])}`).join(',')}}`;
  return JSON.stringify(x);
}
export const nodeId = (n: NodeInput | Node) => { const { id: _drop, ...rest } = n as Node; return sha256(canonical(rest)); };

const KANE = /kane/i;
const HEX64 = /^[0-9a-f]{64}$/;
const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
const str = (x: unknown) => typeof x === 'string' && x.trim().length > 0;
const resolveRef = (root: string, p: string) => isAbsolute(p) ? p : join(root, p);

/** Is this author attributed to Kane? Any author id that names Kane counts, whatever its kind. */
export const claimsKane = (a: { id?: unknown }) => typeof a.id === 'string' && KANE.test(a.id);

function checkRefShape(r: unknown, at: string, bad: string[]) {
  if (!isObj(r)) { bad.push(`${at} is not an object`); return; }
  for (const k of Object.keys(r)) if (!['path', 'sha256', 'line', 'lineSha256', 'pointer'].includes(k)) bad.push(`${at}: unknown field "${k}"`);
  if (!str(r.path)) bad.push(`${at}: path is required`);
  if (typeof r.sha256 !== 'string' || !HEX64.test(r.sha256)) bad.push(`${at}: sha256 must be 64 hex characters`);
  if (r.line !== undefined && (!Number.isInteger(r.line) || (r.line as number) < 1)) bad.push(`${at}: line must be a positive integer`);
  if ((r.line === undefined) !== (r.lineSha256 === undefined)) bad.push(`${at}: line and lineSha256 go together`);
  if (r.pointer !== undefined && (typeof r.pointer !== 'string' || !r.pointer.startsWith('/'))) bad.push(`${at}: pointer must be a JSON pointer`);
}

/** Check a reference against the file it names. Returns the referenced line (if any) or null. */
function checkRefContent(r: EvidenceRef, at: string, root: string, bad: string[]): string | null {
  const abs = resolveRef(root, r.path);
  if (!existsSync(abs)) { bad.push(`${at}: referenced file not found: ${r.path}`); return null; }
  if (fileSha256(abs) !== r.sha256) { bad.push(`${at}: ${r.path} does not match its recorded sha256`); return null; }
  if (r.pointer !== undefined) {
    let v: unknown = JSON.parse(readFileSync(abs, 'utf8'));
    for (const seg of r.pointer.split('/').slice(1).map(s => s.replace(/~1/g, '/').replace(/~0/g, '~'))) v = isObj(v) || Array.isArray(v) ? (v as Record<string, unknown>)[seg] : undefined;
    if (v === undefined) bad.push(`${at}: pointer ${r.pointer} not found in ${r.path}`);
  }
  if (r.line === undefined) return null;
  const line = textLines(abs)[r.line - 1];
  if (line === undefined || sha256(line) !== r.lineSha256) { bad.push(`${at}: line ${r.line} of ${r.path} does not match its recorded lineSha256`); return null; }
  return line;
}

/** Kane provenance: a stored kane-cli output, by hash, naming the author's version, and the verbatim Kane note. */
function checkKane(n: NodeInput, root: string, checkRefs: boolean, bad: string[]) {
  const a = n.author;
  if (a.kind !== 'agent') bad.push(`author "${a.id}" names Kane but has kind "${a.kind}": only an agent author can be Kane${a.kind === 'test-double' ? ' (a test double can never carry the Kane label)' : ''}`);
  const p = n.provenance;
  if (!isObj(p)) { bad.push('Kane attribution requires provenance {kaneStdout, kaneArgs, note} referencing a stored kane-cli output'); return; }
  for (const k of Object.keys(p)) if (!['kaneStdout', 'kaneArgs', 'note'].includes(k)) bad.push(`provenance: unknown field "${k}"`);
  for (const k of ['kaneStdout', 'kaneArgs', 'note'] as const) checkRefShape(p[k], `provenance.${k}`, bad);
  if (!isObj(p.note) || p.note.line === undefined) bad.push('provenance.note must reference one line (line + lineSha256)');
  if (bad.length || !checkRefs) return;
  const sOut = resolveRef(root, p.kaneStdout.path), sArgs = resolveRef(root, p.kaneArgs.path);
  const before = bad.length;
  checkRefContent(p.kaneStdout, 'provenance.kaneStdout', root, bad); checkRefContent(p.kaneArgs, 'provenance.kaneArgs', root, bad);
  const noteLine = checkRefContent(p.note, 'provenance.note', root, bad);
  if (bad.length > before) return;
  const events = textLines(sOut).filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return null; } });
  const start = events.find(e => e?.type === 'stream_start');
  if (!start) bad.push('provenance.kaneStdout: not a kane-cli output (no stream_start event)');
  else if (start.cli_version !== a.version) bad.push(`provenance.kaneStdout: stream_start cli_version ${JSON.stringify(start.cli_version)} does not match author version "${a.version}"`);
  if (!events.some(e => e?.type === 'run_end')) bad.push('provenance.kaneStdout: no run_end event (not a completed kane-cli run)');
  let args: Record<string, unknown> = {};
  try { args = JSON.parse(readFileSync(sArgs, 'utf8')); } catch { bad.push('provenance.kaneArgs: not JSON'); }
  if (args.cli !== 'kane-cli' || args.version !== a.version) bad.push(`provenance.kaneArgs: expected cli "kane-cli" version "${a.version}", found ${JSON.stringify(args.cli)} ${JSON.stringify(args.version)}`);
  let note: Record<string, unknown> = {};
  try { note = JSON.parse(noteLine ?? ''); } catch { bad.push('provenance.note: referenced line is not JSON'); }
  if (note.source !== 'kane') bad.push(`provenance.note: the submitted note's source is ${JSON.stringify(note.source)}, not "kane"; it cannot be attributed to Kane`);
  if (note.nonceValid !== true) bad.push('provenance.note: the submitted note did not carry a valid run nonce');
  if (n.body.verbatim !== noteLine) bad.push('body.verbatim must be the referenced note line, byte for byte');
}

/**
 * Validate a node input against the graph so far. `known` maps existing ids to their nodes. Throws JudgmentError
 * with every problem found.
 */
export function validateNode(n: unknown, known: Map<string, Node>, opts: { root?: string; checkRefs?: boolean } = {}): NodeInput {
  const root = opts.root ?? ROOT, checkRefs = opts.checkRefs ?? true, bad: string[] = [];
  if (!isObj(n)) throw new JudgmentError(['node is not an object']);
  const allowed = ['id', 'kind', 'parents', 'author', 'origin', 'at', 'evidenceRefs', 'criteria', 'reason', 'body', 'provenance'];
  for (const k of Object.keys(n)) if (!allowed.includes(k)) bad.push(`unknown node field "${k}"`);
  if (!NODE_KINDS.includes(n.kind as NodeInput['kind'])) bad.push(`kind must be one of ${NODE_KINDS.join(', ')}`);
  if (!ORIGINS.includes(n.origin as NodeInput['origin'])) bad.push(`origin must be one of ${ORIGINS.join(', ')}`);
  if (typeof n.at !== 'string' || Number.isNaN(Date.parse(n.at))) bad.push('at must be an ISO date or date-time');
  if (!isObj(n.body)) bad.push('body must be an object');
  for (const k of ['criteria', 'reason'] as const) if (n[k] !== undefined && !str(n[k])) bad.push(`${k} must be a non-empty string when present`);
  const a = n.author;
  if (!isObj(a)) bad.push('author is required');
  else {
    for (const k of Object.keys(a)) if (!['kind', 'id', 'version'].includes(k)) bad.push(`author: unknown field "${k}"`);
    if (!AUTHOR_KINDS.includes(a.kind as Author['kind'])) bad.push(`author.kind must be one of ${AUTHOR_KINDS.join(', ')}`);
    if (!str(a.id)) bad.push('author.id is required');
    if (!str(a.version)) bad.push('author.version is required');
  }
  if (!Array.isArray(n.evidenceRefs)) bad.push('evidenceRefs must be an array');
  else n.evidenceRefs.forEach((r, i) => checkRefShape(r, `evidenceRefs[${i}]`, bad));
  if (!Array.isArray(n.parents)) bad.push('parents must be an array');
  else {
    const seen = new Set<string>();
    n.parents.forEach((p, i) => {
      if (!isObj(p)) { bad.push(`parents[${i}] is not an object`); return; }
      for (const k of Object.keys(p)) if (!['id', 'relation'].includes(k)) bad.push(`parents[${i}]: unknown field "${k}"`);
      if (!RELATIONS.includes(p.relation as Relation)) bad.push(`parents[${i}]: relation must be one of ${RELATIONS.join(', ')}`);
      if (typeof p.id !== 'string' || !known.has(p.id)) bad.push(`parents[${i}]: parent ${JSON.stringify(p.id)} does not exist in this graph (parents must be appended first)`);
      const key = `${p.id} ${p.relation}`;
      if (seen.has(key)) bad.push(`parents[${i}]: duplicate parent`); seen.add(key);
    });
    const rels = new Set(n.parents.filter(isObj).map(p => p.relation));
    if (rels.has('evaluates')) {
      const miss = [!isObj(a) || !str(a.id) ? 'evaluator id' : '', !isObj(a) || !str(a.version) ? 'evaluator version' : '', !Array.isArray(n.evidenceRefs) || !n.evidenceRefs.length ? 'evidence refs' : '', !str(n.criteria) ? 'criteria' : '', !str(n.reason) ? 'reason' : ''].filter(Boolean);
      if (miss.length) bad.push(`an evaluates node must record ${miss.join(', ')}`);
    } else if (n.parents.length && !str(n.reason)) bad.push('a node linked to an earlier judgment must state a reason');
  }
  if (n.provenance !== undefined && !(isObj(a) && claimsKane(a))) bad.push('provenance (Kane output reference) is only for Kane-attributed nodes; a non-Kane node must not carry a Kane reference');
  if (!bad.length && isObj(a) && claimsKane(a)) checkKane(n as NodeInput, root, checkRefs, bad);
  if (!bad.length && checkRefs) (n.evidenceRefs as EvidenceRef[]).forEach((r, i) => checkRefContent(r, `evidenceRefs[${i}]`, root, bad));
  if (n.id !== undefined && n.id !== nodeId(n as NodeInput)) bad.push('id is not the content hash of the node');
  if (bad.length) throw new JudgmentError(bad);
  return n as NodeInput;
}

export type VerifyResult = {
  ok: boolean; count: number; head: Anchor; firstBadLine: number | null; problems: { line: number; problem: string }[];
  truncation: 'checked-against-anchor' | 'undetectable-without-anchor';
  nodes: Node[];
};

/**
 * Verify a judgment file: line format, seq, chain, content-hash ids, closed sets, parents earlier in the file, the
 * evaluates/Kane rules, and (checkRefs) that every referenced file still has its recorded hash. With an anchor (a
 * {count, lastLineSha256} recorded elsewhere) it also detects removal of lines from the end, and any rewrite of the
 * anchored prefix. Reports the first bad line (1-based).
 */
export function verify(file: string, opts: { anchor?: Anchor; checkRefs?: boolean; root?: string } = {}): VerifyResult {
  const problems: { line: number; problem: string }[] = [], nodes: Node[] = [], known = new Map<string, Node>();
  const raw = existsSync(file) ? readFileSync(file, 'utf8') : '';
  const lines = raw === '' ? [] : raw.split('\n');
  if (lines.length && lines[lines.length - 1] === '') lines.pop(); else if (lines.length) problems.push({ line: lines.length, problem: 'last line is not newline-terminated (partial write?)' });
  let prev: string | null = null, broken = false;
  const hashes: string[] = [];
  lines.forEach((l, i) => {
    const ln = i + 1, h = sha256(l); hashes.push(h);
    if (broken) { prev = h; return; }
    const fail = (p: string) => { problems.push({ line: ln, problem: p }); broken = true; };
    let x: Record<string, unknown>;
    try { x = JSON.parse(l); } catch { fail('not JSON'); prev = h; return; }
    if (canonical(x) !== l) fail('line is not in canonical form');
    else if (x.schema !== JUDGMENT_SCHEMA) fail(`schema is not ${JUDGMENT_SCHEMA}`);
    else if (Object.keys(x).sort().join() !== 'node,prev,schema,seq') fail('line must have exactly schema, seq, prev, node');
    else if (x.seq !== ln) fail(`seq ${x.seq} where ${ln} expected (line inserted, deleted or reordered)`);
    else if (x.prev !== prev) fail('prev does not match the previous line (line edited, deleted, inserted or reordered)');
    else {
      const n = x.node as Node;
      if (!isObj(n) || typeof n.id !== 'string') fail('node has no id');
      else if (known.has(n.id)) fail(`duplicate node id ${n.id}`);
      else {
        try { validateNode(n, known, { root: opts.root, checkRefs: opts.checkRefs ?? false }); known.set(n.id, n); nodes.push(n); }
        catch (e) { fail(e instanceof JudgmentError ? e.problems.join('; ') : String(e)); }
      }
    }
    prev = h;
  });
  const head: Anchor = { count: lines.length, lastLineSha256: hashes.length ? hashes[hashes.length - 1] : null };
  if (opts.anchor) {
    const { count, lastLineSha256 } = opts.anchor;
    if (lines.length < count) problems.push({ line: lines.length + 1, problem: `file has ${lines.length} lines but the external anchor records ${count}: lines removed from the end (tail truncation)` });
    else if (count > 0 && hashes[count - 1] !== lastLineSha256) problems.push({ line: count, problem: `line ${count} does not match the external anchor (the anchored prefix was rewritten)` });
  }
  problems.sort((a, b) => a.line - b.line);
  return { ok: !problems.length, count: lines.length, head, firstBadLine: problems.length ? problems[0].line : null, problems, truncation: opts.anchor ? 'checked-against-anchor' : 'undetectable-without-anchor', nodes };
}

/** The current {count, lastLineSha256}: store it OUTSIDE the file (PR, report, operator note) to detect tail truncation later. */
export const head = (file: string): Anchor => verify(file).head;

/**
 * Append one node. Verifies the existing file first and refuses to extend a file that fails verification. Returns the
 * node id and its seq. Never rewrites existing bytes: the only write is one appended line.
 */
export function append(file: string, input: NodeInput, opts: { root?: string; checkRefs?: boolean } = {}): { id: string; seq: number } {
  const out = assertWritableOutput(file);
  const v = verify(out, { root: opts.root });
  if (!v.ok) throw new JudgmentError([`refusing to append: the existing file fails verification at line ${v.firstBadLine}: ${v.problems[0].problem}`]);
  const known = new Map(v.nodes.map(n => [n.id, n]));
  const { id: _ignored, ...clean } = input as Node;
  validateNode(clean, known, opts);
  const node = { ...clean, id: nodeId(clean) } as Node;
  if (known.has(node.id)) throw new JudgmentError([`node ${node.id} already exists (identical content); nothing appended`]);
  const line: Line = { schema: JUDGMENT_SCHEMA, seq: v.count + 1, prev: v.head.lastLineSha256, node };
  mkdirSync(dirname(out), { recursive: true });
  appendFileSync(out, canonical(line) + '\n');
  return { id: node.id, seq: line.seq };
}

/**
 * Read-only relation view. For each node: who evaluates, challenges, supersedes, refines or offers an alternative to
 * it. Every node is listed, superseded and challenged ones included; nothing is ranked, resolved or declared final.
 */
export function view(file: string) {
  const v = verify(file);
  const incoming = new Map<string, Record<Relation, string[]>>();
  for (const n of v.nodes) incoming.set(n.id, { supersedes: [], challenges: [], refines: [], 'alternative-to': [], evaluates: [] });
  for (const n of v.nodes) for (const p of n.parents) incoming.get(p.id)?.[p.relation].push(n.id);
  return {
    integrity: { ok: v.ok, firstBadLine: v.firstBadLine, count: v.count, head: v.head, truncation: v.truncation },
    note: 'Relations only. No node is ranked, resolved or declared final; superseded and challenged nodes stay readable.',
    nodes: v.nodes.map(n => {
      const r = incoming.get(n.id)!;
      return { id: n.id, kind: n.kind, author: n.author, origin: n.origin, at: n.at, parents: n.parents,
        evaluatedBy: r.evaluates, challengedBy: r.challenges, supersededBy: r.supersedes, refinedBy: r.refines, alternatives: r['alternative-to'] };
    }),
  };
}

if (process.argv[1]?.endsWith('gw2/judgments.ts')) {
  const [cmd, file, ...rest] = process.argv.slice(2);
  if (!cmd || !file) { console.error('usage: judgments.ts verify|head|append <judgments.ndjson> [...]'); process.exit(2); }
  if (cmd === 'head') console.log(JSON.stringify(head(file)));
  else if (cmd === 'verify') {
    const ai = rest.indexOf('--anchor'), a = ai >= 0 ? rest[ai + 1]?.split(':') : undefined;
    const r = verify(file, { checkRefs: rest.includes('--check-refs'), anchor: a ? { count: Number(a[0]), lastLineSha256: a[1] || null } : undefined });
    console.log(r.ok ? `judgments OK: ${r.count} lines, head ${r.head.count}:${r.head.lastLineSha256}; tail truncation ${r.truncation}` : `judgments INVALID at line ${r.firstBadLine}:\n  ${r.problems.map(p => `line ${p.line}: ${p.problem}`).join('\n  ')}`);
    process.exit(r.ok ? 0 : 1);
  } else if (cmd === 'append') {
    try { const r = append(file, JSON.parse(readFileSync(rest[0], 'utf8'))); console.log(`appended ${r.id} as line ${r.seq}`); }
    catch (e) { console.error((e as Error).message); process.exit(5); }
  } else { console.error(`unknown command ${cmd}`); process.exit(2); }
}
