/**
 * GW2 P3: hypothesis freeze and the evaluation gate.
 *
 *   node --experimental-strip-types --no-warnings gamewatch/gw2/freeze.ts freeze <expDir> [--at <ISO time>]
 *   node --experimental-strip-types --no-warnings gamewatch/gw2/freeze.ts verify <expDir>
 *
 * Layout: <expDir>/judgments.ndjson (the experiment's graph), <expDir>/sessions/* (review sessions),
 * <expDir>/partitions/ (partition.ts), <expDir>/hypotheses/FREEZE.json, <expDir>/evaluation-ledger.ndjson.
 *
 * freeze   Refuses unless: the evaluation ledger verifies and no evaluation has been opened; SESSIONS.json declares the
 *          experiment's sessions and exactly that many exist; every session is CLOSED with an intact seal
 *          (session-close.ts) and fully imported into the graph (so the import step cannot be skipped); the partitions
 *          match their manifests; the graph passes structural, reference and execution-provenance verification. Writes
 *          FREEZE.json (gw2-freeze@2) once, never overwritten: the graph anchor, the ids of every hypothesis and
 *          abstention node, each session's seal hash, the session plan hash, the PARTITION.json hash and the hash of
 *          every partition manifest. Nothing is scored.
 * verify   Fail-closed: a malformed FREEZE.json is invalid. A freeze is violated when the graph no longer verifies
 *          against the anchor, the frozen hypothesis set differs from the anchored prefix, a partition manifest or file
 *          changed, a session seal changed, or the session plan changed. Hypotheses appended after the freeze are
 *          listed as NOT covered; they are kept as separate records but excluded from evaluation (Q19).
 * openEvaluation  The only sanctioned semantic reader of heldout/ and eval/ (see the function's comment).
 * Evaluation ledger: canonical NDJSON, hash-chained (seq, prev); verified before every append (verifyLedger).
 * Per Q14, P7 anchors and freeze hashes are also recorded in an operator-controlled record outside the repository;
 * FREEZE.json in the experiment directory is the in-repository copy and is only as strong as the repository.
 */
import { readFileSync, existsSync, mkdirSync, readdirSync, statSync, appendFileSync, openSync, closeSync, writeSync } from 'node:fs';
import { join, relative } from 'node:path';
import { ROOT, assertWritableOutput } from './paths.ts';
import { verify, fileSha256, sha256, canonical, parseAnchor, type Anchor } from './judgments.ts';
import { verifyPartitions, PARTITIONS } from './partition.ts';
import { sessionClosure } from './session-close.ts';
import { sessionImportStatus } from './import-session.ts';

export const FREEZE_SCHEMA = 'gamewatch/gw2-freeze@2';
export const FREEZE_SCHEMA_V1 = 'gamewatch/gw2-freeze@1';
export const LEDGER_SCHEMA = 'gamewatch/gw2-evaluation-ledger@1';
export const SESSION_PLAN_SCHEMA = 'gamewatch/gw2-session-plan@1';
export class FreezeError extends Error {}
const HYP = new Set(['hypothesis', 'abstention']);
const HEX64 = /^[0-9a-f]{64}$/;
const paths = (exp: string) => ({ graph: join(exp, 'judgments.ndjson'), sessions: join(exp, 'sessions'), partitions: join(exp, 'partitions'), freeze: join(exp, 'hypotheses', 'FREEZE.json'), ledger: join(exp, 'evaluation-ledger.ndjson'), plan: join(exp, 'SESSIONS.json') });
const sessionDirs = (dir: string) => existsSync(dir) ? readdirSync(dir).sort().map(n => join(dir, n)).filter(d => statSync(d).isDirectory()) : [];
const isObj = (x: unknown): x is Record<string, any> => typeof x === 'object' && x !== null && !Array.isArray(x);

/**
 * Verify the evaluation ledger before it is extended or relied on (P3 correction). Fail closed: any line that is not
 * canonical JSON, a wrong seq, a broken prev hash, an unknown event or a missing time makes the whole ledger invalid.
 */
