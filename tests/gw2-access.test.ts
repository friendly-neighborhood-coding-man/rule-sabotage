/**
 * GW2 P1: server-side access journal (gamewatch/gw2/serve.ts, gamewatch/gw2/journal.ts). Deterministic HTTP test
 * doubles only; no Kane, no model. Covers AC-P1.1 and the journal semantics listed in docs/gw2/PHASE_1_REPORT.md.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { request } from 'node:http';
import { once } from 'node:events';
import { startGw2Server } from '../gamewatch/gw2/serve.ts';
import { readJournal, isServedEvidence } from '../gamewatch/gw2/journal.ts';
import { loadSession, servedIndex } from '../gamewatch/gw2/session.ts';
import { fixture, req, submit, lines } from './gw2-fixtures.ts';

test('AC-P1.1 + default logging: exactly the requested pages and the finding, in server order, with the session id', async () => {
  const f = fixture();
  const s = await startGw2Server({ exp: 'ac11', out: f.out, site: f.site });
  try {
    assert.ok(s.journal, 'access logging is on by default');
    await req(s.port, '/case-C-aaaaaa.html');
    await req(s.port, '/match-M-cccccc.html');
    await req(s.port, '/report.html');
    await submit(s.port, { category: 'clean / no problem found', claim: 'x', evidence: 'C-aaaaaa', nonce: s.nonce });
  } finally { await s.close(); }
  const meta = JSON.parse(readFileSync(join(s.dir, 'session.json'), 'utf8'));
  assert.equal(meta.logging, 'on'); assert.equal(meta.session, s.session);
  const j = lines(readFileSync(s.journal!, 'utf8'));
  assert.deepEqual(j.map(l => [l.seq, l.type, l.path ?? null]), [[0, 'session-start', null], [1, 'request', 'case-C-aaaaaa.html'], [2, 'request', 'match-M-cccccc.html'], [3, 'request', 'report.html'], [4, 'finding', null], [5, 'session-end', null]]);
  assert.ok(j.every(l => l.session === s.session && l.exp === 'ac11' && l.schema === 'gamewatch/gw2-access@1'));
  assert.deepEqual(j.filter(l => l.type === 'request').map(l => l.evidenceId), ['C-aaaaaa', 'M-cccccc', null]);
  assert.ok(!j.some(l => l.path === 'case-C-bbbbbb.html' || l.path === 'index.html'), 'no line for pages that were not requested');
  const rd = readJournal(s.journal!, { session: s.session });
  assert.equal(rd.status, 'valid'); assert.equal(rd.attribution, 'single-client');
  rmSync(f.root, { recursive: true, force: true });
});

test('request classes: success, HEAD, 404, unrelated, rejected path, wrong method; only a completed GET 200 of an evidence page counts', async () => {
  const f = fixture();
  const s = await startGw2Server({ exp: 'classes', out: f.out, site: f.site });
  try {
    assert.equal((await req(s.port, '/case-C-aaaaaa.html')).status, 200);
    assert.equal((await req(s.port, '/case-C-bbbbbb.html', { method: 'HEAD' })).status, 200);
    assert.equal((await req(s.port, '/case-C-dddddd.html')).status, 404);
    assert.equal((await req(s.port, '/favicon.ico')).status, 404);
    assert.equal((await req(s.port, '/index.html')).status, 200);
    assert.equal((await req(s.port, '/..%5cpackage.json')).status, 404);
    assert.equal((await req(s.port, '/case-C-9fc650.html', { method: 'PUT' })).status, 405);
  } finally { await s.close(); }
  const j = lines(readFileSync(s.journal!, 'utf8')).filter(l => l.type === 'request');
  const row = (p: string | null, m = 'GET') => j.find(l => l.path === p && l.method === m)!;
  assert.deepEqual(j.filter(isServedEvidence).map(l => l.evidenceId), ['C-aaaaaa']);
  assert.equal(row('case-C-aaaaaa.html').bytes, readFileSync(join(f.site, 'case-C-aaaaaa.html')).length);
  assert.equal(row('case-C-bbbbbb.html', 'HEAD').bytes, 0); assert.equal(row('case-C-bbbbbb.html', 'HEAD').sha256, null);
  assert.equal(row('case-C-dddddd.html').status, 404); assert.equal(row('case-C-dddddd.html').kind, 'evidence');
  assert.equal(row('favicon.ico').kind, 'other');
  assert.equal(row('index.html').kind, 'index');
  assert.equal(j.find(l => l.kind === 'rejected')!.path, null, 'a path outside the site is not echoed into the journal');
  assert.equal(row('case-C-9fc650.html', 'PUT').status, 405);
  rmSync(f.root, { recursive: true, force: true });
});

test('aborted response: recorded as aborted with no byte count, and not counted as served', async () => {
  const f = fixture();
  let client: ReturnType<typeof request> | null = null;
  const s = await startGw2Server({ exp: 'abort', out: f.out, site: f.site, beforeRespond: async (p, r) => {
    if (p !== 'case-C-bbbbbb.html') return;
    const closed = once(r.socket, 'close'); client!.destroy(); await closed; // the client is gone before the server answers
  } });
  try {
    await new Promise<void>(res => { client = request({ host: '127.0.0.1', port: s.port, path: '/case-C-bbbbbb.html' }); client.on('error', () => res()); client.end(); });
    await req(s.port, '/case-C-aaaaaa.html');
  } finally { await s.close(); }
  const j = lines(readFileSync(s.journal!, 'utf8')).filter(l => l.type === 'request');
  const ab = j.find(l => l.path === 'case-C-bbbbbb.html')!;
  assert.equal(ab.outcome, 'aborted'); assert.equal(ab.bytes, null); assert.equal(ab.sha256, null);
  assert.ok(!isServedEvidence(ab));
  assert.deepEqual([...servedIndex(readJournal(s.journal!)).served.keys()], ['C-aaaaaa']);
  rmSync(f.root, { recursive: true, force: true });
});

test('duplicate requests are all journalled but counted once for coverage', async () => {
  const f = fixture();
  const s = await startGw2Server({ exp: 'dup', out: f.out, site: f.site });
  try { for (let i = 0; i < 3; i++) await req(s.port, '/case-C-aaaaaa.html'); } finally { await s.close(); }
  const { served } = servedIndex(readJournal(s.journal!));
  assert.equal(lines(readFileSync(s.journal!, 'utf8')).filter(l => l.type === 'request').length, 3);
  assert.equal(served.size, 1); assert.equal(served.get('C-aaaaaa')!.requests, 3); assert.equal(served.get('C-aaaaaa')!.firstSeq, 1);
  rmSync(f.root, { recursive: true, force: true });
});

test('session separation: another session\'s nonce is invalid here, journals never mix, and a foreign line makes a journal invalid', async () => {
  const f = fixture();
  const a = await startGw2Server({ exp: 'sep', out: f.out, site: f.site }), b = await startGw2Server({ exp: 'sep', out: f.out, site: f.site });
  try {
    assert.notEqual(a.session, b.session); assert.notEqual(a.dir, b.dir);
    await req(a.port, '/case-C-aaaaaa.html');
    await req(b.port, '/case-C-bbbbbb.html');
    await submit(b.port, { category: 'x', claim: 'y', evidence: 'C-aaaaaa', nonce: a.nonce });
  } finally { await a.close(); await b.close(); }
  const sb = loadSession(b.dir);
  assert.equal(sb.findings[0].note.nonceValid, false); assert.equal(sb.findings[0].counts, false);
  assert.deepEqual([...servedIndex(sb.journal).served.keys()], ['C-bbbbbb'], 'B never sees A\'s access');
  // concatenating A's journal lines into B's is detected
  const mixed = join(f.root, 'mixed.ndjson');
  const bl = readFileSync(b.journal!, 'utf8').split('\n'), al = readFileSync(a.journal!, 'utf8').split('\n');
  writeFileSync(mixed, [bl[0], al[1], ...bl.slice(1)].join('\n'));
  const r = readJournal(mixed);
  assert.equal(r.status, 'invalid'); assert.match(r.reasons[0], /another session/);
  rmSync(f.root, { recursive: true, force: true });
});

test('the form cannot write the journal: extra form fields are dropped, and no form body, nonce or User-Agent reaches the journal', async () => {
  const f = fixture();
  const s = await startGw2Server({ exp: 'inject', out: f.out, site: f.site });
  const ua = 'SECRET-UA-STRING/9';
  try {
    await req(s.port, '/case-C-aaaaaa.html', { ua });
    await submit(s.port, { category: 'confirmed observable anomaly', claim: 'CLAIM-TEXT-MARKER', evidence: 'C-bbbbbb', nonce: s.nonce, type: 'request', seq: '0', session: 'forged', evidenceId: 'C-bbbbbb', kind: 'evidence', status: '200', outcome: 'completed' }, ua);
  } finally { await s.close(); }
  const note = lines(readFileSync(s.notes, 'utf8'))[0];
  for (const k of ['type', 'seq', 'evidenceId', 'kind', 'status', 'outcome']) assert.ok(!(k in note), `form field ${k} dropped`);
  assert.equal(note.session, s.session, 'the session id in the note is the server\'s, not the form\'s');
  const text = readFileSync(s.journal!, 'utf8');
  for (const secret of [s.nonce, 'CLAIM-TEXT-MARKER', ua, 'forged']) assert.ok(!text.includes(secret), `journal does not contain ${secret}`);
  assert.deepEqual([...servedIndex(readJournal(s.journal!)).served.keys()], ['C-aaaaaa'], 'a forged "access" in a form is not an access');
  const fe = lines(text).find(l => l.type === 'finding')!;
  assert.deepEqual(Object.keys(fe).sort(), ['at', 'exp', 'nonceValid', 'noteIndex', 'noteSha256', 'prev', 'schema', 'seq', 'session', 'type']);
  rmSync(f.root, { recursive: true, force: true });
});

test('explicit disablement: no journal file, session.json says off, the journal reads as unavailable (not "no access")', async () => {
  const f = fixture();
  const s = await startGw2Server({ exp: 'off', out: f.out, site: f.site, accessLog: false, loggingDisabledReason: 'test: authorized logging-off condition' });
  try { await req(s.port, '/case-C-aaaaaa.html'); await submit(s.port, { category: 'x', claim: 'y', evidence: 'C-aaaaaa', nonce: s.nonce }); } finally { await s.close(); }
  assert.equal(s.journal, null);
  assert.deepEqual(readdirSync(s.dir).sort(), ['CLOSED.json', 'notes.ndjson', 'session.json'], 'no journal file; the session is closed explicitly (P3 correction D54)');
  const ss = loadSession(s.dir);
  assert.equal(ss.journal.status, 'unavailable'); assert.match(ss.journal.reasons[0], /disabled/);
  assert.equal(ss.findings[0].join, 'journal-unavailable'); assert.equal(ss.findings[0].counts, true, 'the finding itself still counts');
  rmSync(f.root, { recursive: true, force: true });
});

test('write failures are surfaced: a journal-gap line records lost events (incomplete), and a lost session-end leaves it incomplete', async () => {
  const f = fixture();
  let n = 0;
  const failing = (fail: (k: number) => boolean) => (file: string, d: string) => { if (fail(n++)) { const e = new Error('disk full') as NodeJS.ErrnoException; e.code = 'ENOSPC'; throw e; } writeFileSync(file, d, { flag: 'a' }); };
  const s = await startGw2Server({ exp: 'fail', out: f.out, site: f.site, journalAppend: failing(k => k === 2) });
  try { await req(s.port, '/case-C-aaaaaa.html'); await req(s.port, '/case-C-bbbbbb.html'); await req(s.port, '/case-C-9fc650.html'); } finally { await s.close(); }
  assert.equal(s.failures(), 1);
  const j = lines(readFileSync(s.journal!, 'utf8'));
  assert.ok(j.some(l => l.type === 'journal-gap' && l.lost === 1 && l.error === 'ENOSPC'));
  const r = readJournal(s.journal!);
  assert.equal(r.status, 'incomplete'); assert.match(r.reasons.join(' '), /could not be written/);
  n = 0;
  const t = await startGw2Server({ exp: 'fail2', out: f.out, site: f.site, journalAppend: failing(k => k >= 2) });
  try { await req(t.port, '/case-C-aaaaaa.html'); await req(t.port, '/case-C-bbbbbb.html'); } finally { await t.close(); }
  const r2 = readJournal(t.journal!);
  assert.equal(r2.status, 'incomplete'); assert.match(r2.reasons.join(' '), /no session-end/);
  rmSync(f.root, { recursive: true, force: true });
});

test('invalid journals: an edited, deleted or reordered line, a bad schema or a partial last line is detected; nothing in it is used', async () => {
  const f = fixture();
  const s = await startGw2Server({ exp: 'tamper', out: f.out, site: f.site });
  try { await req(s.port, '/case-C-aaaaaa.html'); await req(s.port, '/case-C-bbbbbb.html'); } finally { await s.close(); }
  const orig = readFileSync(s.journal!, 'utf8').split('\n'), t = join(f.root, 't.ndjson');
  const check = (ls: string[], re: RegExp, status = 'invalid') => { writeFileSync(t, ls.join('\n')); const r = readJournal(t); assert.equal(r.status, status, ls.join('|').slice(0, 80)); assert.match(r.reasons.join(' '), re); if (status === 'invalid') assert.equal(servedIndex(r).served.size, 0); };
  check([orig[0], orig[1].replace('C-aaaaaa', 'C-9fc650'), ...orig.slice(2)], /hash chain|seq/);
  check([orig[0], ...orig.slice(2)], /seq/);
  check([orig[0], orig[2], orig[1], ...orig.slice(3)], /seq/);
  check([orig[0].replace('gw2-access@1', 'gw2-access@0'), ...orig.slice(1)], /schema/);
  check([...orig.slice(0, -2), orig[orig.length - 2].slice(0, 20)], /not JSON|partial/);
  check(orig.slice(0, 3).concat(''), /no session-end/, 'incomplete');
  rmSync(f.root, { recursive: true, force: true });
});
