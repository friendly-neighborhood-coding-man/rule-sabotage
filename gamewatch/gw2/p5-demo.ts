/**
 * GW2 P5 end-to-end demonstration with deterministic TEST DOUBLES (no Kane, no model):
 *
 *   node --experimental-strip-types --no-warnings gamewatch/gw2/p5-demo.ts <bundle.json> <expDir> [--at ISO]
 *
 * 1. partition the P5 generated bundle with the frozen P5 partition procedure (an experimental partition: the bundle
 *    was generated after the procedure was frozen);
 * 2. one declared session; a scripted test double submits free text, some WITH an optional structured representation
 *    (Q20 submitter-first), competing hypotheses, an unreadable representation, an abstention and free text only;
 * 3. explicit import; hypothesis freeze; submitter representations extracted verbatim; external translations by an
 *    operator test double for two free-text-only hypotheses (declared: no spec / held-out / eval access);
 * 4. the representation set is SEALED before any evaluation is opened;
 * 5. three-way verification (verify.ts), held-out prediction (heldout.ts) and discrimination (discriminate.ts), all
 *    through the gate.
 * Every submission is scripted, labelled TEST DOUBLE, and measures no agent.
 */
import { join } from 'node:path';
import { partition } from './partition.ts';
import { startGw2Server } from './serve.ts';
import { importSession } from './import-session.ts';
import { freezeHypotheses, writeSessionPlan } from './freeze.ts';
import { verify } from './judgments.ts';
import { appendSubmitterRepresentations, appendTranslation, sealRepresentations } from './representations.ts';
import { evaluateExperiment } from './verify.ts';
import { evaluateHeldout, P5_ENCODING } from './heldout.ts';
import { discriminate } from './discriminate.ts';
import { ROOT, assertWritableOutput } from './paths.ts';
import { HYPOTHESIS_SCHEMA } from './hypothesis.ts';

const f = (name: string) => ({ op: 'field', name }), c = (value: unknown) => ({ op: 'const', value });
const eq = (a: unknown, b: unknown) => ({ op: 'eq', args: [a, b] }), add = (a: unknown, b: unknown) => ({ op: 'add', args: [a, b] });
const and = (...args: unknown[]) => ({ op: 'and', args });
const rep = (...clauses: unknown[]) => JSON.stringify({ schema: HYPOTHESIS_SCHEMA, clauses });
const TD = 'TEST DOUBLE (scripted): ';

/** Scripted submissions: `representation` is the optional field typed by the submitter (a JSON string, or not JSON). */
export const P5_SCRIPT: { form: Record<string, string>; translation?: { rep: unknown; fidelity: string; notes: string } }[] = [
  { form: { statement: `${TD}the side that moved first gets one more action at each of its turn starts than pieces plus earned extras.`, confidence: 'medium',
    representation: rep({ form: 'law', situation: 'turn-start', when: eq(f('isFirstMover'), c(true)), expect: [{ field: 'actionsGranted', equals: add(add(f('piecesOnBoard'), f('pendingBonus')), c(1)) }] }, { form: 'law', situation: 'turn-start', when: eq(f('isFirstMover'), c(false)), expect: [{ field: 'actionsGranted', equals: add(f('piecesOnBoard'), f('pendingBonus')) }] }) } },
  { form: { statement: `${TD}each side gets one action per own piece on the board plus extras it earned, whoever moved first.`, confidence: 'low', competingWith: 'H-1',
    representation: rep({ form: 'law', situation: 'turn-start', expect: [{ field: 'actionsGranted', equals: add(f('piecesOnBoard'), f('pendingBonus')) }] }) } },
  { form: { statement: `${TD}every turn starts with three actions.`, confidence: 'low', competingWith: 'H-2',
    representation: rep({ form: 'law', situation: 'turn-start', expect: [{ field: 'actionsGranted', equals: c(3) }] }) } },
  { form: { statement: `${TD}a shielded AI piece ignores the next effect cell, but a shielded Human piece is hit and loses its shield.`, confidence: 'medium',
    representation: rep(
      { form: 'law', situation: 'effect-entry', when: and(eq(f('pieceShieldedBefore'), c(true)), eq(f('pieceSide'), c('AI')), eq(f('capped'), c(false))), expect: [{ field: 'absorbed', equals: c(true) }, { field: 'fired', equals: c(false) }] },
      { form: 'law', situation: 'effect-entry', when: and(eq(f('pieceShieldedBefore'), c(true)), eq(f('pieceSide'), c('Human')), eq(f('capped'), c(false))), expect: [{ field: 'absorbed', equals: c(false) }, { field: 'fired', equals: c(true) }] }) } },
  { form: { statement: `${TD}a shield protects any piece from the next effect cell it enters.`, confidence: 'medium', competingWith: 'H-4',
    representation: rep({ form: 'law', situation: 'effect-entry', when: and(eq(f('pieceShieldedBefore'), c(true)), eq(f('capped'), c(false))), expect: [{ field: 'absorbed', equals: c(true) }, { field: 'fired', equals: c(false) }] }) } },
  { form: { statement: `${TD}a cell a piece is pushed onto by another effect stays on the board.`, confidence: 'medium' },
    translation: { rep: { schema: HYPOTHESIS_SCHEMA, clauses: [{ form: 'law', situation: 'effect-entry', when: and(eq(f('arrival'), c('forced')), eq(f('capped'), c(false))), expect: [{ field: 'cellUsedUp', equals: c(false) }] }] }, fidelity: 'faithful', notes: 'operator test-double translation of the free text' } },
  { form: { statement: `${TD}an unshielded piece that walks onto a Send home cell goes back to its start.`, confidence: 'high',
    representation: rep({ form: 'law', situation: 'effect-entry', when: and(eq(f('effectKind'), c('send-home')), eq(f('pieceShieldedBefore'), c(false)), eq(f('capped'), c(false))), expect: [{ field: 'sentHome', equals: c(true) }] }) } },
  { form: { statement: `${TD}an effect cannot be placed right next to a piece.`, confidence: 'medium' },
    translation: { rep: { schema: HYPOTHESIS_SCHEMA, clauses: [{ form: 'law', situation: 'effect-placement', when: eq(f('nearAnyPiece'), c(true)), expect: [{ field: 'placed', equals: c(false) }] }] }, fidelity: 'faithful', notes: 'operator test-double translation of the free text' } },
  { form: { statement: `${TD}freeze cells only work on the side that did not place them.`, confidence: 'low', representation: '{"schema": "gamewatch/gw2-hypothesis@1", "clauses": [ {"form": "law", ' } },
  { form: { abstain: 'yes', abstainScope: `${TD}cannot tell whether a frozen piece still counts towards the actions of a turn.`, confidence: 'low' } },
  { form: { statement: `${TD}the computer player prefers to race its middle piece.`, confidence: 'low' } },
];

