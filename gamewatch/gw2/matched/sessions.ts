/**
 * GW2 matched comparison: per-session submissions, Freeze-1 and Freeze-2 (D139).
 *
 * Every logical session (M01..M10) has its OWN judgment graph (<run>/sessions/<M>/judgments.ndjson), so its freezes are
 * independent of every other session. A phase's stored form lines are imported verbatim as hypothesis or abstention
 * nodes, plus one representation node per submitted structured representation (parse errors kept, nothing repaired).
 * Phase-2 forms that name an earlier hypothesis ("revises": H-n) get a parent link with the existing relation "refines"
 * to that frozen phase-1 node, with body.revision = {of, action: revise | withdraw}; the original is never edited.
 *
 * freezeSession writes FREEZE-<phase>.json (never overwritten) with the graph head and every submission of the phase,
 * and anchors its sha256 and the graph head in the external ledger (events freeze-1 / freeze-2, one per session and
 * phase). loadFrozen authenticates a freeze against that ledger and reads ONLY the anchored graph prefix (byte-exact,
 * as anchored.ts), so phase 2 receives only its own session's frozen phase-1 submissions.
 */
import { readFileSync, writeFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { append, verify as verifyGraph, fileSha256, sha256, type NodeInput, type Node, type Author } from '../judgments.ts';
import { loadSession } from '../session.ts';
import { sessionClosure } from '../session-close.ts';
import { readExecLedger, appendCheckpoint } from '../p7-exec.ts';
import { checkRepresentation } from '../hypothesis.ts';
import { readLinePrefix } from '../ext/anchored.ts';
import { AccessRefused } from '../ext/errors.ts';
import { repoRelative } from '../paths.ts';
import type { Hyp } from '../ext/inputs.ts';
import type { Arm, Phase } from './params.ts';

export const FREEZE_SCHEMA = 'gamewatch/gw2-matched-session-freeze@1';
const fsha = (f: string) => createHash('sha256').update(readFileSync(f)).digest('hex');
export const sessionDir = (run: string, session: string) => join(run, 'sessions', session);
export const graphOf = (run: string, session: string) => join(sessionDir(run, session), 'judgments.ndjson');
const refPath = (f: string) => repoRelative(f) ?? f;

export type Slot = { session: string; arm: Arm; runs: Record<Phase, string> };
export type ImportOpts = { kane?: { stdout: string; args: string; version: string } };

/** Import the stored forms of one closed server session (one phase of one logical session). Returns the new node ids. */
export function importPhase(run: string, rec: string, slot: Slot, phase: Phase, serverSessionDir: string, o: ImportOpts = {}) {
  const closure = sessionClosure(serverSessionDir);
  if (closure.status !== 'closed') throw new AccessRefused(`server session ${serverSessionDir} is not closed (${closure.status})`);
  const s = loadSession(serverSessionDir), meta = s.meta as Record<string, any>, graph = graphOf(run, slot.session);
  const hypF = join(serverSessionDir, String(meta.hypotheses ?? 'hypotheses.ndjson'));
  const frozen1 = phase === 2 ? loadFrozen(run, rec, slot.session, 1) : null;
  const byRef = new Map((frozen1?.submissions ?? []).map(x => [x.ref, x.id]));
  const ids: string[] = [];
  for (const h of s.hypotheses) {
    const n = h.note as Record<string, any>, ref = { path: refPath(hypF), sha256: fileSha256(hypF), line: h.noteIndex + 1, lineSha256: sha256(h.line) };
    const valid = n.nonceValid === true && n.session === meta.session;
    const author: Author = !valid ? { kind: 'agent', id: 'unverified-submitter', version: 'unknown (nonce or session did not match)' }
      : o.kane ? { kind: 'agent', id: 'kane-cli', version: o.kane.version } : { kind: 'test-double', id: 'gw2-matched-test-double', version: String(meta.label ?? 'test-double') };
    const prov = valid && o.kane ? { provenance: { kaneStdout: { path: refPath(o.kane.stdout), sha256: fileSha256(o.kane.stdout) }, kaneArgs: { path: refPath(o.kane.args), sha256: fileSha256(o.kane.args) }, note: ref } } : {};
    const withdraw = n.abstain === 'yes', revisesRef = typeof n.revises === 'string' ? n.revises.trim() : '';
    const of = phase === 2 && revisesRef ? byRef.get(revisesRef) ?? null : null;
    const node: NodeInput = {
      kind: withdraw ? 'abstention' : 'hypothesis', parents: of ? [{ id: of, relation: 'refines' }] : [], author, ...prov, origin: 'live', at: String(n.at), evidenceRefs: [ref],
      ...(of ? { reason: `phase-2 ${withdraw ? 'withdrawal' : 'revision'} of ${revisesRef}, submitted by the session; the original is kept` } : {}),
      body: { verbatim: h.line, source: 'hypotheses', session: slot.session, arm: slot.arm, phase, runId: slot.runs[phase], serverSession: meta.session, nonceValid: valid,
        ref: n.ref, phaseRef: `P${phase}:${n.ref}`, statement: n.statement ?? '', confidence: n.confidence ?? null, evidence: n.evidence ?? '', abstainScope: n.abstainScope ?? '',
        ...(typeof n.representation === 'string' && n.representation.trim() ? { submittedRepresentation: n.representation } : {}),
        ...(phase === 2 && revisesRef ? { revision: { of, ref: revisesRef, action: withdraw ? 'withdraw' : 'revise', resolved: !!of } } : {}) },
    };
    const id = append(graph, node).id; ids.push(id);
    const raw = (node.body as any).submittedRepresentation;
    if (!withdraw && typeof raw === 'string') {
      let representation: unknown = null, parseError: string | null = null;
      try { representation = JSON.parse(raw); } catch (e) { parseError = (e as Error).message; }
      ids.push(append(graph, { kind: 'representation', parents: [{ id, relation: 'represents' }], author, ...prov, origin: 'live', at: String(n.at), evidenceRefs: [ref],
        reason: 'structured representation submitted with the form; extracted verbatim, not repaired',
        body: { origin: 'submitter', representation, ...(parseError ? { parseError } : {}), rawSha256: sha256(raw), fidelity: { declared: 'faithful' }, session: slot.session, phase, ...(o.kane && valid ? { verbatim: h.line } : {}) } }).id);
    }
  }
  return ids;
}

export type Frozen = { freeze: any; freezeSha256: string; nodes: Node[]; submissions: { id: string; kind: string; ref: string; phaseRef: string; representations: string[]; revision: any }[]; hyps: Hyp[] };

/** Freeze one phase of one session: FREEZE-<phase>.json (wx) + an external ledger anchor. Phase 2 needs a valid Freeze-1. */
export function freezeSession(run: string, rec: string, slot: Slot, phase: Phase, o: { at?: string; status?: string; reasons?: string[] } = {}) {
  const g = graphOf(run, slot.session), f = join(sessionDir(run, slot.session), `FREEZE-${phase}.json`);
  if (existsSync(f)) throw new AccessRefused(`${slot.session} phase ${phase} is already frozen`);
  const L = readExecLedger(rec); if (!L.ok) throw new AccessRefused(`external ledger fails: ${L.problems.join('; ')}`);
  if (L.entries.some((e: any) => e.event === 'gate-opened')) throw new AccessRefused('the final held-out evaluation is already opened: nothing can be frozen any more');
  if (L.entries.some((e: any) => e.event === `freeze-${phase}` && e.data.session === slot.session)) throw new AccessRefused(`the ledger already anchors ${slot.session} freeze-${phase}`);
  const prior = phase === 2 ? loadFrozen(run, rec, slot.session, 1) : null;
  const v = existsSync(g) ? verifyGraph(g, { checkRefs: true }) : { ok: true, nodes: [] as Node[], head: { count: 0, lastLineSha256: null }, problems: [] } as any;
  if (!v.ok) throw new AccessRefused(`${slot.session} graph fails verification: ${v.problems[0]?.problem}`);
  const subs = (v.nodes as Node[]).filter(n => (n.kind === 'hypothesis' || n.kind === 'abstention') && (n.body as any).phase === phase).map(n => ({
    id: n.id, kind: n.kind, ref: String((n.body as any).ref), phaseRef: String((n.body as any).phaseRef), revision: (n.body as any).revision ?? null,
    representations: (v.nodes as Node[]).filter(r => r.kind === 'representation' && r.parents[0]?.id === n.id).map(r => r.id) }));
  const body = { schema: FREEZE_SCHEMA, session: slot.session, arm: slot.arm, phase, runId: slot.runs[phase], callStatus: o.status ?? null, callReasons: o.reasons ?? [],
    graphHead: v.head, submissions: subs, ...(prior ? { freeze1Sha256: prior.freezeSha256, freeze1GraphHead: prior.freeze.graphHead } : {}), at: o.at ?? new Date().toISOString() };
  writeFileSync(f, JSON.stringify(body, null, 1) + '\n', { flag: 'wx' });
  const freezeSha256 = fsha(f);
  appendCheckpoint(rec, `freeze-${phase}`, { session: slot.session, arm: slot.arm, phase, runId: slot.runs[phase], freezeSha256, graph: v.head, submissions: subs.length }, body.at);
  return { freezeSha256, graphHead: v.head, submissions: subs };
}

/** An authenticated freeze: ledger anchor, file hash, byte-exact graph prefix (nothing after it is read). */
export function loadFrozen(run: string, rec: string, session: string, phase: Phase): Frozen {
  const L = readExecLedger(rec); if (!L.ok) throw new AccessRefused(`external ledger fails: ${L.problems.join('; ')}`);
  const ev = (L.entries as any[]).filter(e => e.event === `freeze-${phase}` && e.data.session === session);
  if (ev.length !== 1) throw new AccessRefused(`${session}: expected exactly one freeze-${phase} anchor, found ${ev.length}`);
  const f = join(sessionDir(run, session), `FREEZE-${phase}.json`);
  if (!existsSync(f) || fsha(f) !== ev[0].data.freezeSha256) throw new AccessRefused(`${session} FREEZE-${phase}.json differs from its external anchor`);
  const freeze = JSON.parse(readFileSync(f, 'utf8')), head = ev[0].data.graph;
  if (freeze.graphHead.count !== head.count || freeze.graphHead.lastLineSha256 !== head.lastLineSha256) throw new AccessRefused(`${session} freeze-${phase}: graph head differs from the anchor`);
  let nodes: Node[] = [];
  if (head.count > 0) {
    const { lines } = readLinePrefix(graphOf(run, session), head.count), tmp = mkdtempSync(join(tmpdir(), 'gw2-matched-prefix-'));
    try {
      const pf = join(tmp, 'prefix.ndjson'); writeFileSync(pf, lines.join('\n') + '\n');
      const v = verifyGraph(pf, { checkRefs: false, anchor: head });
      if (!v.ok) throw new AccessRefused(`${session} freeze-${phase} prefix fails verification at line ${v.firstBadLine}`);
      nodes = v.nodes;
    } finally { rmSync(tmp, { recursive: true, force: true }); }
  }
  const bad = nodes.filter(n => !['hypothesis', 'abstention', 'representation'].includes(n.kind) || n.parents.some(p => p.relation === 'evaluates'));
  if (bad.length) throw new AccessRefused(`${session} freeze-${phase} prefix holds non-submission nodes`);
  const ids = new Set(nodes.map(n => n.id));
  for (const s of freeze.submissions) if (!ids.has(s.id) || s.representations.some((r: string) => !ids.has(r))) throw new AccessRefused(`${session} freeze-${phase}: a frozen submission is not in the anchored prefix`);
  if (nodes.some(n => (n.body as any).session !== session)) throw new AccessRefused(`${session}: the graph holds another session's node`);
  return { freeze, freezeSha256: ev[0].data.freezeSha256, nodes, submissions: freeze.submissions, hyps: toHyps(nodes, freeze.submissions) };
}

/** The frozen submissions of one phase as Hyp objects (the shape the extension outputs evaluate). */
export function toHyps(nodes: Node[], subs: Frozen['submissions']): Hyp[] {
  const byId = new Map(nodes.map(n => [n.id, n]));
  return subs.map(s => {
    const n = byId.get(s.id)!, b = n.body as any;
    return { id: n.id, ref: String(b.ref), kind: n.kind, session: String(b.session), index: Number(String(b.ref).replace(/\D/g, '')) - 1, statement: String(b.statement ?? ''), confidence: String(b.confidence ?? ''), evidence: String(b.evidence ?? ''), structured: null, verbatim: String(b.verbatim ?? ''),
      representations: s.representations.map(rid => { const r = byId.get(rid)!, rb = r.body as any, chk = checkRepresentation(rb.representation);
        return { id: rid, origin: 'submitter', fidelity: 'faithful', author: `${r.author.kind}:${r.author.id}`, representation: rb.representation, status: chk.status, clauses: chk.clauses.flatMap(c => c.ok ? [c.clause] : []) }; }) };
  });
}
