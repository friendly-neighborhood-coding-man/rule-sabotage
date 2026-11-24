/**
 * Review-server checks with a local TEST DOUBLE reviewer (no Kane): OS-independent report-page matching, the session
 * nonce on the report page, a stored finding with nonceValid true, and that finding reaching the coverage audit.
 *   node --experimental-strip-types --no-warnings --test gamewatch/kane/serve.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, posix, win32 } from 'node:path';
import { spawnSync } from 'node:child_process';
import { ROOT } from '../builds.ts';
import { startServer, resolvePage } from './serve.ts';

const SITE = join(ROOT, 'evidence/gamewatch/site');

test('report page is recognised with POSIX and Windows path rules alike', () => {
  for (const [impl, site] of [[posix, '/srv/site'], [win32, 'D:\\Rule_Sabotage\\rule-sabotage-live\\evidence\\gamewatch\\site']] as const) {
    const r = resolvePage('/report.html', site, impl);
    assert.ok(r && r.isReport, `${impl === posix ? 'posix' : 'win32'}: report.html recognised`);
    assert.equal(r!.file, impl.join(site, 'report.html'));
    assert.equal(resolvePage('/', site, impl)?.page, 'index.html');
    assert.equal(resolvePage('/case-C-27d15a.html', site, impl)?.isReport, false);
    for (const bad of ['/../package.json', '/%2e%2e/package.json', '/..%5cpackage.json', '/a/../../x', '/%00']) { const x = resolvePage(bad, site, impl); assert.ok(x === null || x.file.startsWith(site + impl.sep), `${bad} stays inside the site`); }
  }
});

test('test double: nonce on the page, finding stored with nonceValid, finding reaches the coverage audit', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'gw-serve-')), notes = join(dir, 'notes.ndjson');
  const s = await startServer({ port: 0, site: SITE, notes, label: 'test-double' });
  try {
    const page = await (await fetch(`http://127.0.0.1:${s.port}/report.html`)).text();
    assert.ok(page.includes(`name="nonce" value="${s.nonce}"`), 'report page carries the session nonce');
    assert.ok(!page.includes('__NONCE__'));
    const body = new URLSearchParams({ category: 'clean / no problem found', rules: 'R8', builds: 'QX-41', claim: 'TEST DOUBLE plumbing check, not a review', evidence: 'C-874a92 step 1', confidence: 'low', nonce: s.nonce });
    const r = await fetch(`http://127.0.0.1:${s.port}/report`, { method: 'POST', body, headers: { 'content-type': 'application/x-www-form-urlencoded' } });
    assert.match(await r.text(), /valid session/);
    const stored = readFileSync(notes, 'utf8').trim().split('\n').map(l => JSON.parse(l));
    assert.equal(stored.length, 1);
    assert.equal(stored[0].nonceValid, true);
    assert.equal(stored[0].source, 'test-double');
    const out = join(dir, 'audit.json');
    const a = spawnSync(process.execPath, ['--experimental-strip-types', '--no-warnings', join(ROOT, 'gamewatch/skillbook/steps/audit.ts'), join(ROOT, 'evidence/gamewatch/evidence.json'), notes, 'test-double', out], { encoding: 'utf8' });
    assert.equal(a.status, 0, a.stderr);
    const audit = JSON.parse(readFileSync(out, 'utf8'));
    assert.equal(audit.findings, 1);
    assert.deepEqual(audit.rulesCited, ['R8']);
    assert.deepEqual(audit.casesCited, ['C-874a92']);
    // a wrong nonce is stored but marked invalid, and the audit ignores it
    await fetch(`http://127.0.0.1:${s.port}/report`, { method: 'POST', body: new URLSearchParams({ category: 'x', claim: 'y', evidence: 'z', nonce: 'wrong' }) });
    assert.equal(JSON.parse(readFileSync(notes, 'utf8').trim().split('\n')[1]).nonceValid, false);
  } finally { await s.close(); rmSync(dir, { recursive: true, force: true }); }
});
