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
 *  - single writer: one writer per graph at a time. `append` holds `<file>.lock` (created exclusively) for the whole
 *    read-verify-append step and refuses to start while it exists; `expect` (an anchor) refuses an append if the head
 *    moved since the caller read it. This is a local advisory contract, not distributed locking: writers that bypass
 *    `append` are not stopped, only detected by `verify` if they break the chain;
 *  - every parent must already exist in the file (so a cycle cannot be built); ids are unique;
 *  - closed sets: node kinds, relations (supersedes, challenges, refines, alternative-to, evaluates, represents [P4]), author kinds
 *    (agent, verifier, operator, reviewer, test-double), origins (historical-import, live);
 *  - human authors (operator, reviewer) use role-based pseudonyms (operator-01, independent-reviewer-01); an operator
 *    node is an ordinary node with no authority to overwrite or settle anything;
 *  - a node with an `evaluates` parent must carry author id and version, evidence refs, criteria and reason; a node
 *    with any other parent relation must carry a reason;
 *  - Kane attribution: an author id naming Kane must be kind `agent` and carry provenance that references a stored
 *    kane-cli output (stdout and args.json, by hash) and the verbatim submitted note. A test-double author can never
 *    name Kane, and a note whose source is not "kane" can never be attributed to Kane. Execution provenance
 *    (`kaneExecution`) checks that stdout, args and note belong to one run as far as the stored artifacts allow, and
 *    lists what they cannot establish instead of inventing identifiers.
 *
 * Four separate verification levels (`verify`): structural, references, execution provenance, external anchor.
 * What the integrity checks mean. The content-hash id makes an edited node a different node; the per-line chain makes
 * an edited, deleted, inserted or reordered line detectable when another line follows it, and `verify` names the first
 * bad line. Both DETECT accidental or naive changes. Neither PREVENTS a deliberate rewrite: someone who can write the
 * file can recompute every id and hash. Changes confined to the END of the file pass the file-only check: removing
 * trailing lines, or editing the LAST node and recomputing its id (no later line points at it). They are detected
 * only against an anchor kept elsewhere (`head()` → {count, lastLineSha256}, `verify(..., {anchor})`). `head()`
 * refuses to anchor an invalid graph. There are no signatures.
 *
 * Nothing here decides which judgment is true. The read-only `view()` lists relations (evaluated by, challenged by,
 * superseded by, ...) and never ranks, resolves or hides a node. There is no delete or update API.
 */
import { readFileSync, existsSync, appendFileSync, mkdirSync, openSync, writeSync, closeSync, unlinkSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, isAbsolute, join } from 'node:path';
import { ROOT, assertWritableOutput } from './paths.ts';

export const JUDGMENT_SCHEMA = 'gamewatch/gw2-judgment@1';
export const NODE_KINDS = ['finding', 'hypothesis', 'abstention', 'evaluation', 'label', 'challenge', 'correction', 'representation'] as const;
export const RELATIONS = ['supersedes', 'challenges', 'refines', 'alternative-to', 'evaluates', 'represents'] as const;
export const AUTHOR_KINDS = ['agent', 'verifier', 'operator', 'reviewer', 'test-double'] as const;
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

/** Role-based pseudonymous identity for human authors (Q16): e.g. operator-01, independent-reviewer-01. */
export const ROLE_ID = /^[a-z]+(?:-[a-z]+)*-\d{2,}$/;
const HUMAN_KINDS = ['operator', 'reviewer'];
const REDACTED = /^<redacted/;

export type ExecutionProvenance = {
  status: 'consistent' | 'consistent-with-historical-limitations' | 'fail';
  established: string[]; limitations: string[]; failures: string[];
};

