/**
 * GW2 P3: partitions, blind discovery site, leak check, hypothesis submission, explicit session import, freeze and the
 * evaluation gate (AC-P3.1 – AC-P3.6). Deterministic test doubles only: no Kane, no model. Scratch experiments live in
 * mkdtemp directories outside the repository; the committed fixture (evidence/gw2/p3-fixture) is only read.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, cpSync, readFileSync, writeFileSync, readdirSync, rmSync, existsSync, appendFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { spawnSync } from 'node:child_process';
import { ROOT, FrozenPathError } from '../gamewatch/gw2/paths.ts';
import { partition, verifyPartitions, loadProcedure, PartitionError } from '../gamewatch/gw2/partition.ts';
import { specGuidedSite } from '../gamewatch/gw2/blind-site.ts';
import { leakCheck } from '../gamewatch/gw2/leak-check.ts';
import { startGw2Server } from '../gamewatch/gw2/serve.ts';
import { importSession, planSessionImport, sessionImportStatus, ImportError } from '../gamewatch/gw2/import-session.ts';
import { freezeHypotheses, verifyFreeze, openEvaluation, writeSessionPlan, FreezeError } from '../gamewatch/gw2/freeze.ts';
import { sealSession, sessionClosure } from '../gamewatch/gw2/session-close.ts';
import { verify, append, nodeId, canonical, sha256 } from '../gamewatch/gw2/judgments.ts';
import { req } from './gw2-fixtures.ts';
import type { GWBundle } from '../gamewatch/evidence.ts';

const FIX = join(ROOT, 'evidence/gw2/p3-fixture'), PROC = join(ROOT, 'evidence/gw2/procedures/partition-p3-1.json'), GW1 = join(ROOT, 'evidence/gamewatch/evidence.json');
const scratch = () => mkdtempSync(join(tmpdir(), 'gw2-p3-'));
const walk = (d: string): string[] => readdirSync(d).sort().flatMap(n => statSync(join(d, n)).isDirectory() ? walk(join(d, n)).map(x => `${n}/${x}`) : [n]);
/** A scratch experiment holding a copy of the committed fixture partitions (no sessions, no graph). */
function scratchExp(sessions = 1) { const d = scratch(), exp = join(d, 'exp'); cpSync(join(FIX, 'partitions'), join(exp, 'partitions'), { recursive: true }); writeSessionPlan(exp, sessions, 'test'); return { d, exp }; }
const disc = (exp: string) => JSON.parse(readFileSync(join(exp, 'partitions/discovery/observations.json'), 'utf8'));

/** One test-double session: two competing hypotheses and one abstention, plus a finding. */
async function session(exp: string, o: { accessLog?: boolean; extra?: (port: number, nonce: string) => Promise<void> } = {}) {
  const s = await startGw2Server({ exp: 'p3-test', out: exp, site: join(exp, 'partitions/discovery/site'), label: 'test-double', ...(o.accessLog === false ? { accessLog: false, loggingDisabledReason: 'test: authorized logging-off condition' } : {}) });
  try {
    const post = (path: string, f: Record<string, string>) => req(s.port, path, { method: 'POST', body: new URLSearchParams({ nonce: s.nonce, ...f }).toString() });
    const form = (await req(s.port, '/hypothesis.html')).body.toString();
    assert.match(form, new RegExp(`value="${s.nonce}"`), 'the hypothesis form carries the session nonce');
    const r1 = await post('/hypothesis', { statement: 'H one', trigger: 't', confidence: 'high' });
    const r2 = await post('/hypothesis', { statement: 'H two, competing', confidence: 'low', competingWith: 'H-1' });
    const r3 = await post('/hypothesis', { abstain: 'yes', abstainScope: 'cannot decide', statement: '' });
    assert.match(r1.body.toString(), />H-1</); assert.match(r2.body.toString(), />H-2</); assert.match(r3.body.toString(), /Abstention stored as <b id="ref">H-3/);
    await post('/report', { category: 'balance hypothesis', claim: 'finding', evidence: disc(exp).cases[0].caseId });
    if (o.extra) await o.extra(s.port, s.nonce);
  } finally { await s.close(); }
  return s;
}

