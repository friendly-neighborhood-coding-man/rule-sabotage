/**
 * GW2 P2: append-only judgment and hypothesis graph (AC-P2.1 – AC-P2.7). Deterministic, no Kane, no model.
 * Scratch graphs live in mkdtemp directories outside the repository; the committed GW1 import is only read.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import * as J from '../gamewatch/gw2/judgments.ts';
import { importGw1, GW1 } from '../gamewatch/gw2/import-gw1.ts';
import { ROOT, FrozenPathError } from '../gamewatch/gw2/paths.ts';

const { append, verify, view, head, canonical, nodeId, fileSha256, sha256, JudgmentError } = J;
const node = (args: string[]) => spawnSync(process.execPath, args, { cwd: ROOT, encoding: 'utf8' });
const scratch = () => mkdtempSync(join(tmpdir(), 'gw2-judg-'));

/** A scratch workspace with an evidence file, a test-double note, and a fake stored "kane" stdout/args. */
function workspace() {
  const dir = scratch();
  writeFileSync(join(dir, 'evidence.json'), '{"cases":["C-1"]}\n');
  const tdNote = JSON.stringify({ at: '2026-11-25T10:00:00.000Z', source: 'test-double', nonceValid: true, category: 'confirmed observable anomaly', claim: 'x' });
  writeFileSync(join(dir, 'notes.ndjson'), tdNote + '\n');
  const kNote = JSON.stringify({ at: '2026-11-25T10:00:00.000Z', source: 'kane', nonceValid: true, category: 'confirmed observable anomaly', claim: 'y' });
  writeFileSync(join(dir, 'kane-notes.ndjson'), kNote + '\n');
  writeFileSync(join(dir, 'stdout.ndjson'), '{"type":"stream_start","cli_version":"9.9.9"}\n{"type":"run_end","verdict":"approved"}\n');
  writeFileSync(join(dir, 'args.json'), '{"cli":"kane-cli","version":"9.9.9"}\n');
  const ref = (p: string) => ({ path: p, sha256: fileSha256(join(dir, p)) });
  return { dir, file: join(dir, 'judgments.ndjson'), ref, tdNote, kNote, opts: { root: dir } };
}
type W = ReturnType<typeof workspace>;
const hyp = (w: W, text = 'a +1 action cell is used up after one arrival'): J.NodeInput => ({
  kind: 'hypothesis', parents: [], author: { kind: 'test-double', id: 'td-agent', version: '1' }, origin: 'live',
  at: '2026-11-25T10:00:00.000Z', evidenceRefs: [w.ref('evidence.json')], body: { text },
});
const evaluation = (w: W, parent: string, extra: Partial<J.NodeInput> = {}): J.NodeInput => ({
  kind: 'evaluation', parents: [{ id: parent, relation: 'evaluates' }], author: { kind: 'verifier', id: 'gw2-test-verifier', version: '0.1.0' },
  origin: 'live', at: '2026-11-25T10:01:00.000Z', evidenceRefs: [w.ref('evidence.json')], criteria: 'trigger/condition/effect checked on every recorded arrival',
  reason: 'the effect fired twice on case C-1 step 4', body: { verdict: 'unsupported' }, ...extra,
});

test('AC-P2.1: appending never rewrites earlier bytes; a refused append leaves the file byte-identical', () => {
  const w = workspace();
  const a = append(w.file, hyp(w), w.opts);
  let before = readFileSync(w.file);
  const b = append(w.file, evaluation(w, a.id), w.opts);
  let after = readFileSync(w.file);
  assert.ok(after.subarray(0, before.length).equals(before), 'prefix unchanged');
  assert.equal(after.subarray(before.length).toString().split('\n').filter(Boolean).length, 1, 'exactly one new line');
  before = after;
  assert.throws(() => append(w.file, { ...hyp(w), parents: [{ id: 'f'.repeat(64), relation: 'refines' }], reason: 'r' }, w.opts), JudgmentError);
  assert.throws(() => append(w.file, hyp(w), w.opts), /already exists/, 'identical content is the same node; not appended twice');
  assert.ok(readFileSync(w.file).equals(before), 'refused appends wrote nothing');
  const c = append(w.file, { ...hyp(w, 'alternative'), parents: [{ id: a.id, relation: 'alternative-to' }], reason: 'competing explanation' }, w.opts);
  assert.ok(readFileSync(w.file).subarray(0, before.length).equals(before));
  assert.deepEqual([a.seq, b.seq, c.seq], [1, 2, 3]);
  assert.equal(nodeId(verify(w.file).nodes[1]), b.id, 'id is the content hash');
  assert.ok(!('update' in J) && !('remove' in J) && !('delete' in J) && !('rewrite' in J), 'no API deletes or overwrites a node');
  rmSync(w.dir, { recursive: true, force: true });
});

