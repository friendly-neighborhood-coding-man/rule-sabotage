/**
 * GW2 P4 demonstration with deterministic TEST DOUBLES (no Kane, no model, no new engine observation):
 *
 *   node --experimental-strip-types --no-warnings gamewatch/gw2/p4-demo.ts <expDir> [--at <ISO>]
 *
 * 1. partition the frozen GW1 bundle with the frozen P3 procedure (--fixture: a labelled NON-experimental fixture);
 * 2. declare one session (SESSIONS.json); a scripted test double submits free-text hypotheses through the GW2 server
 *    (competing, unrepresentable, partially representable, unstructured, and an abstention); the server closes and seals it;
 * 3. explicit import; hypothesis freeze;
 * 4. a scripted representation test double appends `representation` nodes (one per hypothesis it can structure), each
 *    linked by `represents`, with a declared fidelity; the hypotheses themselves are never edited;
 * 5. three-way verification through the P3 gate (verify.ts), appending immutable evaluation nodes.
 * The representations are written by the script, not inferred from the free text: who translates real submissions
 * into gw2-hypothesis@1 is an open question (PHASE_4_REPORT).
 */
import { join } from 'node:path';
import { partition } from './partition.ts';
import { startGw2Server } from './serve.ts';
import { importSession } from './import-session.ts';
import { freezeHypotheses, writeSessionPlan } from './freeze.ts';
import { append, verify, sha256 } from './judgments.ts';
import { evaluateExperiment } from './verify.ts';
import { ROOT, assertWritableOutput } from './paths.ts';
import { HYPOTHESIS_SCHEMA } from './hypothesis.ts';

const f = (name: string) => ({ op: 'field', name }), c = (value: unknown) => ({ op: 'const', value });
const eq = (a: unknown, b: unknown) => ({ op: 'eq', args: [a, b] }), add = (a: unknown, b: unknown) => ({ op: 'add', args: [a, b] });
const and = (...args: unknown[]) => ({ op: 'and', args });
const rep = (...clauses: unknown[]) => ({ schema: HYPOTHESIS_SCHEMA, clauses });

/** The scripted submissions (free text only, as a reviewer would type them) and the scripted representations. */
export const P4_SCRIPT: { form: Record<string, string>; representation?: { rep: unknown; fidelity: string; notes: string } }[] = [
  { form: { statement: 'TEST DOUBLE (scripted): the side that moves first gets one more action at the start of each of its turns than the other side would get in the same position.', trigger: 'turn start', condition: 'side moved first in the game', effect: 'actions = pieces on board + earned extras + 1', confidence: 'medium', evidence: 'match turn rows' },
    representation: { rep: rep({ form: 'law', situation: 'turn-start', when: eq(f('isFirstMover'), c(true)), expect: [{ field: 'actionsGranted', equals: add(add(f('piecesOnBoard'), f('pendingBonus')), c(1)) }] }), fidelity: 'faithful', notes: 'first-mover clause as stated' } },
  { form: { statement: 'TEST DOUBLE (scripted): each side gets one action per own piece on the board, plus extras it earned, whoever moved first.', confidence: 'low', competingWith: 'H-1' },
    representation: { rep: rep({ form: 'law', situation: 'turn-start', expect: [{ field: 'actionsGranted', equals: add(f('piecesOnBoard'), f('pendingBonus')) }] }), fidelity: 'faithful', notes: 'as stated' } },
  { form: { statement: 'TEST DOUBLE (scripted): a shield protects an AI piece from the next effect cell, but a shielded Human piece is hit anyway and loses the shield.', confidence: 'medium' },
    representation: { rep: rep(
      { form: 'law', situation: 'effect-entry', when: and(eq(f('pieceShieldedBefore'), c(true)), eq(f('pieceSide'), c('AI')), eq(f('capped'), c(false))), expect: [{ field: 'absorbed', equals: c(true) }, { field: 'fired', equals: c(false) }] },
      { form: 'law', situation: 'effect-entry', when: and(eq(f('pieceShieldedBefore'), c(true)), eq(f('pieceSide'), c('Human')), eq(f('capped'), c(false))), expect: [{ field: 'absorbed', equals: c(false) }, { field: 'fired', equals: c(true) }, { field: 'shieldAfter', equals: c(false) }] }), fidelity: 'faithful', notes: 'two clauses, one per side' } },
  { form: { statement: 'TEST DOUBLE (scripted): a cell that a piece is pushed onto by another effect stays on the board and can go off again.', confidence: 'medium' },
    representation: { rep: rep({ form: 'law', situation: 'effect-entry', when: and(eq(f('arrival'), c('forced')), eq(f('capped'), c(false))), expect: [{ field: 'cellUsedUp', equals: c(false) }] }), fidelity: 'narrower', notes: 'only "stays on the board" is represented; "can go off again" is not representable with the recorded situation fields' } },
  { form: { statement: 'TEST DOUBLE (scripted): effects get stronger the longer the game goes on.', confidence: 'low' },
    representation: { rep: rep({ form: 'law', situation: 'effect-entry', when: { op: 'gt', args: [f('gameStage'), c(10)] }, expect: [{ field: 'strength', equals: { op: 'mul', args: [f('turn'), c(2)] } }] }), fidelity: 'unknown', notes: 'uses a field and an operator outside the closed sets' } },
  { form: { statement: 'TEST DOUBLE (scripted): an unshielded piece always sets an effect off, and a shove pushes it exactly as far as the effect says.', confidence: 'medium' },
    representation: { rep: rep(
      { form: 'law', situation: 'effect-entry', when: and(eq(f('pieceShieldedBefore'), c(false)), eq(f('capped'), c(false))), expect: [{ field: 'fired', equals: c(true) }] },
      { form: 'law', situation: 'effect-entry', when: eq(f('effectKind'), c('shove')), expect: [{ field: 'distanceMoved', equals: f('shoveAmount') }] }), fidelity: 'narrower', notes: 'the shove distance clause names fields that are not recorded situation fields' } },
  { form: { abstain: 'yes', abstainScope: 'TEST DOUBLE (scripted): cannot tell from these observations whether frozen pieces still count towards the actions of a turn.', confidence: 'low' } },
  { form: { statement: 'TEST DOUBLE (scripted): the AI tends to place effects near the middle of the board.', confidence: 'low' } },
];