export async function runP5Demo(bundleFile: string, expDir: string, o: { at?: string } = {}) {
  const exp = assertWritableOutput(expDir), at = o.at ?? new Date().toISOString();
  const part = await partition(join(ROOT, 'evidence/gw2/procedures/partition-p5-1.json'), bundleFile, exp, { structuredField: true });
  writeSessionPlan(exp, 1, 'P5 demonstration: one scripted test-double discovery session');
  const s = await startGw2Server({ exp: 'p5-demo', out: exp, site: join(exp, 'partitions/discovery/site'), label: 'test-double' });
  try {
    const base = `http://127.0.0.1:${s.port}`, headers = { 'user-agent': 'gw2-test-double/1', 'content-type': 'application/x-www-form-urlencoded' };
    for (const p of ['/index.html', '/hypothesis.html']) await fetch(base + p, { headers }).then(r => r.text());
    for (const x of P5_SCRIPT) await fetch(base + '/hypothesis', { method: 'POST', headers, body: new URLSearchParams({ ...x.form, nonce: s.nonce }) }).then(r => r.text());
  } finally { await s.close(); }
  const graph = join(exp, 'judgments.ndjson');
  importSession(s.dir, graph);
  const freeze = freezeHypotheses(exp, { at });
  const submitter = appendSubmitterRepresentations(exp, { at });
  const nodes = verify(graph).nodes.filter(n => n.kind === 'hypothesis');
  const translations = P5_SCRIPT.flatMap((x, i) => x.translation ? [appendTranslation(exp, nodes.find(n => n.body.ref === `H-${i + 1}`)!.id, {
    representation: x.translation.rep, author: { kind: 'test-double', id: 'gw2-operator-translation-test-double', version: '1' }, fidelity: x.translation.fidelity, notes: x.translation.notes,
    access: { spec: false, heldout: false, eval: false }, method: 'scripted by the P5 test double from the free text; no model; written before any evaluation opening', at })] : []);
  const seal = sealRepresentations(exp, { at });
  const threeWay = evaluateExperiment(exp, { at, encoding: P5_ENCODING });
  const heldout = evaluateHeldout(exp, { at });
  const disc = discriminate(exp, { at });
  return { session: s.session, partition: part, freeze, submitter, translations, seal, threeWay, heldout, discrimination: disc };
}

if (process.argv[1]?.endsWith('gw2/p5-demo.ts')) {
  const [bundle, exp] = process.argv.slice(2), i = process.argv.indexOf('--at');
  if (!bundle || !exp) { console.error('usage: p5-demo.ts <bundle.json> <expDir> [--at ISO]'); process.exit(2); }
  const r = await runP5Demo(bundle, exp, { at: i > 0 ? process.argv[i + 1] : undefined });
  console.log(`session ${r.session}; frozen ${r.freeze.counts.hypotheses} + ${r.freeze.counts.abstentions} abstention(s); ${r.submitter.length} submitter + ${r.translations.length} external representation(s) sealed; reports ${r.threeWay.file}, ${r.heldout.file}, ${r.discrimination.file}`);
}