test('AC-P2.2: editing, deleting, inserting, reordering or partially writing a line makes verify fail and name the first bad line', () => {
  const w = workspace();
  const a = append(w.file, hyp(w), w.opts), b = append(w.file, evaluation(w, a.id), w.opts);
  append(w.file, { ...hyp(w, 'h2'), parents: [{ id: a.id, relation: 'refines' }], reason: 'narrower' }, w.opts);
  append(w.file, { kind: 'challenge', parents: [{ id: b.id, relation: 'challenges' }], author: { kind: 'operator', id: 'operator', version: 'n/a' }, origin: 'live', at: '2026-11-25T10:02:00.000Z', evidenceRefs: [], reason: 'step 4 is a re-entry', body: {} }, w.opts);
  const good = readFileSync(w.file, 'utf8'), L = good.trimEnd().split('\n');
  assert.equal(verify(w.file).ok, true);
  const cases: [string, string, number][] = [
    ['edit a body field', [L[0], L[1].replace('the effect fired twice', 'the effect fired once'), ...L.slice(2)].join('\n') + '\n', 2],
    ['delete a line', [L[0], ...L.slice(2)].join('\n') + '\n', 2],
    ['reorder two lines', [L[0], L[2], L[1], L[3]].join('\n') + '\n', 2],
    ['insert a copy', [L[0], L[1], L[1], ...L.slice(2)].join('\n') + '\n', 3],
    ['edit the first line', [L[0].replace('td-agent', 'td-agent2'), ...L.slice(1)].join('\n') + '\n', 1],
    ['partial last line', good + L[3].slice(0, 40), 5],
  ];
  for (const [what, text, bad] of cases) {
    writeFileSync(w.file, text);
    const r = verify(w.file);
    assert.equal(r.ok, false, what); assert.equal(r.firstBadLine, bad, `${what}: ${JSON.stringify(r.problems)}`);
    assert.throws(() => append(w.file, hyp(w, 'later'), w.opts), /fails verification at line/, `${what}: further appends refused`);
  }
  // a node edited AND re-hashed changes its id: its own line's chain link and its children's parent link break
  const n = JSON.parse(L[1]); n.node.reason = 'rewritten'; n.node.id = nodeId(n.node);
  writeFileSync(w.file, [L[0], canonical(n), ...L.slice(2)].join('\n') + '\n');
  assert.equal(verify(w.file).firstBadLine, 3, 'the next line no longer chains to the edited line');
  rmSync(w.dir, { recursive: true, force: true });
});

test('integrity limits: tail truncation and a full recomputed rewrite pass the file-only check; an external anchor detects both', () => {
  const w = workspace();
  const a = append(w.file, hyp(w), w.opts); append(w.file, evaluation(w, a.id), w.opts);
  const anchor = head(w.file), L = readFileSync(w.file, 'utf8').trimEnd().split('\n');
  assert.deepEqual(anchor, { count: 2, lastLineSha256: sha256(L[1]) });
  writeFileSync(w.file, L[0] + '\n');
  const t = verify(w.file);
  assert.equal(t.ok, true, 'a shorter valid chain is not detectable from the file alone');
  assert.equal(t.truncation, 'undetectable-without-anchor');
  const ta = verify(w.file, { anchor });
  assert.equal(ta.ok, false); assert.match(ta.problems[0].problem, /tail truncation/);
  // deliberate rewrite: recompute id, chain and seq; detection only against the anchor (no signatures)
  writeFileSync(w.file, ''); const a2 = append(w.file, hyp(w, 'a different claim'), w.opts); append(w.file, evaluation(w, a2.id), w.opts);
  assert.equal(verify(w.file).ok, true, 'a writer who recomputes every hash produces a valid file');
  const ra = verify(w.file, { anchor });
  assert.equal(ra.ok, false); assert.match(ra.problems[0].problem, /anchored prefix was rewritten/);
  rmSync(w.dir, { recursive: true, force: true });
});