export function verifyLedger(file: string): { ok: boolean; problems: string[]; entries: Record<string, any>[]; count: number; lastLineSha256: string | null } {
  if (!existsSync(file)) return { ok: true, problems: [], entries: [], count: 0, lastLineSha256: null };
  const text = readFileSync(file, 'utf8'), problems: string[] = [], entries: Record<string, any>[] = [];
  if (text.length && !text.endsWith('\n')) problems.push('the last line is not terminated (truncated or partially written)');
  const raw = text.split('\n'); if (raw[raw.length - 1] === '') raw.pop();
  let prev: string | null = null;
  raw.forEach((line, i) => {
    if (problems.length) return;
    let e: unknown;
    try { e = JSON.parse(line); } catch { problems.push(`line ${i + 1}: not JSON`); return; }
    if (!isObj(e)) { problems.push(`line ${i + 1}: not an object`); return; }
    if (canonical(e) !== line) problems.push(`line ${i + 1}: not in canonical form`);
    if (e.seq !== i + 1) problems.push(`line ${i + 1}: seq ${String(e.seq)}, expected ${i + 1}`);
    if (e.prev !== prev) problems.push(`line ${i + 1}: prev does not match the hash of line ${i}`);
    if (e.schema !== undefined && e.schema !== LEDGER_SCHEMA) problems.push(`line ${i + 1}: schema is not ${LEDGER_SCHEMA}`);
    if (e.event !== 'opened' && e.event !== 'refused') problems.push(`line ${i + 1}: unknown event ${JSON.stringify(e.event)}`);
    if (typeof e.at !== 'string' || Number.isNaN(Date.parse(e.at))) problems.push(`line ${i + 1}: at is not a time`);
    entries.push(e); prev = sha256(line);
  });
  return { ok: !problems.length, problems, entries, count: raw.length, lastLineSha256: prev };
}
function ledger(file: string, entry: Record<string, unknown>) {
  const out = assertWritableOutput(file), v = verifyLedger(out);
  if (!v.ok) throw new FreezeError(`the evaluation ledger is invalid and is not extended: ${v.problems.join('; ')}`);
  appendFileSync(out, canonical({ schema: LEDGER_SCHEMA, seq: v.count + 1, prev: v.lastLineSha256, at: new Date().toISOString(), ...entry }) + '\n');
}

/** The declared session plan (Q19): how many review sessions this experiment runs before the freeze. */
export function readSessionPlan(exp: string): { expectedSessions: number } {
  const f = paths(exp).plan;
  if (!existsSync(f)) throw new FreezeError(`no session plan (${f}); declare the experiment's sessions (${SESSION_PLAN_SCHEMA}) before freezing`);
  let p: unknown;
  try { p = JSON.parse(readFileSync(f, 'utf8')); } catch { throw new FreezeError('SESSIONS.json is not valid JSON'); }
  if (!isObj(p) || p.schema !== SESSION_PLAN_SCHEMA || !Number.isInteger(p.expectedSessions) || p.expectedSessions < 1) throw new FreezeError(`SESSIONS.json must be ${SESSION_PLAN_SCHEMA} with an integer expectedSessions >= 1`);
  return { expectedSessions: p.expectedSessions };
}
export function writeSessionPlan(exp: string, expectedSessions: number, note = '') {
  const out = assertWritableOutput(paths(exp).plan);
  mkdirSync(exp, { recursive: true });
  const fd = openSync(out, 'wx'); try { writeSync(fd, JSON.stringify({ schema: SESSION_PLAN_SCHEMA, expectedSessions, note }, null, 1) + '\n'); } finally { closeSync(fd); }
}