test('Q5 partition: deterministic from the frozen procedure; disjoint seeds and script variants; coverage reported; fixture labelled', async () => {
  const d = scratch(), exp = join(d, 'exp');
  const r = await partition(PROC, GW1, exp, { fixture: true });
  // byte-identical to the committed fixture partitions
  const a = walk(join(exp, 'partitions')), b = walk(join(FIX, 'partitions'));
  assert.deepEqual(a, b);
  for (const f of a) assert.ok(readFileSync(join(exp, 'partitions', f)).equals(readFileSync(join(FIX, 'partitions', f))), f);
  const { discovery: D, heldout: H } = r.split;
  assert.equal(D.seeds.filter(x => H.seeds.includes(x)).length, 0, 'disjoint seeds');
  assert.equal(D.scripts.filter(x => H.scripts.includes(x)).length, 0, 'disjoint scripts');
  for (const fam of ['shield', 'freeze', 'shove', 'shove-chain']) assert.equal([...D.scripts, ...H.scripts].filter(x => x === `${fam}-human` || x === `${fam}-ai`).length, 2, `${fam}: one variant per partition`);
  for (const fam of ['shield', 'freeze', 'shove', 'shove-chain']) assert.ok(D.scripts.some(x => x.startsWith(fam + '-')) && H.scripts.some(x => x.startsWith(fam + '-')));
  assert.ok(Math.abs(r.split.share.discovery - 0.7) < 0.05, `share ${r.split.share.discovery}`);
  assert.deepEqual(r.split.coverage.notCoveredInDiscovery, ['R12']); assert.deepEqual(r.split.coverage.notCoveredInHeldout, ['R5']);
  assert.deepEqual(r.split.coverage.notCoveredAnywhere, []);
  const P = JSON.parse(readFileSync(join(exp, 'partitions/PARTITION.json'), 'utf8'));
  assert.match(P.fixture, /NOT an experimental partition/); assert.equal(P.generatedBeforeFreeze, true);
  for (const p of ['discovery', 'spec', 'heldout', 'eval']) assert.match(JSON.parse(readFileSync(join(exp, 'partitions', p, 'MANIFEST.json'), 'utf8')).fixture, /FIXTURE/);
  assert.deepEqual(verifyPartitions(exp), []);
  // refusals: a bundle generated before the freeze without --fixture; an existing output; a tampered procedure
  await assert.rejects(partition(PROC, GW1, join(d, 'exp2')), /generated .* before the procedure was frozen/);
  await assert.rejects(partition(PROC, GW1, exp, { fixture: true }), /refusing to overwrite existing partitions/);
  const bad = JSON.parse(readFileSync(PROC, 'utf8')); bad.coverageMap.sha256 = '0'.repeat(64); writeFileSync(join(d, 'bad.json'), JSON.stringify(bad));
  assert.throws(() => loadProcedure(join(d, 'bad.json')), PartitionError);
  const later: GWBundle = { ...JSON.parse(readFileSync(GW1, 'utf8')), generatedAt: '2026-12-01T00:00:00.000Z' };
  writeFileSync(join(d, 'later.json'), JSON.stringify(later));
  const r2 = await partition(PROC, join(d, 'later.json'), join(d, 'exp3'));
  assert.deepEqual(r2.split.discovery, D, 'a bundle generated after the freeze is partitioned without the fixture label, identically');
  assert.ok(!('fixture' in JSON.parse(readFileSync(join(d, 'exp3/partitions/PARTITION.json'), 'utf8'))));
  // the split takes no agent output: partition.ts imports nothing from sessions, findings or the graph
  const src = readFileSync(join(ROOT, 'gamewatch/gw2/partition.ts'), 'utf8');
  assert.ok(!/from '\.\/(session|import-session|freeze|policy|coverage)\.ts'/.test(src));
  // manifests detect a change
  appendFileSync(join(exp, 'partitions/heldout/observations.json'), ' ');
  assert.match(verifyPartitions(exp).join(), /heldout: changed observations.json/);
  writeFileSync(join(exp, 'partitions/discovery/site/extra.html'), 'x');
  assert.match(verifyPartitions(exp).join(), /discovery: file not in manifest: site\/extra.html/);
  rmSync(d, { recursive: true, force: true });
});