/**
 * Execution provenance of a Kane-attributed node: do the stored stdout, args and the note belong to one kane-cli run?
 * Checks only what the stored artifacts support and lists what they cannot establish as limitations; it never invents
 * a missing identifier. Requires the references themselves to be valid (checkReferences).
 *   - stdout has stream_start (cli_version = author version) and run_end; args.json names kane-cli and that version
 *   - the note was submitted by Kane (source "kane", nonceValid) and body.verbatim is that line
 *   - same run: stdout and args in one run directory; note nonce = args nonce; run_end test_url = args --url;
 *     args.startedAt <= stream_start.ts <= note.at <= run_end.ts
 */
export function kaneExecution(n: NodeInput, root = ROOT): ExecutionProvenance {
  const established: string[] = [], limitations: string[] = [], failures: string[] = [], a = n.author, p = n.provenance!;
  const sOut = resolveRef(root, p.kaneStdout.path), sArgs = resolveRef(root, p.kaneArgs.path), sNote = resolveRef(root, p.note.path);
  const events = textLines(sOut).filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return null; } });
  const start = events.find(e => e?.type === 'stream_start'), end = events.find(e => e?.type === 'run_end');
  if (!start) failures.push('kaneStdout: not a kane-cli output (no stream_start event)');
  else if (start.cli_version !== a.version) failures.push(`kaneStdout: stream_start cli_version ${JSON.stringify(start.cli_version)} does not match author version "${a.version}"`);
  else established.push(`stdout stream_start cli_version ${a.version}`);
  if (!end) failures.push('kaneStdout: no run_end event (not a completed kane-cli run)'); else established.push('stdout has run_end');
  let args: Record<string, unknown> = {};
  try { args = JSON.parse(readFileSync(sArgs, 'utf8')); } catch { failures.push('kaneArgs: not JSON'); }
  if (args.cli !== 'kane-cli' || args.version !== a.version) failures.push(`kaneArgs: expected cli "kane-cli" version "${a.version}", found ${JSON.stringify(args.cli)} ${JSON.stringify(args.version)}`);
  else established.push(`args.json kane-cli ${a.version}`);
  const noteLine = textLines(sNote)[(p.note.line ?? 0) - 1];
  let note: Record<string, unknown> = {};
  try { note = JSON.parse(noteLine ?? ''); } catch { failures.push('note: referenced line is not JSON'); }
  if (note.source !== 'kane') failures.push(`note: the submitted note's source is ${JSON.stringify(note.source)}, not "kane"; it cannot be attributed to Kane`);
  if (note.nonceValid !== true) failures.push('note: the submitted note did not carry a valid run nonce');
  if (n.body.verbatim !== noteLine) failures.push('body.verbatim must be the referenced note line, byte for byte');
  // same run
  if (dirname(sOut) !== dirname(sArgs)) failures.push(`kaneStdout and kaneArgs are in different directories (${p.kaneStdout.path}, ${p.kaneArgs.path}); they are not one stored run`);
  else established.push('stdout and args stored in one run directory');
  if (typeof note.nonce === 'string' && typeof args.nonce === 'string') {
    if (note.nonce !== args.nonce) failures.push('note nonce differs from the run nonce in args.json: the note belongs to another run');
    else established.push('note nonce = args.json nonce');
  } else limitations.push(`note↔args nonce link unavailable (${typeof note.nonce !== 'string' ? 'note' : 'args.json'} records no nonce)`);
  const argv = Array.isArray(args.args) ? args.args as unknown[] : [], url = argv[argv.indexOf('--url') + 1];
  const testUrl = end?.test_url;
  if (typeof testUrl === 'string' && !REDACTED.test(testUrl) && typeof url === 'string') {
    if (testUrl !== url) failures.push(`run_end test_url ${testUrl} differs from args --url ${url}`); else established.push('run_end test_url = args --url');
  } else limitations.push(`stdout↔args shared identifier unavailable (${typeof testUrl === 'string' && REDACTED.test(testUrl) ? 'run_end test_url is redacted in the stored copy' : 'no test_url/--url pair'}); stdout↔args linkage rests on the run directory and time order`);
  const t = (x: unknown) => typeof x === 'string' && !Number.isNaN(Date.parse(x)) ? Date.parse(x) : null;
  const seq: [string, number | null][] = [['args.startedAt', t(args.startedAt)], ['stream_start.ts', t(start?.ts)], ['note.at', t(note.at)], ['run_end.ts', t(end?.ts)]];
  const known = seq.filter(([, v]) => v !== null) as [string, number][];
  const order = known.findIndex(([, v], i) => i > 0 && v < known[i - 1][1]);
  if (order > 0) failures.push(`time order violated: ${known[order - 1][0]} is after ${known[order][0]}`);
  else if (known.length === seq.length) established.push('args.startedAt <= stream_start <= note.at <= run_end');
  if (known.length < seq.length) limitations.push(`time containment partial: ${seq.filter(([, v]) => v === null).map(([k]) => k).join(', ')} not recorded`);
  return { status: failures.length ? 'fail' : limitations.length ? 'consistent-with-historical-limitations' : 'consistent', established, limitations, failures };
}