export function freezeHypotheses(exp: string, opts: { at?: string; root?: string } = {}) {
  const P = paths(exp), bad: string[] = [];
  if (existsSync(P.freeze)) throw new FreezeError(`a freeze already exists and is never overwritten: ${P.freeze}`);
  const L = verifyLedger(P.ledger);
  if (!L.ok) throw new FreezeError(`freeze refused: the evaluation ledger is invalid (${L.problems.join('; ')})`);
  if (L.entries.some(l => l.event === 'opened')) throw new FreezeError('evaluation was already opened for this experiment; a freeze after evaluation is not a freeze');
  const plan = readSessionPlan(exp);
  if (!existsSync(join(P.partitions, 'PARTITION.json'))) bad.push('no partitions (partition.ts) in this experiment');
  else bad.push(...verifyPartitions(exp).map(x => `partitions: ${x}`));
  const v = verify(P.graph, { checkRefs: true, root: opts.root });
  if (!existsSync(P.graph)) bad.push('no judgment graph (judgments.ndjson)');
  else if (!v.ok) bad.push(`graph fails verification at line ${v.firstBadLine} (${v.problems[0].level}): ${v.problems[0].problem}`);
  const dirs = sessionDirs(P.sessions);
  if (dirs.length !== plan.expectedSessions) bad.push(`the session plan declares ${plan.expectedSessions} session(s); ${dirs.length} found`);
  const sessions = dirs.map(d => sessionImportStatus(d, P.graph));
  for (const s of sessions) {
    if (s.closure.status !== 'closed') bad.push(`session ${s.session} is not closed (${s.closure.status}: ${s.closure.problems.join('; ')})`);
    if (!s.complete) bad.push(`session ${s.session} is not fully imported (${s.missing.join(', ')}); run import-session.ts first`);
  }
  if (bad.length) throw new FreezeError(`freeze refused:\n  ${bad.join('\n  ')}`);
  const hyps = v.nodes.filter(n => HYP.has(n.kind));
  const PART = JSON.parse(readFileSync(join(P.partitions, 'PARTITION.json'), 'utf8'));
  const rec = {
    schema: FREEZE_SCHEMA, exp: relative(opts.root ?? ROOT, exp).startsWith('..') ? exp : relative(opts.root ?? ROOT, exp), frozenAt: opts.at ?? new Date().toISOString(),
    graph: { file: 'judgments.ndjson', anchor: v.head },
    hypotheses: hyps.map(n => ({ id: n.id, kind: n.kind, session: n.body.session ?? null, ref: n.body.ref ?? null })),
    counts: { hypotheses: hyps.filter(n => n.kind === 'hypothesis').length, abstentions: hyps.filter(n => n.kind === 'abstention').length, nodes: v.count },
    sessions: sessions.map(s => ({ session: s.session, closure: s.closure.closure, sealSha256: s.closure.sealSha256 })),
    sessionPlan: { file: 'SESSIONS.json', sha256: fileSha256(P.plan), expectedSessions: plan.expectedSessions },
    partition: { file: 'partitions/PARTITION.json', sha256: fileSha256(join(P.partitions, 'PARTITION.json')) },
    manifests: Object.fromEntries(PARTITIONS.map(p => [p, String(PART.manifests[p])])),
    statement: 'Frozen after every declared session was closed and imported, and before any held-out or evaluation file was read through freeze.ts. Evaluation readers are bound to the manifests listed here. Nothing in P3 scores hypotheses. Record the anchor and this file\'s hash in the operator-controlled record outside the repository (Q14).',
  };
  const out = assertWritableOutput(P.freeze);
  mkdirSync(join(exp, 'hypotheses'), { recursive: true });
  const fd = openSync(out, 'wx'); try { writeSync(fd, JSON.stringify(rec, null, 1) + '\n'); } finally { closeSync(fd); }
  return { ...rec, freezeSha256: fileSha256(out) };
}