test('AC-P3.1: the blind site has no rule ids, rule text runs, script titles, build notes or labels, foreign ids or metadata; injected leaks are caught', () => {
  const r = leakCheck(FIX);
  assert.equal(r.ok, true, JSON.stringify(r.checks.filter(c => c.result === 'fail')));
  assert.deepEqual(JSON.parse(readFileSync(join(FIX, 'LEAK_CHECK.json'), 'utf8')), JSON.parse(JSON.stringify(r)), 'committed leak report = fresh check');
  assert.ok(r.residualSemanticClues.effectNames.some(e => e.name === 'Shield'), 'observable effect names are reported as residual clues');
  assert.ok(r.residualSemanticClues.engineMessages.some(m => /8 squares around any piece/.test(m.message)), 'the referee message that nearly states a rule is recorded');
  const { d, exp } = scratchExp(), site = join(exp, 'partitions/discovery/site');
  const eval_ = JSON.parse(readFileSync(join(exp, 'partitions/eval/eval.json'), 'utf8'));
  const heldId = Object.keys(eval_.idMaps.heldout.cases)[0], origId = Object.values(eval_.idMaps.discovery.cases)[0] as string;
  const injections: [string, (html: string) => string, RegExp][] = [
    ['rule id', h => h.replace('</h1>', ' R8</h1>'), /rule ids/],
    ['8-word rule run', h => h.replace('</h1>', ' an effect cell fires when a piece arrives on it</h1>'), /8-word runs from rule texts/],
    ['script title', h => h.replace('</h1>', ' Human walks onto its own "+1 action" cell, steps off and back on</h1>'), /original script titles/],
    ['script id', h => h.replace('</h1>', ' shove-chain-human</h1>'), /script ids/],
    ['build label', h => h.replace('</h1>', ' QX-73</h1>'), /build labels/],
    ['build note', h => h.replace('</h1>', ' Build submitted for QA. Build labels are arbitrary.</h1>'), /build notes/],
    ['mutation class', h => h.replace('</h1>', ' state lifecycle defect</h1>'), /mutation classes/],
    ['held-out id', h => h.replace('</h1>', ` ${heldId}</h1>`), /ids of another partition/],
    ['original id', h => h.replace('</h1>', ` ${origId}</h1>`), /ids of another partition/],
    ['seed', h => h.replace('</h1>', ' seed 97006</h1>'), /seeds/],
    ['generator metadata', h => h.replace('</h1>', ' from evidence/gamewatch/evidence.json</h1>'), /generator metadata/],
    ['game name', h => h.replace('<title>', '<title>Rule Sabotage '), /game name/],
    ['embedded JSON', h => h.replace('</body>', '<script type="application/json">{"rules":[]}</script></body>'), /script tags, embedded JSON/],
    ['meta tag', h => h.replace('<meta charset="utf-8">', '<meta charset="utf-8"><meta name="description" content="x">'), /meta tags/],
    ['link out of the directory', h => h.replace('</h1>', '<a href="../observations.json">x</a></h1>'), /navigation/],
  ];
  const idx = join(site, 'index.html'), orig = readFileSync(idx, 'utf8');
  for (const [what, inject, check] of injections) {
    writeFileSync(idx, inject(orig));
    const fails = leakCheck(exp).checks.filter(c => c.result === 'fail').map(c => c.check).join(' | ');
    assert.match(fails, check, what);
  }
  writeFileSync(idx, orig);
  writeFileSync(join(site, 'case-shield-human.html'), '<p>x</p>');
  const names = leakCheck(exp).checks.filter(c => c.result === 'fail').map(c => c.check);
  assert.ok(names.includes('anonymous file names') && names.includes('served directory = INPUT_BOUNDARY.json listing'), names.join());
  rmSync(d, { recursive: true, force: true });
});

