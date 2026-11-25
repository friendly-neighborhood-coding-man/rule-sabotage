/**
 * GW2 P3: explicit, deterministic import of one finished review session into a judgment graph (Q15, D40).
 *
 *   node --experimental-strip-types --no-warnings gamewatch/gw2/import-session.ts <sessionDir> <judgments.ndjson>
 *        [--completeness <completeness.json>] [--coverage <coverage.json>] [--kane-stdout <f> --kane-args <f>]
 *
 * The review server (gamewatch/gw2/serve.ts) never touches the graph. Only a CLOSED session (CLOSED.json, a valid seal;
 * gamewatch/gw2/session-close.ts) is imported, whatever its logging condition. This step appends:
 *   one `finding` node per notes.ndjson line and one `hypothesis` or `abstention` node per hypotheses.ndjson line,
 *     ALL of them: invalid-nonce, journal-mismatch and unverified submissions included. Each node quotes its line
 *     verbatim, references it by file + line hash, and records the P1 verification status, whether it counts, and the
 *     session's experimental validity. Nothing is promoted: an unverified submission stays labelled unverified.
 *   `alternative-to` links for hypotheses the submitter declared as competing (competingWith: H-<n>).
 *   separate `evaluation` nodes for a completeness and a coverage assessment, when given and when there is a node to
 *     evaluate (otherwise recorded as not applicable).
 * Authors: a test-double session's submissions are test-double nodes; a submission whose nonce was not this session's
 * is an `unverified-submitter`; a Kane session needs the stored Kane stdout/args (Kane provenance is checked by
 * judgments.ts) and is refused without them. No other label is accepted.
 * Idempotent and resumable: node contents are deterministic (no import time), nodes already in the graph are skipped,
 * so re-running after a partial import appends exactly the missing nodes. A graph node of the same session line with
 * different content is a conflict and stops the import before anything is written.
 * `sessionImportStatus` lets the freeze step (freeze.ts) refuse to freeze while any session is not fully imported, so
 * the import cannot be silently omitted.
 */
import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { ROOT, repoRelative, assertWritableOutput } from './paths.ts';
import { sessionClosure } from './session-close.ts';
import { loadSession, experimentalValidity, type SessionFinding } from './session.ts';
import { append, verify, nodeId, fileSha256, sha256, type NodeInput, type Author } from './judgments.ts';

export class ImportError extends Error {}
export type ImportOptions = { root?: string; kane?: { stdout: string; args: string }; completeness?: string; coverage?: string };

const refPath = (abs: string, root: string) => (root === ROOT ? repoRelative(abs) : null) ?? abs;