test('AC-P2.3: a node whose parent does not exist is refused; parents must already exist, so no cycle can be built', () => {
  const w = workspace();
  const missing = 'a'.repeat(64);
  assert.throws(() => append(w.file, { ...hyp(w), parents: [{ id: missing, relation: 'refines' }], reason: 'r' }, w.opts), /does not exist in this graph/);
  assert.ok(!existsSync(w.file), 'nothing written');
  const a = append(w.file, hyp(w), w.opts);
  // a node cannot name itself (its id depends on its parents) nor a later node (which does not exist yet)
  const self = { ...hyp(w, 'self'), parents: [{ id: a.id, relation: 'refines' as const }], reason: 'r' };
  const selfId = nodeId(self);
  assert.throws(() => append(w.file, { ...self, parents: [{ id: selfId, relation: 'refines' }] }, w.opts), /does not exist/);
  assert.throws(() => append(w.file, { ...hyp(w), parents: [{ id: a.id, relation: 'causes' as J.Relation }], reason: 'r' }, w.opts), /relation must be one of/);
  assert.throws(() => append(w.file, { ...hyp(w, 'no reason'), parents: [{ id: a.id, relation: 'challenges' }] }, w.opts), /must state a reason/);
  // forged file with a forward reference is invalid
  const L = readFileSync(w.file, 'utf8').trimEnd().split('\n');
  const fwd = { ...hyp(w, 'fwd'), parents: [{ id: 'b'.repeat(64), relation: 'refines' as const }], reason: 'r' };
  writeFileSync(w.file, L[0] + '\n' + canonical({ schema: J.JUDGMENT_SCHEMA, seq: 2, prev: sha256(L[0]), node: { ...fwd, id: nodeId(fwd) } }) + '\n');
  const r = verify(w.file); assert.equal(r.firstBadLine, 2); assert.match(r.problems[0].problem, /does not exist/);
  rmSync(w.dir, { recursive: true, force: true });
});

test('AC-P2.4: a verifier rejection is a new evaluates node; an operator challenge of it and a later re-evaluation are accepted; all stay readable; nothing is declared final', () => {
  const w = workspace();
  const h = append(w.file, hyp(w), w.opts);
  const rej = append(w.file, evaluation(w, h.id), w.opts);
  const ch = append(w.file, { kind: 'challenge', parents: [{ id: rej.id, relation: 'challenges' }], author: { kind: 'operator', id: 'operator', version: 'n/a' }, origin: 'live', at: '2026-11-25T11:00:00.000Z', evidenceRefs: [w.ref('evidence.json')], reason: 'the verifier counted a re-entry as a second arrival; the encoding of R8 is wrong', body: {} }, w.opts);
  // the verifier's judgment is itself evaluated (challenged) and a corrected verifier version re-evaluates; the old one stays
  const re = append(w.file, evaluation(w, h.id, { author: { kind: 'verifier', id: 'gw2-test-verifier', version: '0.1.1' }, reason: 're-entry is a new arrival under the corrected encoding', body: { verdict: 'supported' }, parents: [{ id: h.id, relation: 'evaluates' }, { id: rej.id, relation: 'supersedes' }] }), w.opts);
  const ch2 = append(w.file, { kind: 'evaluation', parents: [{ id: re.id, relation: 'evaluates' }], author: { kind: 'verifier', id: 'gw2-encoding-check', version: '1' }, origin: 'live', at: '2026-11-25T11:05:00.000Z', evidenceRefs: [w.ref('evidence.json')], criteria: 'encoding review', reason: 'verifier judgments are evaluable too', body: { verdict: 'consistent' } }, w.opts);
  const v = view(w.file);
  assert.equal(v.nodes.length, 5, 'every node readable, the superseded rejection included');
  const by = Object.fromEntries(v.nodes.map(n => [n.id, n]));
  assert.deepEqual(by[h.id].evaluatedBy, [rej.id, re.id]);
  assert.deepEqual(by[rej.id].challengedBy, [ch.id]);
  assert.deepEqual(by[rej.id].supersededBy, [re.id]);
  assert.deepEqual(by[re.id].evaluatedBy, [ch2.id]);
  assert.equal(verify(w.file).nodes.find(n => n.id === rej.id)!.body.verdict, 'unsupported', 'the original rejection is unchanged');
  const keys = JSON.stringify(v);
  for (const k of ['"final"', '"truth"', '"winner"', '"resolved"', '"accepted"', '"status"']) assert.ok(!keys.includes(k), `view has no ${k} field`);
  assert.ok(!Object.keys(J).some(k => /final|truth|winner|resolve|decide/i.test(k)), 'no API declares a judgment final');
  rmSync(w.dir, { recursive: true, force: true });
});