test('AC-P3.2: the server serves only the declared discovery directory; spec, held-out and eval files are not reachable through it', async () => {
  const { d, exp } = scratchExp();
  const boundary = JSON.parse(readFileSync(join(exp, 'partitions/INPUT_BOUNDARY.json'), 'utf8'));
  assert.equal(boundary.served, 'discovery/site'); assert.match(boundary.isolation, /Logical separation on one machine/); assert.match(boundary.isolation, /No OS sandbox/);
  assert.deepEqual(Object.keys(boundary.files).sort(), readdirSync(join(exp, 'partitions/discovery/site')).sort());
  const s = await startGw2Server({ exp: 'p3-test', out: exp, site: join(exp, 'partitions/discovery/site') });
  try {
    for (const p of ['/index.html', '/hypothesis.html', `/case-${disc(exp).cases[0].caseId}.html`]) assert.equal((await req(s.port, p)).status, 200, p);
    for (const p of ['/../heldout/observations.json', '/%2e%2e/heldout/observations.json', '/../../partitions/eval/eval.json', '/../spec/spec.json', '/../observations.json', '/MANIFEST.json', '/../INPUT_BOUNDARY.json', `/case-${Object.keys(JSON.parse(readFileSync(join(exp, 'partitions/eval/eval.json'), 'utf8')).idMaps.heldout.cases)[0]}.html`])
      assert.equal((await req(s.port, p)).status, 404, p);
  } finally { await s.close(); }
  rmSync(d, { recursive: true, force: true });
});

