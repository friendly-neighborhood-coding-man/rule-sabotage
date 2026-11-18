/**
 * End-to-end check of one full loop cycle in --run-kane mode, but with the Kane TEST DOUBLE as the CLI.
 * Proves the plumbing (self-play → anomalies → evidence page served → CLI invoked → findings → candidates →
 * held-out comparison → decision → journal → manifest) and that a test double can never cause a promotion.
 *   npm run test:balance-e2e
 */
import assert from 'node:assert/strict';
import { mkdtempSync, copyFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const tmp = mkdtempSync(join(tmpdir(), 'rs-loop-e2e-'));
const chrome = ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', '/opt/pw-browsers/chromium', '/usr/bin/chromium'].find(p => existsSync(p));
if (!chrome) { console.log('SKIP: no Chrome for the evidence page'); process.exit(0); }
Object.assign(process.env, { KANE_REFEREE: 'on', KANE_CLI: join(root, 'tests/fixtures/fake-kane.mjs'), KANE_CHROME: chrome, FAKE_KANE_MODE: 'approve' });
const weights = join(tmp, 'balance.weights.json');
copyFileSync(join(root, 'balance/balance.weights.json'), weights);
const before = readFileSync(weights, 'utf8');
const { runLoop } = await import('../server/balance/loop.ts');
const { verifyJournal } = await import('../server/balance/journal.ts');
const st = await runLoop({ runKane: true, cycles: 1, port: 0, quick: true, runUnitTests: false, weightsFile: weights, journalFile: join(tmp, 'journal.ndjson'), evidenceRoot: join(tmp, 'runs'), investigationsFile: join(tmp, 'inv.json'), log: () => {} });
const cy = st.cycles[0];
const results: string[] = [];
const ok = (name: string, cond: boolean, detail = '') => { assert.ok(cond, `${name} ${detail}`); results.push(`PASS ${name}`); console.log(`PASS ${name}`); };
ok('baseline self-play ran with both sides starting', !!cy.baseline && cy.baseline.games === 8 && cy.baseline.pairs === 4);
ok('anomalies detected', cy.anomalies.length > 0, JSON.stringify(cy.anomalies.map(a => a.type)));
ok('the CLI was invoked on served evidence pages', cy.kane.some(k => k.state === 'done' && k.result?.status === 'complete'), JSON.stringify(cy.kane.map(k => [k.state, k.result?.status])));
ok('the test double is labelled and every finding stays UNVERIFIED', cy.findings.every(f => f.status === 'UNVERIFIED') && cy.kane.filter(k => k.result).every(k => k.result!.isTestDouble && k.finding!.verifier === 'kane-test-double'));
ok('no candidate is eligible, so nothing was promoted', cy.candidates.every(c => !c.eligible) && cy.decision?.action === 'rollback' && readFileSync(weights, 'utf8') === before);
ok('held-out comparison ran when candidates existed', cy.candidates.length === 0 || (!!cy.heldOutBaseline && cy.comparisons.length === cy.candidates.length));
ok('journal hash chain verifies', verifyJournal(join(tmp, 'journal.ndjson')).ok);
ok('report and manifest written', existsSync(join(st.runDir, 'REPORT.md')) && JSON.parse(readFileSync(join(st.runDir, 'manifest.json'), 'utf8')).files.length > 5);
ok('Kane call budget respected', st.budgets.kaneCallsUsed <= st.budgets.kaneCallsMax);
console.log(`${results.length}/${results.length} passed · run ${st.runDir}`);
process.exit(0);