type FreezeCheck = { ok: boolean; problems: string[]; frozen: string[]; notCovered: string[]; freezeSha256?: string; schema?: string; manifests?: Record<string, string>; anchor?: Anchor };
/** Strict, fail-closed validation of FREEZE.json's shape (before anything in it is trusted). */
function freezeShape(f: unknown): string[] {
  if (!isObj(f)) return ['FREEZE.json is not an object'];
  const bad: string[] = [];
  if (f.schema !== FREEZE_SCHEMA && f.schema !== FREEZE_SCHEMA_V1) bad.push(`FREEZE.json schema is not ${FREEZE_SCHEMA} (or ${FREEZE_SCHEMA_V1})`);
  if (typeof f.frozenAt !== 'string' || Number.isNaN(Date.parse(f.frozenAt))) bad.push('frozenAt is not a time');
  if (!isObj(f.graph) || f.graph.file !== 'judgments.ndjson' || !isObj(f.graph.anchor)) bad.push('graph.anchor missing');
  if (!Array.isArray(f.hypotheses) || f.hypotheses.some((h: unknown) => !isObj(h) || typeof h.id !== 'string' || !HEX64.test(h.id) || !HYP.has(String(h.kind)))) bad.push('hypotheses must be a list of {id: sha256, kind: hypothesis|abstention}');
  if (!isObj(f.partition) || typeof f.partition.sha256 !== 'string' || !HEX64.test(f.partition.sha256)) bad.push('partition.sha256 missing or malformed');
  if (f.schema === FREEZE_SCHEMA) {
    if (!isObj(f.manifests) || PARTITIONS.some(p => typeof f.manifests[p] !== 'string' || !HEX64.test(f.manifests[p]))) bad.push(`manifests must give a sha256 for each of ${PARTITIONS.join(', ')}`);
    if (!Array.isArray(f.sessions) || f.sessions.some((s: unknown) => !isObj(s) || typeof s.session !== 'string' || typeof s.sealSha256 !== 'string' || !HEX64.test(s.sealSha256))) bad.push('sessions must list {session, sealSha256}');
    if (!isObj(f.sessionPlan) || typeof f.sessionPlan.sha256 !== 'string') bad.push('sessionPlan missing');
  }
  return bad;
}

export function verifyFreeze(exp: string, opts: { root?: string } = {}): FreezeCheck {
  const P = paths(exp), problems: string[] = [];
  if (!existsSync(P.freeze)) return { ok: false, problems: ['no hypothesis freeze (hypotheses/FREEZE.json)'], frozen: [], notCovered: [] };
  let f: Record<string, any>;
  try { f = JSON.parse(readFileSync(P.freeze, 'utf8')); } catch { return { ok: false, problems: ['FREEZE.json is not valid JSON'], frozen: [], notCovered: [] }; }
  const shape = freezeShape(f);
  let anchor: Anchor | null = null;
  if (!shape.length) { try { anchor = parseAnchor(`${f.graph.anchor.count}:${f.graph.anchor.lastLineSha256 ?? ''}`); } catch (e) { shape.push(`FREEZE.json anchor: ${(e as Error).message}`); } }
  if (shape.length) return { ok: false, problems: shape, frozen: [], notCovered: [] };
  const v = verify(P.graph, { checkRefs: true, anchor: anchor!, root: opts.root });
  for (const p of v.problems) problems.push(`graph line ${p.line} [${p.level}]: ${p.problem}`);
  const frozen = (f.hypotheses as { id: string }[]).map(h => h.id);
  const prefix = v.nodes.slice(0, anchor!.count).filter(n => HYP.has(n.kind)).map(n => n.id);
  if (v.ok && canonical(prefix) !== canonical(frozen)) problems.push('the frozen hypothesis list differs from the hypotheses in the anchored prefix of the graph');
  const partF = join(P.partitions, 'PARTITION.json');
  let manifests: Record<string, string> | undefined;
  if (!existsSync(partF) || fileSha256(partF) !== f.partition.sha256) problems.push('partitions/PARTITION.json differs from the freeze record');
  else {
    let part: Record<string, any> | null = null;
    try { part = JSON.parse(readFileSync(partF, 'utf8')); } catch { problems.push('PARTITION.json is not valid JSON'); }
    // @2 lists the manifests itself; @1 binds them through PARTITION.json, whose hash it records.
    manifests = f.schema === FREEZE_SCHEMA ? f.manifests : part?.manifests;
    for (const p of PARTITIONS) if (!part || part.manifests?.[p] !== manifests?.[p]) problems.push(`${p}: the manifest hash in PARTITION.json differs from the freeze record`);
    problems.push(...verifyPartitions(exp).map(x => `partitions: ${x}`));
  }
  if (f.schema === FREEZE_SCHEMA) {
    if (!existsSync(P.plan) || fileSha256(P.plan) !== f.sessionPlan.sha256) problems.push('SESSIONS.json differs from the freeze record');
    for (const s of f.sessions as { session: string; sealSha256: string }[]) {
      const c = sessionClosure(join(P.sessions, s.session));
      if (c.status !== 'closed' || c.sealSha256 !== s.sealSha256) problems.push(`session ${s.session}: seal ${c.status === 'closed' ? 'differs from the freeze record' : `${c.status} (${c.problems.join('; ')})`}`);
    }
  }
  const notCovered = v.nodes.slice(anchor!.count).filter(n => HYP.has(n.kind)).map(n => n.id);
  return { ok: !problems.length, problems, frozen, notCovered, freezeSha256: fileSha256(P.freeze), schema: f.schema, manifests, anchor: anchor! };
}