/** The deterministic list of nodes this session imports to, in order. */
export function planSessionImport(sessionDir: string, opts: ImportOptions = {}) {
  const root = opts.root ?? ROOT, s = loadSession(sessionDir), meta = s.meta as Record<string, unknown>;
  const validity = experimentalValidity(s);
  const label = String(meta.label);
  if (!['test-double', 'kane'].includes(label)) throw new ImportError(`session label "${label}" is not importable (test-double or kane only)`);
  if (label === 'kane' && !opts.kane) throw new ImportError('a Kane session needs the stored Kane stdout and args (--kane-stdout, --kane-args); Kane-labelled submissions are never imported without provenance');
  // P3 correction (Q19): explicit closure is required for every session, logging-disabled ones included.
  const closure = sessionClosure(sessionDir);
  if (closure.status !== 'closed') throw new ImportError(`session ${meta.session} is not closed (${closure.status}: ${closure.problems.join('; ')}); close it (server close, or session-close.ts declare) before import`);
  const server = meta.server as { name?: string; version?: string } | undefined;
  const lineRef = (file: string, i: number, line: string) => ({ path: refPath(file, root), sha256: fileSha256(file), line: i + 1, lineSha256: sha256(line) });
  const common = (f: SessionFinding) => ({ exp: meta.exp, session: meta.session, index: f.noteIndex, verification: f.verification, join: f.join, counted: f.counts, serverSeq: f.seq,
    sessionValidity: { status: validity.status, primaryAnalysis: validity.primaryAnalysis } });
  const author = (f: SessionFinding): { author: Author; provenance?: NodeInput['provenance'] } => {
    if (f.note.nonceValid !== true || f.note.session !== meta.session) return { author: { kind: 'agent', id: 'unverified-submitter', version: 'unknown (nonce or session did not match this session)' } };
    if (label === 'test-double') return { author: { kind: 'test-double', id: 'gw2-review-test-double', version: `${server?.name ?? 'server'}@${server?.version ?? '?'}` } };
    const args = JSON.parse(readFileSync(opts.kane!.args, 'utf8'));
    return { author: { kind: 'agent', id: 'kane-cli', version: String(args.version) } };
  };
  const nodes: { key: string; node: NodeInput }[] = [];
  const notesF = join(sessionDir, String(meta.notes ?? 'notes.ndjson')), hypF = join(sessionDir, String(meta.hypotheses ?? 'hypotheses.ndjson'));
  const kaneProv = (ref: ReturnType<typeof lineRef>) => ({ kaneStdout: { path: refPath(opts.kane!.stdout, root), sha256: fileSha256(opts.kane!.stdout) }, kaneArgs: { path: refPath(opts.kane!.args, root), sha256: fileSha256(opts.kane!.args) }, note: ref });
  for (const f of s.findings) {
    const ref = lineRef(notesF, f.noteIndex, f.line), a = author(f);
    nodes.push({ key: `finding:${f.noteIndex}`, node: { kind: 'finding', parents: [], ...a, ...(a.author.id === 'kane-cli' ? { provenance: kaneProv(ref) } : {}), origin: 'live', at: String(f.note.at), evidenceRefs: [ref],
      body: { verbatim: f.line, source: 'notes', ...common(f) } } });
  }
  const byRef = new Map<string, string>();
  for (const h of s.hypotheses) {
    const ref = lineRef(hypF, h.noteIndex, h.line), a = author(h), n = h.note as Record<string, string>;
    const declared = typeof n.competingWith === 'string' ? n.competingWith : '';
    const named = [...new Set(declared.match(/H-\d+/g) ?? [])];
    const parents = named.filter(r => byRef.has(r)).map(r => ({ id: byRef.get(r)!, relation: 'alternative-to' as const }));
    const structured = Object.fromEntries(['trigger', 'condition', 'effect'].filter(k => typeof n[k] === 'string' && n[k].trim()).map(k => [k, n[k]]));
    const node: NodeInput = {
      kind: n.abstain === 'yes' ? 'abstention' : 'hypothesis', parents, ...a, ...(a.author.id === 'kane-cli' ? { provenance: kaneProv(ref) } : {}), origin: 'live', at: String(n.at), evidenceRefs: [ref],
      ...(parents.length ? { reason: `competing hypothesis declared by the submitter (competingWith: ${JSON.stringify(declared)})` } : {}),
      body: { verbatim: h.line, source: 'hypotheses', ref: n.ref, statement: n.statement ?? '', structured, confidence: n.confidence ?? null, competingWith: declared, unresolvedCompeting: named.filter(r => !byRef.has(r)), evidence: n.evidence ?? '', abstainScope: n.abstainScope ?? '', ...(typeof n.representation === 'string' && n.representation.trim() ? { submittedRepresentation: n.representation } : {}), ...common(h) },
    };
    nodes.push({ key: `hypothesis:${h.noteIndex}`, node });
    if (typeof n.ref === 'string') byRef.set(n.ref, nodeId(node));
  }
  const targets = nodes.map(x => nodeId(x.node)), notApplicable: string[] = [];
  const assess = (file: string | undefined, kind: 'completeness' | 'coverage') => {
    if (!file) return;
    if (!targets.length) { notApplicable.push(`${kind}: no finding or hypothesis node to evaluate in this session`); return; }
    const c = JSON.parse(readFileSync(file, 'utf8'));
    if (c.session !== undefined && c.session !== meta.session) throw new ImportError(`${kind} file ${file} is for session ${c.session}, not ${meta.session}`);
    const ref = { path: refPath(file, root), sha256: fileSha256(file) };
    nodes.push({ key: `assessment:${kind}`, node: kind === 'completeness' ? {
      kind: 'evaluation', parents: targets.map(id => ({ id, relation: 'evaluates' as const })), author: { kind: 'verifier', id: 'gamewatch/gw2/policy.ts', version: String(c.schema) }, origin: 'live', at: String(meta.startedAt),
      evidenceRefs: [ref], criteria: `declared requirements of policy ${c.policy} only (${c.schema}); experimental validity per D26/D27`,
      reason: `completeness ${c.investigationCompleteness?.completeness}${c.investigationCompleteness?.verifiedComplete ? ' (verified)' : ''}; experimental validity ${c.experimentalValidity?.status}`,
      body: { assessment: 'investigation-completeness', session: meta.session, investigationCompleteness: c.investigationCompleteness, experimentalValidity: c.experimentalValidity, accessCoverage: { journal: c.accessCoverage?.journal, servedCount: c.accessCoverage?.servedCount } },
    } : {
      kind: 'evaluation', parents: targets.map(id => ({ id, relation: 'evaluates' as const })), author: { kind: 'verifier', id: 'gamewatch/gw2/coverage.ts', version: String(c.schema) }, origin: 'live', at: String(meta.startedAt),
      evidenceRefs: [ref], criteria: `verdict-time coverage (${c.schema}): served / reconstructed / cited per evidence page at each finding`, reason: 'coverage assessment of this session, recorded separately from the findings',
      body: { assessment: 'verdict-time-coverage', session: meta.session, accessEvidence: c.accessEvidence ?? null, columns: Array.isArray(c.columns) ? c.columns.length : null },
    } });
  };
  assess(opts.completeness, 'completeness'); assess(opts.coverage, 'coverage');
  return { session: String(meta.session), exp: String(meta.exp), nodes, notApplicable, validity, seal: closure.sealSha256 };
}