/** Structural rules of one node (no file access). Returns the problems. */
export function checkStructure(n: unknown, known: Map<string, Node>): string[] {
  const bad: string[] = [];
  if (!isObj(n)) return ['node is not an object'];
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
    else if (HUMAN_KINDS.includes(a.kind as string) && !ROLE_ID.test(a.id as string)) bad.push(`author.id "${a.id}" for a ${a.kind} must be a role-based pseudonym such as operator-01 or independent-reviewer-01 (no names)`);
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
    // P4: a structured representation is a separate node that represents exactly one hypothesis; the hypothesis itself
    // is never edited. Only representation nodes may use the represents relation.
    const reps = n.parents.filter(p => isObj(p) && p.relation === 'represents');
    if (n.kind === 'representation') {
      if (reps.length !== 1) bad.push('a representation node must have exactly one parent with relation "represents"');
      else if (known.get(String(reps[0].id))?.kind !== 'hypothesis') bad.push('a representation must represent a hypothesis node');
    } else if (reps.length) bad.push('only a representation node may use the relation "represents"');
  }
  if (isObj(a) && claimsKane(a)) {
    if (a.kind !== 'agent') bad.push(`author "${a.id}" names Kane but has kind "${a.kind}": only an agent author can be Kane${a.kind === 'test-double' ? ' (a test double can never carry the Kane label)' : ''}`);
    const p = n.provenance;
    if (!isObj(p)) bad.push('Kane attribution requires provenance {kaneStdout, kaneArgs, note} referencing a stored kane-cli output');
    else {
      for (const k of Object.keys(p)) if (!['kaneStdout', 'kaneArgs', 'note'].includes(k)) bad.push(`provenance: unknown field "${k}"`);
      for (const k of ['kaneStdout', 'kaneArgs', 'note'] as const) checkRefShape(p[k], `provenance.${k}`, bad);
      if (!isObj(p.note) || p.note.line === undefined) bad.push('provenance.note must reference one line (line + lineSha256)');
    }
  } else if (n.provenance !== undefined) bad.push('provenance (Kane output reference) is only for Kane-attributed nodes; a non-Kane node must not carry a Kane reference');
  if (n.id !== undefined && n.id !== nodeId(n as NodeInput)) bad.push('id is not the content hash of the node');
  return bad;
}

/** Reference verification: every referenced file, line and pointer still matches its recorded hash. */
export function checkReferences(n: NodeInput, root = ROOT): string[] {
  const bad: string[] = [];
  n.evidenceRefs.forEach((r, i) => checkRefContent(r, `evidenceRefs[${i}]`, root, bad));
  if (n.provenance) for (const k of ['kaneStdout', 'kaneArgs', 'note'] as const) checkRefContent(n.provenance[k], `provenance.${k}`, root, bad);
  return bad;
}