test('AC-P3.3: two competing hypotheses and one abstention become three graph nodes; nothing is overwritten; import is explicit, idempotent and resumable', async () => {
  const { d, exp } = scratchExp();
  const s = await session(exp), graph = join(exp, 'judgments.ndjson');
  const hl = readFileSync(join(s.dir, 'hypotheses.ndjson'), 'utf8').split('\n').filter(Boolean);
  assert.equal(hl.length, 3, 'every submission stored, none overwritten');
  assert.ok(!existsSync(graph), 'the review server never writes the graph');
  // resumable: a partial import (first two planned nodes) is completed by the next run
  const plan = planSessionImport(s.dir);
  append(graph, plan.nodes[0].node); append(graph, plan.nodes[1].node);
  const before = readFileSync(graph);
  const r = importSession(s.dir, graph);
  assert.ok(readFileSync(graph).subarray(0, before.length).equals(before), 'existing lines untouched');
  assert.deepEqual(r.nodes.map(n => n.status), ['already-present', 'already-present', 'appended', 'appended']);
  const again = importSession(s.dir, graph);
  assert.ok(again.nodes.every(n => n.status === 'already-present'), 'idempotent');
  const nodes = verify(graph, { checkRefs: true }).nodes;
  const hyps = nodes.filter(n => n.kind === 'hypothesis'), abst = nodes.filter(n => n.kind === 'abstention');
  assert.equal(hyps.length, 2); assert.equal(abst.length, 1);
  assert.deepEqual(hyps.map(h => h.body.verbatim).concat(abst.map(a => a.body.verbatim)), hl, 'each submission quoted verbatim');
  assert.deepEqual(hyps[1].parents, [{ id: hyps[0].id, relation: 'alternative-to' }], 'declared competition is a link, not a replacement');
  assert.equal(hyps[0].parents.length, 0); assert.ok(nodes.every(n => n.author.kind === 'test-double' && !/kane/i.test(n.author.id)));
  assert.ok(nodes.every(n => n.body.verification === 'journal-verified' && (n.body.sessionValidity as { status: string }).status === 'verified'));
  const st = sessionImportStatus(s.dir, graph);
  assert.deepEqual({ ...st, closure: st.closure.status }, { session: s.session, complete: true, missing: [], closure: 'closed' });
  // conflict: a session line changed after import is refused, nothing written. The seal catches it first; with the seal
  // replaced (CLOSED.json removed and re-declared), the graph conflict check still catches it.
  const size = readFileSync(graph).length, hf = join(s.dir, 'hypotheses.ndjson');
  writeFileSync(hf, readFileSync(hf, 'utf8').replace('H two, competing', 'H two, edited'));
  assert.throws(() => importSession(s.dir, graph), /not closed \(seal-violated: hypotheses.ndjson changed/);
  rmSync(join(s.dir, 'CLOSED.json')); sealSession(s.dir, { closure: 'operator-declared', by: 'operator-01', reason: 'test: re-seal after an edit' });
  assert.throws(() => importSession(s.dir, graph), /conflict: /, "an edited session line (which also changes the session validity) is a conflict");
  assert.equal(readFileSync(graph).length, size);
  rmSync(d, { recursive: true, force: true });
});

test('import never promotes: unverified, invalid-nonce and Kane-without-provenance submissions', async () => {
  const { d, exp } = scratchExp();
  const s = await session(exp, { accessLog: false, extra: async port => { await req(port, '/hypothesis', { method: 'POST', body: new URLSearchParams({ nonce: 'wrong', statement: 'foreign' }).toString() }); } });
  const graph = join(exp, 'judgments.ndjson');
  importSession(s.dir, graph);
  const nodes = verify(graph).nodes;
  assert.equal(nodes.length, 5, 'all 5 submissions kept (4 own + 1 with a foreign nonce)');
  assert.ok(nodes.filter(n => n.author.id !== 'unverified-submitter').every(n => n.body.verification === 'unverified-session-note' && (n.body.sessionValidity as { status: string }).status === 'logging-disabled-condition'));
  const foreign = nodes.find(n => n.author.id === 'unverified-submitter')!;
  assert.equal(foreign.body.counted, false); assert.equal(foreign.kind, 'hypothesis');
  // a session labelled kane without stored Kane output is refused
  const meta = join(s.dir, 'session.json'), m = JSON.parse(readFileSync(meta, 'utf8'));
  writeFileSync(meta, JSON.stringify({ ...m, label: 'kane' }));
  assert.throws(() => planSessionImport(s.dir), /never imported without provenance/);
  writeFileSync(meta, JSON.stringify({ ...m, label: 'someone' }));
  assert.throws(() => planSessionImport(s.dir), ImportError);
  rmSync(d, { recursive: true, force: true });
});

test('AC-P3.4: evaluation before the freeze is refused; the freeze needs every session imported; a hypothesis edited after the freeze violates it', async () => {
  const { d, exp } = scratchExp();
  const ev = { id: 'gw2-test-evaluator', version: '0' };
  assert.throws(() => openEvaluation(exp, ev), /evaluation refused: no hypothesis freeze/);
  const s = await session(exp), graph = join(exp, 'judgments.ndjson');
  assert.throws(() => freezeHypotheses(exp), /not fully imported/, 'the import step cannot be skipped');
  importSession(s.dir, graph);
  const f = freezeHypotheses(exp, { at: '2026-11-25T15:00:00.000Z' });
  assert.equal(f.counts.hypotheses, 2); assert.equal(f.counts.abstentions, 1);
  assert.ok(!/"(score|correct|accuracy)[A-Za-z]*"\s*:/i.test(readFileSync(join(exp, "hypotheses/FREEZE.json"), "utf8")), "nothing scored in P3");
  assert.throws(() => freezeHypotheses(exp), /never overwritten/);
  const g = openEvaluation(exp, ev);
  assert.equal(g.frozen.length, 3); assert.deepEqual(g.notCovered, []);
  assert.match(g.read('heldout', 'observations.json'), /gw2-blind-observations@1/);
  assert.throws(() => g.read('heldout', '../eval/eval.json'), FreezeError);
  // a hypothesis submitted after the freeze is kept but not covered
  const late = { kind: 'hypothesis' as const, parents: [], author: { kind: 'test-double' as const, id: 'late', version: '1' }, origin: 'live' as const, at: '2026-11-25T16:00:00.000Z', evidenceRefs: [], body: { statement: 'late' } };
  const lateId = append(graph, late).id;
  assert.deepEqual(verifyFreeze(exp).notCovered, [lateId]); assert.equal(verifyFreeze(exp).ok, true);
  // a frozen hypothesis edited (and re-hashed) in the graph
  const L = readFileSync(graph, 'utf8').trimEnd().split('\n'), i = L.findIndex(l => JSON.parse(l).node.kind === 'abstention');
  const x = JSON.parse(L[i]); x.node.body.abstainScope = 'edited after the freeze'; x.node.id = nodeId(x.node);
  const saved = readFileSync(graph);
  writeFileSync(graph, [...L.slice(0, i), canonical(x), ...L.slice(i + 1)].join('\n') + '\n');
  assert.equal(verifyFreeze(exp).ok, false);
  assert.throws(() => openEvaluation(exp, ev), /evaluation refused/);
  writeFileSync(graph, saved);
  // the frozen session line edited on disk: the node's reference no longer matches
  const hf = join(s.dir, 'hypotheses.ndjson'), hsaved = readFileSync(hf);
  writeFileSync(hf, hsaved.toString().replace('H one', 'H 1'));
  assert.match(verifyFreeze(exp).problems.join(), /references/);
  writeFileSync(hf, hsaved);
  // tail rewrite of the frozen prefix (last frozen line edited and re-hashed, later lines dropped): caught by the anchor
  const F = readFileSync(graph, 'utf8').trimEnd().split('\n').slice(0, f.graph.anchor.count), y = JSON.parse(F[F.length - 1]);
  y.node.reason = 'rewritten'; y.node.id = nodeId(y.node);
  writeFileSync(graph, [...F.slice(0, -1), canonical({ ...y, prev: sha256(F[F.length - 2]) })].join('\n') + '\n');
  assert.match(verifyFreeze(exp).problems.join(), /external-anchor/);
  writeFileSync(graph, saved);
  assert.equal(verifyFreeze(exp).ok, true);
  // a malformed freeze record
  const fz = join(exp, 'hypotheses/FREEZE.json'), fsaved = readFileSync(fz);
  writeFileSync(fz, fsaved.toString().replace(/"count": \d+/, '"count": "six"'));
  assert.match(verifyFreeze(exp).problems.join(), /anchor/);
  writeFileSync(fz, fsaved);
  const ledger = readFileSync(join(exp, 'evaluation-ledger.ndjson'), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
  assert.deepEqual(ledger.map(l => l.event), ['refused', 'opened', 'refused']);
  rmSync(d, { recursive: true, force: true });
});

test('a freeze after an evaluation was opened is refused', async () => {
  const { d, exp } = scratchExp();
  const s = await session(exp); importSession(s.dir, join(exp, 'judgments.ndjson'));
  freezeHypotheses(exp); openEvaluation(exp, { id: 'e', version: '0' });
  rmSync(join(exp, 'hypotheses/FREEZE.json'));
  assert.throws(() => freezeHypotheses(exp), /evaluation was already opened/);
  rmSync(d, { recursive: true, force: true });
});

test('AC-P3.5: the report states the isolation actually implemented and that blind discovery does not exclude prior knowledge', () => {
  const r = readFileSync(join(ROOT, 'docs/gw2/PHASE_3_REPORT.md'), 'utf8');
  assert.match(r, /logical separation on one machine/i); assert.match(r, /no OS sandbox/i);
  assert.match(r, /does not exclude prior (model )?knowledge of Rule Sabotage/i);
});

test('AC-P3.6: spec-guided mode reproduces the GW1 site byte for byte in a new directory; frozen paths refused', () => {
  const d = scratch(), out = join(d, 'site');
  const r = specGuidedSite(JSON.parse(readFileSync(GW1, 'utf8')), out);
  assert.equal(r.pages, 56);
  const a = readdirSync(out).sort(), b = readdirSync(join(ROOT, 'evidence/gamewatch/site')).sort();
  assert.deepEqual(a, b);
  for (const f of a) assert.ok(readFileSync(join(out, f)).equals(readFileSync(join(ROOT, 'evidence/gamewatch/site', f))), f);
  assert.throws(() => specGuidedSite(JSON.parse(readFileSync(GW1, 'utf8')), join(ROOT, 'evidence/gamewatch/site')), FrozenPathError);
  rmSync(d, { recursive: true, force: true });
});

test('committed P3 fixture: partitions, graph, freeze and leak report all verify', () => {
  assert.deepEqual(verifyPartitions(FIX), []);
  const f = verifyFreeze(FIX);
  assert.equal(f.ok, true, f.problems.join('\n')); assert.equal(f.frozen.length, 3);
  const g = verify(join(FIX, 'judgments.ndjson'), { checkRefs: true });
  assert.equal(g.ok, true); assert.deepEqual(g.nodes.map(n => n.kind), ['finding', 'hypothesis', 'hypothesis', 'abstention', 'evaluation', 'evaluation']);
  const sessions = readdirSync(join(FIX, 'sessions'));
  assert.equal(sessions.length, 1); assert.equal(sessionImportStatus(join(FIX, 'sessions', sessions[0]), join(FIX, 'judgments.ndjson')).complete, true);
  const cli = spawnSync(process.execPath, ['--experimental-strip-types', '--no-warnings', 'gamewatch/gw2/leak-check.ts', relative(ROOT, FIX)], { cwd: ROOT, encoding: 'utf8' });
  assert.equal(cli.status, 0, cli.stdout);
});
