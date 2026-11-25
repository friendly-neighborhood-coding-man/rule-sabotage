/**
 * GW2 P3 corrections (operator review 2026-11-25 14:22 UTC): explicit session closure and seals, freeze-bound
 * evaluation readers, a verified evaluation ledger, and fail-closed freeze/ledger records. Test doubles only.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, cpSync, readFileSync, writeFileSync, rmSync, appendFileSync, mkdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ROOT } from '../gamewatch/gw2/paths.ts';
import { startGw2Server } from '../gamewatch/gw2/serve.ts';
import { importSession, ImportError } from '../gamewatch/gw2/import-session.ts';
import { freezeHypotheses, verifyFreeze, openEvaluation, verifyLedger, writeSessionPlan, FreezeError, FREEZE_SCHEMA } from '../gamewatch/gw2/freeze.ts';
import { sealSession, sessionClosure, SessionCloseError } from '../gamewatch/gw2/session-close.ts';
import { loadSession, experimentalValidity } from '../gamewatch/gw2/session.ts';
import { fileSha256, canonical } from '../gamewatch/gw2/judgments.ts';
import { req } from './gw2-fixtures.ts';

const FIX = join(ROOT, 'evidence/gw2/p3-fixture');
const EV = { id: 'gw2-test-evaluator', version: '0' };
function scratchExp(sessions: number | null = 1) {
  const d = mkdtempSync(join(tmpdir(), 'gw2-p3c-')), exp = join(d, 'exp');
  cpSync(join(FIX, 'partitions'), join(exp, 'partitions'), { recursive: true });
  if (sessions !== null) writeSessionPlan(exp, sessions, 'test');
  return { d, exp };
}
async function session(exp: string, o: { accessLog?: boolean; close?: boolean } = {}) {
  const s = await startGw2Server({ exp: 'p3c-test', out: exp, site: join(exp, 'partitions/discovery/site'), label: 'test-double', ...(o.accessLog === false ? { accessLog: false, loggingDisabledReason: 'test: authorized logging-off condition' } : {}) });
  await req(s.port, '/hypothesis', { method: 'POST', body: new URLSearchParams({ nonce: s.nonce, statement: 'H one' }).toString() });
  if (o.close !== false) await s.close();
  return s;
}
async function frozenExp() {
  const { d, exp } = scratchExp(), s = await session(exp), graph = join(exp, 'judgments.ndjson');
  importSession(s.dir, graph); freezeHypotheses(exp, { at: '2026-11-25T15:00:00.000Z' });
  return { d, exp, s, graph };
}
const ledgerF = (exp: string) => join(exp, 'evaluation-ledger.ndjson');

test('closure: closing the server seals logging-on AND logging-off sessions explicitly', async () => {
  const { d, exp } = scratchExp(2);
  const on = await session(exp), off = await session(exp, { accessLog: false });
  for (const s of [on, off]) {
    const c = sessionClosure(s.dir);
    assert.equal(c.status, 'closed', c.problems.join()); assert.equal(c.closure, 'server-close');
    const rec = JSON.parse(readFileSync(join(s.dir, 'CLOSED.json'), 'utf8'));
    assert.ok(rec.outputs['hypotheses.ndjson'].sha256 && rec.outputs['session.json'].sha256);
  }
  assert.equal(JSON.parse(readFileSync(join(off.dir, 'CLOSED.json'), 'utf8')).outputs['access.ndjson'], null);
  assert.throws(() => sealSession(on.dir, { closure: 'server-close', by: 'x' }), /already closed/, 'never overwritten');
  rmSync(d, { recursive: true, force: true });
});

test('closure: an unclosed session (logging off or on) is not imported and blocks the freeze; an operator declaration closes it without changing its validity', async () => {
  const { d, exp } = scratchExp(1), graph = join(exp, 'judgments.ndjson');
  const s = await session(exp, { accessLog: false });
  rmSync(join(s.dir, 'CLOSED.json')); // as if the process had been killed before closing
  assert.equal(sessionClosure(s.dir).status, 'not-closed');
  assert.throws(() => importSession(s.dir, graph), /is not closed \(not-closed/, 'logging off no longer counts as "ended"');
  assert.throws(() => freezeHypotheses(exp), /is not closed/);
  assert.throws(() => sealSession(s.dir, { closure: 'operator-declared', by: 'Eric', reason: 'x' }), SessionCloseError, 'role id required');
  assert.throws(() => sealSession(s.dir, { closure: 'operator-declared', by: 'operator-01' }), /stated reason/);
  sealSession(s.dir, { closure: 'operator-declared', by: 'operator-01', reason: 'test: process killed before close' });
  assert.equal(sessionClosure(s.dir).closure, 'operator-declared');
  importSession(s.dir, graph);
  assert.equal(experimentalValidity(loadSession(s.dir)).status, 'logging-disabled-condition');
  // logging on, crashed: no session-end in the journal. A forged server-close is invalid; a declaration keeps it unsuitable.
  const { d: d2, exp: exp2 } = scratchExp(1);
  const t = await session(exp2);
  rmSync(join(t.dir, 'CLOSED.json'));
  const jf = join(t.dir, 'access.ndjson'), J = readFileSync(jf, 'utf8').trimEnd().split('\n');
  writeFileSync(jf, J.slice(0, -1).join('\n') + '\n');
  sealSession(t.dir, { closure: 'server-close', by: 'forged' });
  assert.equal(sessionClosure(t.dir).status, 'invalid');
  assert.match(sessionClosure(t.dir).problems.join(), /needs a journal with session-end/);
  rmSync(join(t.dir, 'CLOSED.json'));
  sealSession(t.dir, { closure: 'operator-declared', by: 'operator-01', reason: 'test: crash' });
  assert.equal(sessionClosure(t.dir).status, 'closed');
  assert.equal(experimentalValidity(loadSession(t.dir)).status, 'unsuitable-for-primary-analysis');
  rmSync(d, { recursive: true, force: true }); rmSync(d2, { recursive: true, force: true });
});

test('closure: a sealed output changed, added or removed after closing is a seal violation; malformed CLOSED.json is invalid', async () => {
  const { d, exp } = scratchExp(1), s = await session(exp, { accessLog: false });
  const nf = join(s.dir, 'notes.ndjson');
  writeFileSync(nf, '{"late":true}\n');
  assert.equal(sessionClosure(s.dir).status, 'seal-violated'); assert.match(sessionClosure(s.dir).problems.join(), /notes.ndjson was added/);
  rmSync(nf);
  assert.equal(sessionClosure(s.dir).status, 'closed');
  appendFileSync(join(s.dir, 'hypotheses.ndjson'), '{"x":1}\n');
  assert.match(sessionClosure(s.dir).problems.join(), /hypotheses.ndjson changed/);
  writeFileSync(join(s.dir, 'CLOSED.json'), '{"schema":');
  assert.equal(sessionClosure(s.dir).status, 'invalid');
  rmSync(d, { recursive: true, force: true });
});

test('Q19: the freeze needs a session plan and exactly the declared number of closed, imported sessions; it records each seal', async () => {
  const { d, exp } = scratchExp(null), graph = join(exp, 'judgments.ndjson');
  const s = await session(exp); importSession(s.dir, graph);
  assert.throws(() => freezeHypotheses(exp), /no session plan/);
  writeSessionPlan(exp, 2, 'two declared');
  assert.throws(() => freezeHypotheses(exp), /declares 2 session\(s\); 1 found/);
  rmSync(join(exp, 'SESSIONS.json')); writeSessionPlan(exp, 1, 'one declared');
  const f = freezeHypotheses(exp);
  assert.equal(f.schema, FREEZE_SCHEMA);
  assert.deepEqual(f.sessions, [{ session: s.session, closure: 'server-close', sealSha256: fileSha256(join(s.dir, 'CLOSED.json')) }]);
  for (const p of ['discovery', 'spec', 'heldout', 'eval']) assert.equal(f.manifests[p], fileSha256(join(exp, 'partitions', p, 'MANIFEST.json')));
  // a changed seal or session plan violates the freeze
  const cf = join(s.dir, 'CLOSED.json'), saved = readFileSync(cf);
  writeFileSync(cf, saved.toString().replace('"closedBy"', '"reason": "edited", "closedBy"'));
  assert.match(verifyFreeze(exp).problems.join(), /seal differs from the freeze record/);
  writeFileSync(cf, saved);
  appendFileSync(join(exp, 'SESSIONS.json'), ' ');
  assert.match(verifyFreeze(exp).problems.join(), /SESSIONS.json differs/);
  rmSync(d, { recursive: true, force: true });
});

test('gate: evaluation readers are bound to the manifests accepted at freeze time; a consistent replacement manifest is refused', async () => {
  const { d, exp } = await frozenExp();
  const g = openEvaluation(exp, EV);
  const ho = join(exp, 'partitions/heldout/observations.json'), mf = join(exp, 'partitions/heldout/MANIFEST.json');
  assert.match(g.read('heldout', 'observations.json'), /gw2-blind-observations@1/);
  // replace the held-out file AND its manifest consistently (verifyManifest would pass): the bound reader refuses
  const savedO = readFileSync(ho), savedM = readFileSync(mf), m = JSON.parse(savedM.toString());
  writeFileSync(ho, savedO.toString().replace('"partition": "heldout"', '"partition": "heldout", "replaced": true'));
  m.files['observations.json'] = fileSha256(ho);
  writeFileSync(mf, JSON.stringify(m, null, 1) + '\n');
  assert.throws(() => g.read('heldout', 'observations.json'), /not the manifest accepted at freeze time/);
  // replacing PARTITION.json too does not help: the freeze records its hash and every manifest hash
  assert.equal(verifyFreeze(exp).ok, false);
  assert.throws(() => openEvaluation(exp, EV), /evaluation refused/);
  writeFileSync(mf, savedM);
  assert.throws(() => g.read('heldout', 'observations.json'), /content differs from the frozen manifest/, 'file changed under the accepted manifest');
  writeFileSync(ho, savedO);
  assert.match(g.read('heldout', 'observations.json'), /gw2-blind-observations@1/);
  assert.throws(() => g.read('heldout', 'MANIFEST.json'), /not in the partition manifest/);
  assert.throws(() => g.read('heldout', 'constructor'), /not in the partition manifest/);
  rmSync(d, { recursive: true, force: true });
});

test('gate: the ledger is verified before it is extended or relied on; an invalid ledger is never appended to', async () => {
  const { d, exp } = await frozenExp();
  openEvaluation(exp, EV); openEvaluation(exp, EV);
  const lf = ledgerF(exp), good = readFileSync(lf, 'utf8'), L = good.trimEnd().split('\n');
  assert.equal(verifyLedger(lf).ok, true); assert.deepEqual(verifyLedger(lf).entries.map(e => e.event), ['opened', 'opened']);
  const extra = (seq: number, prev: string | null, event = 'opened') => canonical({ schema: 'gamewatch/gw2-evaluation-ledger@1', seq, prev, at: '2026-11-25T00:00:00Z', event }) + '\n';
  const cases: [string, string, RegExp][] = [
    ['earlier entry edited', [L[0].replace('gw2-test-evaluator', 'someone-else'), L[1]].join('\n') + '\n', /line 2: prev does not match/],
    ['earlier entry deleted', L[1] + '\n', /seq 2, expected 1/],
    ['malformed line', good + '{"seq": 3,\n', /line 3: not JSON/],
    ['truncated last line', good.slice(0, -5), /not terminated/],
    ['wrong seq', good + extra(5, null), /seq 5, expected 3/],
    ['broken chain', good + extra(3, '0'.repeat(64)), /prev does not match/],
    ['unknown event', good + extra(3, verifyLedger(lf).lastLineSha256, 'scored'), /unknown event/],
    ['not canonical', good.replace(/^\{/, '{ '), /not in canonical form/],
  ];
  for (const [what, text, re] of cases) {
    writeFileSync(lf, text);
    const v = verifyLedger(lf);
    assert.equal(v.ok, false, what); assert.match(v.problems.join(), re, what);
    assert.throws(() => openEvaluation(exp, EV), /the evaluation ledger is invalid/, what);
    assert.equal(readFileSync(lf, 'utf8'), text, `${what}: nothing appended`);
  }
  // an edit of the LAST entry keeps a valid chain: detecting it needs the external record (Q14), as for the graph tail
  writeFileSync(lf, [L[0], L[1].replace('gw2-test-evaluator', 'someone-else')].join('\n') + '\n');
  assert.equal(verifyLedger(lf).ok, true);
  writeFileSync(lf, good.slice(0, -5));
  // a freeze is refused while the ledger is invalid
  rmSync(join(exp, 'hypotheses/FREEZE.json'));
  assert.throws(() => freezeHypotheses(exp), /ledger is invalid/);
  rmSync(d, { recursive: true, force: true });
});

test('gate: malformed freeze records fail closed; a freeze@1 (before explicit closure) cannot open evaluation; an open session blocks evaluation', async () => {
  const { d, exp } = await frozenExp();
  const fz = join(exp, 'hypotheses/FREEZE.json'), saved = readFileSync(fz, 'utf8'), f = JSON.parse(saved);
  const mutate: [string, (x: any) => void][] = [
    ['hypotheses not a list', x => { x.hypotheses = 'all'; }],
    ['hypothesis id not a hash', x => { x.hypotheses[0].id = 'H-1'; }],
    ['unknown hypothesis kind', x => { x.hypotheses[0].kind = 'finding'; }],
    ['manifests missing', x => { delete x.manifests; }],
    ['manifest hash malformed', x => { x.manifests.heldout = 'abc'; }],
    ['sessions missing', x => { delete x.sessions; }],
    ['unknown schema', x => { x.schema = 'gamewatch/gw2-freeze@9'; }],
    ['frozenAt not a time', x => { x.frozenAt = 'yesterday'; }],
    ['anchor not a number', x => { x.graph.anchor.count = 'six'; }],
    ['not an object', x => { for (const k of Object.keys(x)) delete x[k]; }],
  ];
  for (const [what, m] of mutate) {
    const x = structuredClone(f); m(x); writeFileSync(fz, JSON.stringify(x));
    const r = verifyFreeze(exp);
    assert.equal(r.ok, false, what); assert.ok(r.problems.length, what);
    assert.throws(() => openEvaluation(exp, EV), /evaluation refused/, what);
  }
  writeFileSync(fz, '[]'); assert.equal(verifyFreeze(exp).ok, false);
  writeFileSync(fz, 'not json'); assert.deepEqual(verifyFreeze(exp).problems, ['FREEZE.json is not valid JSON']);
  writeFileSync(fz, saved);
  assert.equal(verifyFreeze(exp).ok, true);
  // an ongoing session (no CLOSED.json) blocks evaluation
  const open = await startGw2Server({ exp: 'p3c-test', out: exp, site: join(exp, 'partitions/discovery/site'), label: 'test-double' });
  try { assert.throws(() => openEvaluation(exp, EV), /evaluation does not start while a session is open/); }
  finally { await open.close(); }
  openEvaluation(exp, EV);
  // the committed P3 fixture's freeze@1 predates explicit closure: evaluation of a copy is refused
  const d2 = mkdtempSync(join(tmpdir(), 'gw2-p3c-')), c = join(d2, 'p3');
  cpSync(FIX, c, { recursive: true });
  const r1 = verifyFreeze(c);
  assert.equal(r1.schema, 'gamewatch/gw2-freeze@1');
  assert.throws(() => openEvaluation(c, EV), /predates explicit session closure/);
  assert.ok(existsSync(join(c, 'evaluation-ledger.ndjson')) && verifyLedger(join(c, 'evaluation-ledger.ndjson')).entries[0].event === 'refused');
  rmSync(d, { recursive: true, force: true }); rmSync(d2, { recursive: true, force: true });
});