/**
 * Validate a node input against the graph so far (structure, then references and Kane execution provenance when
 * checkRefs). Throws JudgmentError with every problem found. Used by append.
 */
export function validateNode(n: unknown, known: Map<string, Node>, opts: { root?: string; checkRefs?: boolean } = {}): NodeInput {
  const root = opts.root ?? ROOT, checkRefs = opts.checkRefs ?? true;
  let bad = checkStructure(n, known);
  if (!bad.length && checkRefs) bad = checkReferences(n as NodeInput, root);
  if (!bad.length && checkRefs && claimsKane((n as NodeInput).author)) bad = kaneExecution(n as NodeInput, root).failures.map(f => `execution provenance: ${f}`);
  if (bad.length) throw new JudgmentError(bad);
  return n as NodeInput;
}

export class AnchorError extends Error {}
const ANCHOR = /^(0:|[1-9]\d*:[0-9a-f]{64})$/;
/** Parse "<count>:<lastLineSha256>" ("0:" for an empty graph). Anything else is refused. */
export function parseAnchor(s: unknown): Anchor {
  if (typeof s !== 'string' || !ANCHOR.test(s)) throw new AnchorError(`malformed anchor ${JSON.stringify(s)}: expected <count>:<64 hex> (or "0:" for an empty graph)`);
  const [c, h] = s.split(':'); return { count: Number(c), lastLineSha256: h || null };
}
function checkAnchor(a: unknown): Anchor {
  if (!isObj(a) || !Number.isSafeInteger(a.count) || (a.count as number) < 0 || ((a.count as number) === 0 ? a.lastLineSha256 !== null : typeof a.lastLineSha256 !== 'string' || !HEX64.test(a.lastLineSha256)) || Object.keys(a).sort().join() !== 'count,lastLineSha256')
    throw new AnchorError(`malformed anchor ${JSON.stringify(a)}: expected {count, lastLineSha256} with a 64-hex hash (null only for count 0)`);
  return a as Anchor;
}

export type Level = 'structural' | 'references' | 'execution-provenance' | 'external-anchor';
export type VerifyResult = {
  ok: boolean; count: number; head: Anchor; firstBadLine: number | null;
  problems: { line: number; level: Level; problem: string }[];
  /** Four separate checks; each says only what it checked. */
  levels: {
    structural: 'pass' | 'fail';
    references: 'pass' | 'fail' | 'not-checked';
    executionProvenance: { status: 'not-checked' | 'not-applicable' | 'consistent' | 'consistent-with-historical-limitations' | 'fail'; nodes: ({ line: number; id: string } & ExecutionProvenance)[] };
    externalAnchor: 'pass' | 'fail' | 'not-checked';
  };
  truncation: 'checked-against-anchor' | 'undetectable-without-anchor';
  nodes: Node[];
};

/**
 * Verify a judgment file at four separate levels:
 *   structural            line format, canonical form, seq, prev chain, content-hash ids, closed sets, parents earlier
 *                         in the file, evaluates/Kane/role-id rules. Detects edits, deletions, insertions, reorderings
 *                         and partial lines, EXCEPT changes confined to the end of the file: removing trailing lines,
 *                         or editing the LAST line and recomputing its id, leaves a valid chain (nothing follows it).
 *   references            (checkRefs) every referenced file/line/pointer still has its recorded hash.
 *   execution provenance  (checkRefs) Kane nodes: stdout, args and note are consistent with one kane-cli run, with
 *                         historical limitations listed (kaneExecution).
 *   external anchor       (anchor) the file still has at least `count` lines and line `count` has the anchored hash:
 *                         detects tail truncation and any rewrite of the anchored prefix, including its last line.
 * The first bad line (1-based) is reported over all levels.
 */