/**
 * The evaluation gate (P4's evaluator must go through it). It is the only sanctioned SEMANTIC reader (parse, inspect,
 * analyse) of heldout/ and eval/. Integrity checks elsewhere (verifyManifest, verifyPartitions, leak-check's
 * byte-identity test) read those files only as raw bytes to hash them; see PHASE_3_REPORT §13.
 * Refuses, fail-closed, when: the ledger is invalid (nothing is appended to an invalid ledger); the freeze is missing,
 * malformed, invalid or violated; the freeze is @1 (it predates explicit session closure); or any session of the
 * experiment is not closed (an ongoing discovery session must not overlap evaluation). A refusal is recorded in a valid
 * ledger. The returned reader is bound to the manifest hashes accepted at freeze time: a replacement manifest is refused
 * even when the replacement files are internally consistent with it.
 */
export function openEvaluation(exp: string, evaluator: { id: string; version: string }, opts: { root?: string } = {}) {
  const P = paths(exp), L = verifyLedger(P.ledger);
  if (!L.ok) throw new FreezeError(`evaluation refused: the evaluation ledger is invalid (${L.problems.join('; ')}); nothing was appended`);
  const r = verifyFreeze(exp, opts), problems = [...r.problems];
  if (r.ok && r.schema !== FREEZE_SCHEMA) problems.push(`the freeze is ${r.schema}, which predates explicit session closure; evaluation needs ${FREEZE_SCHEMA}`);
  for (const d of sessionDirs(P.sessions)) { const c = sessionClosure(d); if (c.status !== 'closed') problems.push(`session ${relative(P.sessions, d)} is ${c.status}; evaluation does not start while a session is open or its seal is broken`); }
  if (problems.length) {
    ledger(P.ledger, { event: 'refused', evaluator, reasons: problems });
    throw new FreezeError(`evaluation refused: ${problems.join('; ')}`);
  }
  const graphHead = r.anchor && verify(P.graph).head;
  ledger(P.ledger, { event: 'opened', evaluator, freezeSha256: r.freezeSha256, frozen: r.frozen.length, notCovered: r.notCovered, manifests: r.manifests, graphHead });
  const bound = r.manifests!;
  const read = (partition: 'spec' | 'heldout' | 'eval' | 'discovery', file: string) => {
    if (!(PARTITIONS as readonly string[]).includes(partition)) throw new FreezeError(`unknown partition ${partition}`);
    const dir = join(P.partitions, partition), mf = join(dir, 'MANIFEST.json');
    if (!existsSync(mf) || fileSha256(mf) !== bound[partition]) throw new FreezeError(`${partition}/MANIFEST.json is not the manifest accepted at freeze time; read refused`);
    const m = JSON.parse(readFileSync(mf, 'utf8'));
    if (!isObj(m.files) || !Object.prototype.hasOwnProperty.call(m.files, file)) throw new FreezeError(`${partition}/${file}: not in the partition manifest`);
    const f = join(dir, file);
    if (!existsSync(f) || fileSha256(f) !== m.files[file]) throw new FreezeError(`${partition}/${file}: content differs from the frozen manifest; read refused`);
    return readFileSync(f, 'utf8');
  };
  return { frozen: r.frozen, notCovered: r.notCovered, freezeSha256: r.freezeSha256!, graphHead: graphHead!, read };
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