test('AC-P2.5: an evaluates node without evaluator id, evaluator version, evidence refs, criteria or reason is refused', () => {
  const w = workspace();
  const h = append(w.file, hyp(w), w.opts), size = readFileSync(w.file).length;
  const full = evaluation(w, h.id);
  const variants: [string, J.NodeInput][] = [
    ['evaluator id', { ...full, author: { ...full.author, id: '' } }],
    ['evaluator version', { ...full, author: { ...full.author, version: ' ' } }],
    ['evidence refs', { ...full, evidenceRefs: [] }],
    ['criteria', { ...full, criteria: undefined }],
    ['reason', { ...full, reason: undefined }],
  ];
  for (const [what, n] of variants) assert.throws(() => append(w.file, n, w.opts), (e: Error) => e instanceof JudgmentError && e.message.includes(what), what);
  assert.throws(() => append(w.file, { ...full, evidenceRefs: [{ path: 'evidence.json', sha256: '0'.repeat(64) }] }, w.opts), /does not match its recorded sha256/, 'evidence refs are checked against the files');
  assert.equal(readFileSync(w.file).length, size);
  append(w.file, full, w.opts);
  rmSync(w.dir, { recursive: true, force: true });
});

test('AC-P2.6: Kane attribution needs a stored kane-cli output by hash and a verbatim Kane note; a test double never carries the Kane label', () => {
  const w = workspace();
  const kaneRef = (notesFile: string, line: string) => ({ ...w.ref(notesFile), line: 1, lineSha256: sha256(line) });
  const kane = (over: Partial<J.NodeInput> = {}): J.NodeInput => ({
    kind: 'finding', parents: [], author: { kind: 'agent', id: 'kane-cli', version: '9.9.9' }, origin: 'live', at: '2026-11-25T10:00:00.000Z',
    evidenceRefs: [kaneRef('kane-notes.ndjson', w.kNote)], body: { verbatim: w.kNote },
    provenance: { kaneStdout: w.ref('stdout.ndjson'), kaneArgs: w.ref('args.json'), note: kaneRef('kane-notes.ndjson', w.kNote) }, ...over,
  });
  const refused: [string, J.NodeInput, RegExp][] = [
    ['test double labelled Kane', kane({ author: { kind: 'test-double', id: 'kane-cli', version: '9.9.9' } }), /test double can never carry the Kane label/],
    ['Kane without provenance', kane({ provenance: undefined }), /requires provenance/],
    ['test-double note attributed to Kane', kane({ body: { verbatim: w.tdNote }, provenance: { kaneStdout: w.ref('stdout.ndjson'), kaneArgs: w.ref('args.json'), note: kaneRef('notes.ndjson', w.tdNote) } }), /source is "test-double", not "kane"/],
    ['stored output hash mismatch', kane({ provenance: { kaneStdout: { path: 'stdout.ndjson', sha256: '1'.repeat(64) }, kaneArgs: w.ref('args.json'), note: kaneRef('kane-notes.ndjson', w.kNote) } }), /does not match its recorded sha256/],
    ['not a kane-cli output', kane({ provenance: { kaneStdout: w.ref('evidence.json'), kaneArgs: w.ref('args.json'), note: kaneRef('kane-notes.ndjson', w.kNote) } }), /no stream_start/],
    ['version mismatch', kane({ author: { kind: 'agent', id: 'kane-cli', version: '0.10.4' } }), /does not match author version/],
    ['body not verbatim', kane({ body: { verbatim: w.kNote + ' ' } }), /byte for byte/],
    ['non-Kane node with a Kane reference', { ...hyp(w), provenance: kane().provenance }, /must not carry a Kane reference/],
  ];
  for (const [what, n, re] of refused) assert.throws(() => append(w.file, n, w.opts), re, what);
  assert.ok(!existsSync(w.file), 'nothing written');
  append(w.file, kane(), w.opts);
  append(w.file, hyp(w), w.opts); // a test-double node without the label is fine
  // a forged label in a stored file is caught by verify (structure) and by verify --check-refs (provenance)
  const L = readFileSync(w.file, 'utf8').trimEnd().split('\n'), x = JSON.parse(L[1]);
  x.node.author.id = 'kane-cli'; x.node.id = nodeId(x.node);
  writeFileSync(w.file, L[0] + '\n' + canonical({ ...x, prev: sha256(L[0]) }) + '\n');
  const r = verify(w.file); assert.equal(r.firstBadLine, 2); assert.match(r.problems[0].problem, /test double can never carry the Kane label/);
  rmSync(w.dir, { recursive: true, force: true });
});