export function verify(file: string, opts: { anchor?: Anchor; checkRefs?: boolean; root?: string } = {}): VerifyResult {
  const anchor = opts.anchor === undefined ? undefined : checkAnchor(opts.anchor);
  const root = opts.root ?? ROOT, problems: VerifyResult['problems'] = [], nodes: Node[] = [], known = new Map<string, Node>();
  const raw = existsSync(file) ? readFileSync(file, 'utf8') : '';
  const lines = raw === '' ? [] : raw.split('\n');
  if (lines.length && lines[lines.length - 1] === '') lines.pop(); else if (lines.length) problems.push({ line: lines.length, level: 'structural', problem: 'last line is not newline-terminated (partial write?)' });
  let prev: string | null = null, broken = false;
  const hashes: string[] = [], lineOf = new Map<string, number>();
  lines.forEach((l, i) => {
    const ln = i + 1, h = sha256(l); hashes.push(h);
    if (broken) { prev = h; return; }
    const fail = (p: string) => { problems.push({ line: ln, level: 'structural', problem: p }); broken = true; };
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
      else { const bad = checkStructure(n, known); if (bad.length) fail(bad.join('; ')); else { known.set(n.id, n); nodes.push(n); lineOf.set(n.id, ln); } }
    }
    prev = h;
  });
  const structural = problems.length ? 'fail' : 'pass';
  let references: VerifyResult['levels']['references'] = 'not-checked';
  const prov: VerifyResult['levels']['executionProvenance'] = { status: 'not-checked', nodes: [] };
  if (opts.checkRefs) {
    references = 'pass';
    for (const n of nodes) {
      const ln = lineOf.get(n.id)!, bad = checkReferences(n, root);
      if (bad.length) { references = 'fail'; for (const b of bad) problems.push({ line: ln, level: 'references', problem: b }); continue; }
      if (claimsKane(n.author)) {
        const e = kaneExecution(n, root); prov.nodes.push({ line: ln, id: n.id, ...e });
        for (const f of e.failures) problems.push({ line: ln, level: 'execution-provenance', problem: f });
      }
    }
    prov.status = !prov.nodes.length ? 'not-applicable' : prov.nodes.some(x => x.status === 'fail') ? 'fail' : prov.nodes.some(x => x.status !== 'consistent') ? 'consistent-with-historical-limitations' : 'consistent';
  }
  let externalAnchor: VerifyResult['levels']['externalAnchor'] = 'not-checked';
  if (anchor) {
    const { count, lastLineSha256 } = anchor;
    externalAnchor = 'pass';
    if (lines.length < count) { externalAnchor = 'fail'; problems.push({ line: lines.length + 1, level: 'external-anchor', problem: `file has ${lines.length} lines but the external anchor records ${count}: lines removed from the end (tail truncation)` }); }
    else if (count > 0 && hashes[count - 1] !== lastLineSha256) { externalAnchor = 'fail'; problems.push({ line: count, level: 'external-anchor', problem: `line ${count} does not match the external anchor (the anchored prefix was rewritten)` }); }
  }
  problems.sort((a, b) => a.line - b.line);
  const headA: Anchor = { count: lines.length, lastLineSha256: hashes.length ? hashes[hashes.length - 1] : null };
  return { ok: !problems.length, count: lines.length, head: headA, firstBadLine: problems.length ? problems[0].line : null, problems,
    levels: { structural, references, executionProvenance: prov, externalAnchor }, truncation: anchor ? 'checked-against-anchor' : 'undetectable-without-anchor', nodes };
}

/**
 * The current {count, lastLineSha256}, to be stored OUTSIDE the file (an operator-controlled record, Q14) so that tail
 * truncation and rewrites can be detected later. Refuses to produce an anchor for a graph that fails structural,
 * reference or execution-provenance verification: an anchor of an invalid graph would look authoritative.
 */
export function head(file: string, opts: { root?: string } = {}): Anchor {
  const v = verify(file, { checkRefs: true, root: opts.root });
  if (!v.ok) throw new JudgmentError([`no anchor produced: the graph fails verification at line ${v.firstBadLine} (${v.problems[0].level}): ${v.problems[0].problem}`]);
  return v.head;
}