/** Which notes/hypotheses lines of a session have no node in the graph (by session + verbatim line). */
export function sessionImportStatus(sessionDir: string, graph: string) {
  const s = loadSession(sessionDir), nodes = existsSync(graph) ? verify(graph).nodes : [], closure = sessionClosure(sessionDir);
  const have = new Set(nodes.filter(n => n.body.session === s.meta.session).map(n => `${n.body.source}:${n.body.verbatim}`));
  const missing = [...s.findings.map(f => ['notes', f]), ...s.hypotheses.map(h => ['hypotheses', h])].filter(([src, f]) => !have.has(`${src}:${(f as SessionFinding).line}`)).map(([src, f]) => `${src} line ${(f as SessionFinding).noteIndex + 1}`);
  return { session: String(s.meta.session), complete: !missing.length, missing, closure };
}

export function importSession(sessionDir: string, graph: string, opts: ImportOptions = {}) {
  const plan = planSessionImport(sessionDir, opts), v = verify(graph, { root: opts.root });
  if (!v.ok) throw new ImportError(`the graph fails verification at line ${v.firstBadLine}; nothing imported`);
  const ids = new Set(v.nodes.map(n => n.id)), mine = v.nodes.filter(n => n.body.session === plan.session);
  // conflicts: the same session line already imported with different content
  for (const x of plan.nodes) {
    const id = nodeId(x.node);
    if (ids.has(id)) continue;
    const same = mine.find(n => x.key.startsWith('assessment:') ? n.body.assessment === (x.node.body as Record<string, unknown>).assessment : n.body.source === (x.node.body as Record<string, unknown>).source && n.body.index === (x.node.body as Record<string, unknown>).index && n.kind !== 'evaluation');
    if (same) throw new ImportError(`conflict: ${x.key} of session ${plan.session} is already in the graph as ${same.id} with different content; nothing was changed`);
  }
  const result: { key: string; id: string; status: 'appended' | 'already-present' }[] = [];
  for (const x of plan.nodes) {
    const id = nodeId(x.node);
    if (ids.has(id)) { result.push({ key: x.key, id, status: 'already-present' }); continue; }
    append(graph, x.node, { root: opts.root }); ids.add(id); result.push({ key: x.key, id, status: 'appended' });
  }
  const head = verify(graph).head;
  const receiptF = assertWritableOutput(join(dirname(graph), 'imports', `${plan.session}.json`));
  mkdirSync(dirname(receiptF), { recursive: true });
  const receipt = { schema: 'gamewatch/gw2-session-import@1', session: plan.session, exp: plan.exp, sessionDir: refPath(sessionDir, opts.root ?? ROOT), graph: basename(graph), nodes: result, notApplicable: plan.notApplicable, sessionValidity: plan.validity, sessionSeal: plan.seal, graphHeadAfter: head };
  writeFileSync(receiptF, JSON.stringify(receipt, null, 1) + '\n');
  return receipt;
}

if (process.argv[1]?.replace(/\\/g, "/").endsWith('gw2/import-session.ts')) {
  const a = process.argv.slice(2), arg = (k: string) => { const i = a.indexOf(k); return i >= 0 ? a[i + 1] : undefined; };
  const [sd, graph] = a.filter((x, i) => !x.startsWith('--') && !a[i - 1]?.startsWith('--'));
  if (!graph) { console.error('usage: import-session.ts <sessionDir> <judgments.ndjson> [--completeness f] [--coverage f] [--kane-stdout f --kane-args f]'); process.exit(2); }
  try {
    const ks = arg('--kane-stdout'), ka = arg('--kane-args');
    const r = importSession(sd, graph, { completeness: arg('--completeness'), coverage: arg('--coverage'), kane: ks && ka ? { stdout: ks, args: ka } : undefined });
    console.log(`session ${r.session}: ${r.nodes.filter(n => n.status === 'appended').length} appended, ${r.nodes.filter(n => n.status === 'already-present').length} already present; head ${r.graphHeadAfter.count}:${r.graphHeadAfter.lastLineSha256}${r.notApplicable.length ? `; not applicable: ${r.notApplicable.join('; ')}` : ''}`);
  } catch (e) { console.error((e as Error).message); process.exit(5); }
}
