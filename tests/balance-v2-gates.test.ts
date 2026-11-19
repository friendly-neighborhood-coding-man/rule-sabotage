/**
 * Real-run stop rules for Balance Designer V2 (operator conditions of 2026-11-19), exercised with the kane-cli
 * TEST DOUBLE pretending to be a real CLI version (FAKE_KANE_VERSION) and a fake credit balance file.
 * Nothing here talks to Kane. It proves: no call without a verified balance; no call whose conservative estimate
 * exceeds the remaining budget; a run stops at CAPABILITY_LIMITATION after the exploration call when no valid
 * hypothesis came from a COMPLETE kane-cli execution; such notes are never registered as Kane hypotheses.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const tmp = mkdtempSync(join(tmpdir(), 'rs-v2-gates-'));
Object.assign(process.env, { KANE_REFEREE: 'on', KANE_CLI: join(root, 'tests/fixtures/fake-kane.mjs'), FAKE_KANE_VERSION: '9.9.9-gate-test', FAKE_KANE_MODE: 'approve' });
const { runV2 } = await import('../server/balance/v2/cycle.ts');
const { readJournal } = await import('../server/balance/journal.ts');
const cfg = JSON.parse(readFileSync(join(root, 'balance/v2/config.json'), 'utf8'));
cfg.seeds.development = [3900, 3901, 3902, 3903]; cfg.seeds.holdout = [7900, 7901, 7902, 7903];
let n = 0;
async function run(o: { objective: string; balance: number | null; cap?: number; cost?: number }) {
  const d = join(tmp, `r${++n}`);
  const c = structuredClone(cfg); if (o.cap !== undefined) c.kane.maxCreditsTotal = o.cap;
  writeFileSync(join(tmp, `cfg${n}.json`), JSON.stringify(c));
  const bal = join(tmp, `bal${n}.txt`), count = join(tmp, `count${n}.txt`);
  if (o.balance !== null) writeFileSync(bal, String(o.balance));
  Object.assign(process.env, { FAKE_KANE_OBJECTIVE_MODE: o.objective, FAKE_KANE_BALANCE_FILE: bal, FAKE_KANE_COST: String(o.cost ?? 0), FAKE_KANE_COUNT_FILE: count });
  const st = await runV2({ runKane: true, port: 0, quick: true, configFile: join(tmp, `cfg${n}.json`), evidenceRoot: d, log: () => {} });
  const calls = existsSync(count) ? readFileSync(count, 'utf8').split('\n').filter(Boolean).length : 0;
  return { st, calls, J: readJournal(st.journalFile) };
}

test('no valid hypothesis from exploration: stop at CAPABILITY_LIMITATION after one call, no experiments, credits accounted', async () => {
  const { st, calls, J } = await run({ objective: 'no-notes', balance: 100, cost: 7 });
  assert.match(st.checkpoint ?? '', /^CAPABILITY_LIMITATION/); assert.match(st.checkpoint ?? '', /READY_FOR_OPERATOR_V2_RESULT_REVIEW/);
  assert.equal(calls, 1);
  assert.equal(J.filter(e => e.type === 'experiment-result').length, 0, 'no experiment ran');
  assert.ok(!J.some(e => e.type === 'seeds-unsealed'), 'holdout untouched');
  assert.deepEqual(st.budgets.creditLedger.map(l => l.used), [7]); assert.equal(st.budgets.creditsUsed, 7);
});
test('a valid note from a kane-cli run that did not complete is kept as evidence but never registered as a Kane hypothesis', async () => {
  const { st, calls } = await run({ objective: 'fail-run', balance: 100 });
  assert.equal(calls, 1);
  assert.equal(st.exploration?.execution, 'RUN_END_NOT_PASSED');
  assert.equal(st.exploration?.notes.filter(x => !x.problems.length).length, 1);
  assert.equal(st.exploration?.capability, 'CAPABILITY_LIMITATION');
  assert.ok(!st.hypotheses.some(h => h.id.startsWith('HK')));
  assert.match(st.checkpoint ?? '', /^CAPABILITY_LIMITATION/);
});
test('no Kane call without a verified credit balance', async () => {
  const { st, calls } = await run({ objective: 'note', balance: null });
  assert.equal(calls, 0);
  assert.match(st.kane[0].note, /credit balance check failed/);
  assert.match(st.checkpoint ?? '', /^CAPABILITY_LIMITATION/);
});
test('a call whose conservative estimate exceeds the remaining budget is refused before it starts', async () => {
  const { st, calls } = await run({ objective: 'note', balance: 100, cap: 30 });
  assert.equal(calls, 0);
  assert.match(st.kane[0].note, /remaining budget 30\.000 credits < conservative estimate 40/);
});