test('AC-P2.7: GW1 import has 3 Kane findings + 3 labels, each label evaluates its finding, clean and anomaly findings coexist; deterministic; GW1 untouched', () => {
  const committed = join(ROOT, 'evidence/gw2/gw1-import/judgments.ndjson');
  const srcHashes = Object.values(GW1).map(p => fileSha256(join(ROOT, p)));
  const dir = scratch(), fresh = join(dir, 'judgments.ndjson');
  importGw1(fresh);
  assert.ok(readFileSync(fresh).equals(readFileSync(committed)), 'committed import = fresh import, byte for byte');
  assert.throws(() => importGw1(fresh), /refusing to import into an existing file/);
  const v = verify(committed, { checkRefs: true });
  assert.equal(v.ok, true, JSON.stringify(v.problems));
  const findings = v.nodes.filter(n => n.kind === 'finding'), labels = v.nodes.filter(n => n.kind === 'label');
  assert.equal(findings.length, 3); assert.equal(labels.length, 3);
  const notes = readFileSync(join(ROOT, GW1.notes), 'utf8').split('\n').filter(Boolean);
  assert.deepEqual(findings.map(f => f.body.verbatim), notes, 'findings preserved byte for byte');
  assert.ok(findings.every(f => f.author.id === 'kane-cli' && f.author.version === '0.10.4' && f.author.kind === 'agent' && f.origin === 'historical-import' && f.provenance));
  assert.deepEqual(findings.map(f => f.body.category), ['clean / no problem found', 'confirmed observable anomaly', 'confirmed observable anomaly']);
  labels.forEach((l, i) => {
    assert.deepEqual(l.parents, [{ id: findings[i].id, relation: 'evaluates' }]);
    assert.ok(l.criteria && l.reason && l.evidenceRefs.length === 2 && l.author.version && !/kane/i.test(l.author.id) && l.origin === 'historical-import');
  });
  assert.equal(labels[0].body.label, 'false negative (inconsistent clean report)');
  const vw = view(committed);
  assert.ok(vw.nodes.every(n => n.supersededBy.length === 0 && n.challengedBy.length === 0), 'no import node supersedes or challenges another');
  assert.deepEqual(Object.values(GW1).map(p => fileSha256(join(ROOT, p))), srcHashes, 'GW1 sources unchanged');
  const b = node(['scripts/gw2-baseline.mjs', 'verify']); assert.equal(b.status, 0, b.stdout);
  const cli = node(['--experimental-strip-types', '--no-warnings', 'gamewatch/gw2/judgments.ts', 'verify', committed, '--check-refs']);
  assert.equal(cli.status, 0, cli.stdout + cli.stderr);
  rmSync(dir, { recursive: true, force: true });
});

test('output guard: judgment files are never written under frozen GW1 paths or outside evidence/gw2/ in the repository', () => {
  const w = workspace();
  for (const p of ['evidence/gamewatch/review/judgments.ndjson', 'gamewatch/private/evaluation/judgments.ndjson', 'docs/gw2/judgments.ndjson'])
    assert.throws(() => append(join(ROOT, p), hyp(w), w.opts), FrozenPathError, p);
  const r = node(['--experimental-strip-types', '--no-warnings', 'gamewatch/gw2/import-gw1.ts', join(ROOT, 'evidence/gamewatch/review/j.ndjson')]);
  assert.notEqual(r.status, 0); assert.match(r.stderr, /frozen GW1 path/);
  rmSync(w.dir, { recursive: true, force: true });
});