/**
 * Append one node. Verifies the existing file first and refuses to extend a file that fails verification. Returns the
 * node id and its seq. Never rewrites existing bytes: the only write is one appended line.
 */
export function append(file: string, input: NodeInput, opts: { root?: string; expect?: Anchor } = {}): { id: string; seq: number } {
  const out = assertWritableOutput(file), lock = out + '.lock';
  mkdirSync(dirname(out), { recursive: true });
  let fd: number;
  try { fd = openSync(lock, 'wx'); }
  catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'EEXIST') throw new JudgmentError([`another writer holds ${lock} (single-writer contract: one writer per graph at a time). If no writer is running, check the graph with verify and remove the stale lock by hand.`]);
    throw e;
  }
  try {
    writeSync(fd, `${process.pid} ${new Date().toISOString()}\n`);
    const v = verify(out, { root: opts.root });
    if (!v.ok) throw new JudgmentError([`refusing to append: the existing file fails verification at line ${v.firstBadLine}: ${v.problems[0].problem}`]);
    if (opts.expect && (checkAnchor(opts.expect).count !== v.head.count || opts.expect.lastLineSha256 !== v.head.lastLineSha256))
      throw new JudgmentError([`refusing to append: the graph head is ${v.head.count}:${v.head.lastLineSha256}, not the expected ${opts.expect.count}:${opts.expect.lastLineSha256} (written by someone else since it was read)`]);
    const known = new Map(v.nodes.map(n => [n.id, n]));
    const { id: _ignored, ...clean } = input as Node;
    validateNode(clean, known, { root: opts.root, checkRefs: true });
    const node = { ...clean, id: nodeId(clean) } as Node;
    if (known.has(node.id)) throw new JudgmentError([`node ${node.id} already exists (identical content); nothing appended`]);
    const line: Line = { schema: JUDGMENT_SCHEMA, seq: v.count + 1, prev: v.head.lastLineSha256, node };
    appendFileSync(out, canonical(line) + '\n');
    return { id: node.id, seq: line.seq };
  } finally { closeSync(fd); unlinkSync(lock); }
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
  try {
    if (cmd === 'head') { const h = head(file); console.log(`${h.count}:${h.lastLineSha256 ?? ''}`); }
    else if (cmd === 'verify') {
      const ai = rest.indexOf('--anchor');
      const anchor = ai >= 0 ? parseAnchor(rest[ai + 1]) : undefined;
      const r = verify(file, { checkRefs: rest.includes('--check-refs'), anchor });
      const L = r.levels, pv = L.executionProvenance;
      console.log(`structural: ${L.structural}\nreferences: ${L.references}\nexecution provenance: ${pv.status}${pv.nodes.flatMap(x => x.limitations.map(l => `\n  line ${x.line} limitation: ${l}`)).join('')}\nexternal anchor: ${L.externalAnchor}${L.externalAnchor === 'not-checked' ? ' (tail truncation and a rewritten last line are undetectable without one)' : ''}`);
      console.log(r.ok ? `judgments OK: ${r.count} lines, head ${r.head.count}:${r.head.lastLineSha256 ?? ''}` : `judgments INVALID at line ${r.firstBadLine}:\n  ${r.problems.map(p => `line ${p.line} [${p.level}]: ${p.problem}`).join('\n  ')}`);
      process.exit(r.ok ? 0 : 1);
    } else if (cmd === 'append') {
      const r = append(file, JSON.parse(readFileSync(rest[0], 'utf8'))); console.log(`appended ${r.id} as line ${r.seq}`);
    } else { console.error(`unknown command ${cmd}`); process.exit(2); }
  } catch (e) { console.error((e as Error).message); process.exit(e instanceof AnchorError ? 2 : 5); }
}