export async function runP4Demo(expDir: string, o: { at?: string } = {}) {
  const exp = assertWritableOutput(expDir), at = o.at ?? new Date().toISOString();
  await partition(join(ROOT, 'evidence/gw2/procedures/partition-p3-1.json'), join(ROOT, 'evidence/gamewatch/evidence.json'), exp, { fixture: true });
  writeSessionPlan(exp, 1, 'P4 demonstration: one scripted test-double discovery session');
  const s = await startGw2Server({ exp: 'p4-demo', out: exp, site: join(exp, 'partitions/discovery/site'), label: 'test-double' });
  try {
    const base = `http://127.0.0.1:${s.port}`, headers = { 'user-agent': 'gw2-test-double/1', 'content-type': 'application/x-www-form-urlencoded' };
    await fetch(base + '/index.html', { headers }).then(r => r.text());
    await fetch(base + '/hypothesis.html', { headers }).then(r => r.text());
    for (const x of P4_SCRIPT) await fetch(base + '/hypothesis', { method: 'POST', headers, body: new URLSearchParams({ ...x.form, nonce: s.nonce }) }).then(r => r.text());
  } finally { await s.close(); }
  const graph = join(exp, 'judgments.ndjson');
  importSession(s.dir, graph);
  const freeze = freezeHypotheses(exp, { at });
  const nodes = verify(graph).nodes.filter(n => n.kind === 'hypothesis' || n.kind === 'abstention');
  P4_SCRIPT.forEach((x, i) => {
    if (!x.representation) return;
    const h = nodes.find(n => n.body.ref === `H-${i + 1}`)!;
    append(graph, {
      kind: 'representation', parents: [{ id: h.id, relation: 'represents' }], author: { kind: 'test-double', id: 'gw2-representation-test-double', version: '1' }, origin: 'live', at, evidenceRefs: h.evidenceRefs,
      reason: 'structured representation of a frozen hypothesis, recorded separately; the hypothesis node is unchanged',
      body: { schema: 'gamewatch/gw2-representation@1', representation: x.representation.rep, fidelity: { declared: x.representation.fidelity, notes: x.representation.notes }, translatedFrom: { ref: h.body.ref, statementSha256: sha256(String(h.body.statement)) }, method: 'scripted by the P4 test double; no model; not inferred from the free text' },
    });
  });
  const evaluation = evaluateExperiment(exp, { at });
  return { session: s.session, freeze, evaluation };
}

if (process.argv[1]?.endsWith('gw2/p4-demo.ts')) {
  const exp = process.argv[2], i = process.argv.indexOf('--at');
  if (!exp) { console.error('usage: p4-demo.ts <expDir> [--at ISO]'); process.exit(2); }
  const r = await runP4Demo(exp, { at: i > 0 ? process.argv[i + 1] : undefined });
  console.log(`session ${r.session}; frozen ${r.freeze.counts.hypotheses} hypotheses + ${r.freeze.counts.abstentions} abstention(s); ${r.evaluation.nodes.length} evaluation nodes; report ${r.evaluation.file}`);
}
