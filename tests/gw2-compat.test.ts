/**
 * GW2 P1: GW1 compatibility, frozen-path protection and the historical GW1 replay (AC-P1.2, AC-P1.5, AC-P1.7).
 * The 56 GW1 evidence pages are served from a SCRATCH COPY of evidence/gamewatch/site; no historical generator is run
 * and nothing is written under a frozen path. No Kane, no model.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, cpSync, readdirSync, readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { startServer } from '../gamewatch/kane/serve.ts';
import { startGw2Server } from '../gamewatch/gw2/serve.ts';
import { assertWritableOutput, FrozenPathError, ROOT } from '../gamewatch/gw2/paths.ts';
import { gw1Coverage, NO_GW1_JOURNAL } from '../gamewatch/gw2/coverage.ts';
import { loadInventory } from '../gamewatch/gw2/inventory.ts';
import { req } from './gw2-fixtures.ts';

const node = (args: string[]) => spawnSync(process.execPath, args, { cwd: ROOT, encoding: 'utf8' });

test('AC-P1.2: all 56 GW1 pages are byte-identical from the GW1 server, the GW2 server with logging on, and with it off (report.html: nonce only)', async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'gw2-compat-')), site = join(tmp, 'site');
  cpSync(join(ROOT, 'evidence/gamewatch/site'), site, { recursive: true });
  const pages = readdirSync(site).filter(f => f.endsWith('.html')).sort();
  assert.equal(pages.length, 56);
  const legacy = await startServer({ port: 0, site, notes: join(tmp, 'legacy-notes.ndjson'), label: 'test-double' });
  const on = await startGw2Server({ exp: 'compat-on', out: join(tmp, 'on'), site }), off = await startGw2Server({ exp: 'compat-off', out: join(tmp, 'off'), site, accessLog: false });
  try {
    for (const p of pages) {
      const [a, b, c] = await Promise.all([legacy.port, on.port, off.port].map(port => req(port, '/' + p)));
      assert.equal(a.status, 200);
      // The only expected difference: report.html carries each server's own per-session nonce.
      const norm = (x: Buffer, nonce: string) => p === 'report.html' ? Buffer.from(x.toString('utf8').replace(`value="${nonce}"`, 'value="__NONCE__"')) : x;
      const la = norm(a.body, legacy.nonce);
      assert.ok(la.equals(norm(b.body, on.nonce)), `${p}: GW2 (log on) differs from GW1`);
      assert.ok(la.equals(norm(c.body, off.nonce)), `${p}: GW2 (log off) differs from GW1`);
      if (p !== 'report.html') assert.ok(la.equals(readFileSync(join(site, p))), `${p}: served bytes = file bytes`);
    }
  } finally { await legacy.close(); await on.close(); await off.close(); }
  assert.equal(readFileSync(on.journal!, 'utf8').split('\n').filter(Boolean).length, 56 + 2, '56 requests + start + end');
  assert.ok(!existsSync(join(tmp, 'legacy-notes.ndjson')), 'the GW1 server wrote nothing for GET requests (no access log beside GW1 notes)');
  assert.deepEqual(readdirSync(tmp).sort(), ['off', 'on', 'site']);
  rmSync(tmp, { recursive: true, force: true });
});

test('frozen-path protection: GW2 outputs are refused under frozen GW1 paths and anywhere in the repo outside evidence/gw2/', async () => {
  for (const p of ['evidence/gamewatch/review', 'evidence/gamewatch/review/notes.ndjson', 'evidence/gamewatch', 'gamewatch/private/x.json', 'gamewatch/vendor/skillflow', 'server/v6/out', 'evidence/corrections/x', 'docs/GW1_FINAL_REPORT.md'])
    assert.throws(() => assertWritableOutput(join(ROOT, p)), FrozenPathError, p);
  for (const p of ['', 'docs/gw2/out', 'evidence/gw2-other/x', 'gamewatch/gw2/out', 'tests/out'])
    assert.throws(() => assertWritableOutput(join(ROOT, p)), /must be under evidence\/gw2/, p || '(repo root)');
  assert.equal(assertWritableOutput(join(ROOT, 'evidence/gw2/exp-1')), join(ROOT, 'evidence/gw2/exp-1'));
  assert.ok(assertWritableOutput(join(tmpdir(), 'anything')), 'an explicit temporary workspace outside the repository is allowed');
  const tmp = mkdtempSync(join(tmpdir(), 'gw2-frozen-'));
  await assert.rejects(startGw2Server({ exp: 'x', out: join(ROOT, 'evidence/gamewatch/review'), site: join(ROOT, 'evidence/gamewatch/site') }), FrozenPathError);
  for (const args of [['session', 'b', 's', join(ROOT, 'evidence/gamewatch/qa')], ['gw1', 'b', 'i', 's', 'n', join(ROOT, 'evidence/gamewatch/review')]]) {
    const r = node(['--experimental-strip-types', '--no-warnings', 'gamewatch/gw2/coverage.ts', ...args]);
    assert.notEqual(r.status, 0); assert.match(r.stderr, /frozen GW1 path/);
  }
  const r = node(['--experimental-strip-types', '--no-warnings', 'gamewatch/gw2/policy.ts', 'p', 'b', 's', join(ROOT, 'gamewatch/private/out.json')]);
  assert.notEqual(r.status, 0); assert.match(r.stderr, /frozen GW1 path/);
  rmSync(tmp, { recursive: true, force: true });
});

test('filesystem inventory sees git-ignored additions under frozen paths, which the git-based baseline check cannot', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'gw2-inv-'));
  mkdirSync(join(tmp, 'docs/gw2'), { recursive: true }); mkdirSync(join(tmp, 'evidence/gamewatch/raw'), { recursive: true }); mkdirSync(join(tmp, 'evidence/gw2'), { recursive: true });
  writeFileSync(join(tmp, 'docs/gw2/BASELINE_MANIFEST.json'), JSON.stringify({ protectedFiles: { frozenScope: ['/^evidence\\/gamewatch\\//'], files: { 'evidence/gamewatch/a.json': { tier: 'frozen' } } } }));
  writeFileSync(join(tmp, 'evidence/gamewatch/a.json'), '{}');
  writeFileSync(join(tmp, 'evidence/gw2/ok.json'), '{}');
  writeFileSync(join(tmp, '.gitignore'), 'evidence/gamewatch/raw/\n');
  spawnSync('git', ['init', '-q', tmp]);
  const run = () => node([join(ROOT, 'scripts/gw2-frozen-inventory.mjs'), '--root', tmp]);
  assert.equal(run().status, 0, run().stdout);
  writeFileSync(join(tmp, 'evidence/gamewatch/raw/x.json'), '{}');
  const r = run();
  assert.equal(r.status, 1); assert.match(r.stdout, /added \(git-ignored\): evidence\/gamewatch\/raw\/x\.json/);
  assert.ok(!r.stdout.includes('evidence/gw2/ok.json'));
  rmSync(tmp, { recursive: true, force: true });
});

test('AC-P1.5: historical GW1 replay reproduces 2/22 → 3/22 cases, 0/32 matches, C-9fc650 cited before its first recorded visit; no server journal invented', () => {
  const r = gw1Coverage(loadInventory(join(ROOT, 'evidence/gamewatch/evidence.json')), join(ROOT, 'evidence/gamewatch/site/index.html'),
    join(ROOT, 'evidence/gamewatch/review/run/GW1-blind-review/stdout.ndjson'), join(ROOT, 'evidence/gamewatch/review/notes.ndjson'));
  type S = { reconstructedVisits: { cases: number; matches: number }; of: { cases: number; matches: number }; citedWithoutAccess: string[]; cited: string[] };
  const s = r.columns.map(c => c.summary as S);
  assert.deepEqual(r.columns.map(c => c.label), ['Finding 1', 'Finding 2', 'Finding 3', 'Run end']);
  assert.equal(r.columns[0].category, 'clean / no problem found');
  assert.deepEqual([s[0].reconstructedVisits.cases, s[0].of.cases], [2, 22]);
  assert.deepEqual([s[3].reconstructedVisits.cases, s[3].of.cases], [3, 22]);
  assert.ok(s.every(x => x.reconstructedVisits.matches === 0 && x.of.matches === 32));
  assert.deepEqual(s[0].cited, ['C-9fc650']); assert.deepEqual(s[0].citedWithoutAccess, ['C-9fc650']);
  assert.ok(Date.parse(r.columns[0].at!) < Date.parse(r.firstRecordedVisits['C-9fc650'].at), 'cited before its first recorded visit');
  assert.ok(r.columns.every(c => c.items.every(i => i.serverAccess === 'unavailable')), 'never a fabricated server record');
  assert.match(r.accessEvidence.statement, /No server-side access journal exists for GW1/); assert.equal(r.accessEvidence.statement, NO_GW1_JOURNAL);
  const notes = readFileSync(join(ROOT, 'evidence/gamewatch/review/notes.ndjson'), 'utf8').split('\n').filter(Boolean);
  assert.deepEqual(r.columns.slice(0, 3).map(c => c.verbatim), notes, 'findings quoted verbatim');
  // the committed demonstration output matches a fresh replay
  assert.deepEqual(JSON.parse(readFileSync(join(ROOT, 'evidence/gw2/gw1-replay/coverage.json'), 'utf8')), JSON.parse(JSON.stringify(r)));
});

test('AC-P1.7 (part): frozen GW1 files unchanged, no unexpected file under frozen paths, GW1 audit and follow-up untouched', () => {
  const v = node(['scripts/gw2-baseline.mjs', 'verify']);
  assert.equal(v.status, 0, v.stdout);
  assert.match(v.stdout, /135 frozen files match d22d33eeed06/);
  for (const f of ['gamewatch/kane/serve.ts', 'gamewatch/skillbook/steps/audit.ts', 'gamewatch/dashboard.ts', 'gamewatch/kane/plan.ts']) assert.ok(!v.stdout.includes(`changed ${f}`), `${f} unchanged`);
  const inv = node(['scripts/gw2-frozen-inventory.mjs']);
  assert.equal(inv.status, 0, inv.stdout);
  const g = spawnSync('git', ['-C', ROOT, 'hash-object', 'gamewatch/skillbook/steps/visit-coverage.mjs'], { encoding: 'utf8' });
  assert.equal(g.stdout.trim(), 'f7ccc0a5a8a261f623f5d4922e62f01c0800bbf4', 'imported follow-up file identical to 46ee7e6');
});
