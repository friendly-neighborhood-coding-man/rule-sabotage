/**
 * End-to-end check of one Balance Designer V2 cycle in --run-kane mode with the kane-cli TEST DOUBLE
 * (tests/fixtures/fake-kane.mjs). It proves the plumbing (observation → Kane exploration notebook → contracts
 * registered before results → sealed holdout → experiments → evaluation → Kane challenge conditions →
 * corrections → holdout re-observation → adequacy review → decision → journal → manifest) and that nothing
 * from a test double is ever treated as Kane evidence. Small seed sets: this is not a balance measurement.
 *   npm run test:balance-v2-e2e
 */
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const tmp = mkdtempSync(join(tmpdir(), 'rs-v2-e2e-'));
const chrome = ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', '/opt/pw-browsers/chromium', '/usr/bin/chromium'].find(p => existsSync(p));
if (!chrome) { console.log('SKIP: no Chrome for the analyzer pages'); process.exit(0); }
Object.assign(process.env, { KANE_REFEREE: 'on', KANE_CLI: join(root, 'tests/fixtures/fake-kane.mjs'), KANE_CHROME: chrome, FAKE_KANE_MODE: 'approve', FAKE_KANE_OBJECTIVE_MODE: 'note' });
const cfg = JSON.parse(readFileSync(join(root, 'balance/v2/config.json'), 'utf8'));
cfg.seeds.development = [3000, 3001, 3005, 3006]; cfg.seeds.holdout = [7000, 7001, 7002]; cfg.seeds.headToHeadSeeds = 1;
cfg.evaluation.minUnits = 3; cfg.evaluation.minEvents = 3; cfg.evaluation.bootstrap = 200; cfg.adequacy.minUnits = 3; cfg.corrections.max = 1;
writeFileSync(join(tmp, 'config.json'), JSON.stringify(cfg));
const hs = JSON.parse(readFileSync(join(root, 'balance/v2/hypotheses.json'), 'utf8'));
hs.hypotheses = hs.hypotheses.filter((h: { id: string }) => ['H0', 'H2', 'H5'].includes(h.id));
// PLUMBING ONLY: H2 is replaced by a deliberately weak version (any 3-point drop in shove self-triggers under E2),
// so the correction → holdout → adequacy path is exercised end to end on these few seeds. Games are deterministic,
// so this outcome is fixed for these seeds. It is labelled as such and proves nothing about balance.
Object.assign(hs.hypotheses.find((h: { id: string }) => h.id === 'H2'), { title: 'E2E PLUMBING ONLY: weak version of H2', competitors: ['H0'], interventions: ['E2'], predictions: [
  { id: 'P2a', experiment: 'E2', design: 'selfplay', metric: 'ew_self_trigger_share', direction: 'decrease', minEffect: 0.03, role: 'primary', text: 'plumbing' },
  { id: 'P2x', experiment: 'E2', design: 'selfplay', metric: 'ew_self_trigger_share', direction: 'decrease', minEffect: 0.03, role: 'discriminating', versus: ['H0'], text: 'plumbing: H0 makes no prediction here' }] });
writeFileSync(join(tmp, 'hypotheses.json'), JSON.stringify(hs));

const { runV2 } = await import('../server/balance/v2/cycle.ts');
const { verifyJournal, readJournal } = await import('../server/balance/journal.ts');
const before = readFileSync(join(root, 'balance/balance.weights.json'), 'utf8');
const st = await runV2({ runKane: true, port: 0, configFile: join(tmp, 'config.json'), hypothesesFile: join(tmp, 'hypotheses.json'), evidenceRoot: join(tmp, 'runs'), log: () => {} });
const results: string[] = [];
const ok = (name: string, cond: boolean, detail = '') => { assert.ok(cond, `${name} ${detail}`); results.push(name); console.log(`PASS ${name}`); };
const J = readJournal(st.journalFile);
const seq = (t: string) => J.find(e => e.type === t)?.seq ?? Infinity;

ok('cycle reached the decision stage', st.stages.find(s => s.key === 'decide')?.state === 'done', st.checkpoint ?? '');
ok('stops at READY_FOR_OPERATOR_REAL_KANE_V2 with the test double', /^READY_FOR_OPERATOR_REAL_KANE_V2/.test(st.checkpoint ?? ''), st.checkpoint ?? '');
ok('V1 evidence was hash-verified before use', st.observation?.v1Verified === true);
ok('the exploration call ran objective mode and its note was captured verbatim', st.exploration?.notes.length === 1 && !st.exploration.notes[0].problems.length && existsSync(join(st.runDir, 'kane-explore/kane-notes.ndjson')));
ok('the test-double note became a hypothesis labelled kane-test-double, never kane', st.hypotheses.some(h => h.id.startsWith('HK') && h.origin === 'kane-test-double') && !st.hypotheses.some(h => h.origin === 'kane'));
ok('every contract was registered before the first experiment result', J.filter(e => e.type === 'hypothesis-registered').every(e => e.seq < seq('experiment-result')) && seq('preregistration-closed') < seq('experiment-result'));
ok('holdout stayed sealed until corrections were frozen', seq('corrections-frozen') < seq('seeds-unsealed') && J.filter(e => e.type === 'experiment-result' && (e.data as { seedSet: string }).seedSet === 'holdout').every(e => e.seq > seq('seeds-unsealed')));
ok('every hypothesis got an explicit outcome', st.hypotheses.every(h => ['SUPPORTED', 'REFUTED', 'INCONCLUSIVE', 'NOT_TESTED'].includes(h.evaluation?.outcome ?? '')));
ok('the analyzer challenge ran on served pages with independent conditions, and the test double corroborates nothing', st.kane.some(k => k.role === 'challenge-analyzer' && k.analyzer?.isTestDouble) && st.hypotheses.every(h => h.evaluation?.kane.corroboration !== 'AGREES'));
const executable = st.corrections.filter(c => c.spec);
console.log(`  outcomes: ${st.hypotheses.map(h => `${h.id}=${h.evaluation?.outcome}`).join(' ')} · corrections: ${st.corrections.map(c => `${c.id}:${c.category}`).join(' ')}`);
ok('an executable correction was re-observed on the holdout (plumbing version of H2)', executable.length > 0 && st.experiments.some(e => e.seedSet === 'holdout' && e.key.startsWith(executable[0].id)));
ok('every adequacy review keeps implementation correctness and balance adequacy separate, and nothing is SUFFICIENT without real Kane', st.reviews.length > 0 && st.reviews.every(r => r.implementationCorrectness !== 'PASS' && ['UNVERIFIED', 'REGRESSION'].includes(r.balanceAdequacy)));
ok('production weights untouched; nothing was promoted', readFileSync(join(root, 'balance/balance.weights.json'), 'utf8') === before && !st.decision?.items.some(i => /^PROPOSED|^RECOMMENDED/.test(i.action)));
ok('Kane call budget respected', st.budgets.kaneCallsUsed <= st.budgets.kaneCallsMax);
ok('journal hash chain verifies', verifyJournal(st.journalFile).ok);
ok('report and manifest written', existsSync(join(st.runDir, 'REPORT.md')) && JSON.parse(readFileSync(join(st.runDir, 'manifest.json'), 'utf8')).files.length > 8);
console.log(`${results.length}/${results.length} passed · run ${st.runDir}`);
process.exit(0);
