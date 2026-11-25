/**
 * GW2 P3 demonstration with a deterministic TEST DOUBLE (no Kane, no model): one blind discovery session against an
 * experiment's partitions, then the explicit session import, then the hypothesis freeze.
 *
 *   node --experimental-strip-types --no-warnings gamewatch/gw2/p3-demo.ts <expDir>      (expDir must hold partitions/)
 *
 * The test double opens the index and two case pages, submits two competing hypotheses (the second declares
 * competingWith H-1), one abstention and one finding, and ends the session. Then: completeness for a declared
 * must-access policy and verdict-time coverage are computed, the session is imported into <expDir>/judgments.ndjson
 * (with both assessments as separate evaluation nodes), and the hypotheses are frozen. Nothing is scored.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { startGw2Server } from './serve.ts';
import { loadSession } from './session.ts';
import { validatePolicy, evaluate } from './policy.ts';
import { sessionCoverage } from './coverage.ts';
import { importSession } from './import-session.ts';
import { freezeHypotheses } from './freeze.ts';
import { assertWritableOutput } from './paths.ts';
import type { Inventory } from './inventory.ts';
import type { BlindObservations } from './partition.ts';

export function discoveryInventory(exp: string): Inventory {
  const o = JSON.parse(readFileSync(join(exp, 'partitions/discovery/observations.json'), 'utf8')) as BlindObservations;
  const cases = o.cases.map(c => c.caseId), matches = o.matches.map(m => m.matchId);
  return { cases, matches, rules: [], evidence: new Set([...cases, ...matches]), ruleSet: new Set() };
}

export async function runP3Demo(expDir: string, opts: { freezeAt?: string } = {}) {
  const exp = assertWritableOutput(expDir), site = join(exp, 'partitions/discovery/site');
  if (!existsSync(site)) throw new Error(`no discovery site in ${exp}; run partition.ts first`);
  const inv = discoveryInventory(exp), [c1, c2] = inv.cases;
  const s = await startGw2Server({ exp: 'p3-demo', out: exp, site, label: 'test-double' });
  const base = `http://127.0.0.1:${s.port}`, ua = { 'user-agent': 'gw2-test-double/1' };
  const get = (p: string) => fetch(base + p, { headers: ua }).then(r => r.text());
  const post = (p: string, f: Record<string, string>) => fetch(base + p, { method: 'POST', headers: { ...ua, 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ ...f, nonce: s.nonce }) }).then(r => r.text());
  await get('/index.html'); await get(`/case-${c1}.html`); await get(`/case-${c2}.html`); await get('/hypothesis.html');
  await post('/hypothesis', { statement: 'TEST DOUBLE hypothesis (scripted, not a review): an effect cell is used up when a piece arrives on it.', trigger: 'a piece arrives on an effect cell', condition: 'always', effect: 'the cell is empty afterwards', confidence: 'medium', evidence: `${c1} steps 2-4` });
  await post('/hypothesis', { statement: 'TEST DOUBLE hypothesis (scripted, not a review): an effect cell stays until its owner removes it.', confidence: 'low', competingWith: 'H-1', evidence: `${c2} steps 2-5` });
  await post('/hypothesis', { abstain: 'yes', abstainScope: 'TEST DOUBLE abstention: cannot decide how many actions a side gets per turn from these two cases.', confidence: 'low' });
  await get('/report.html');
  await post('/report', { category: 'suspected bug needing reproduction', builds: '', claim: 'TEST DOUBLE finding (scripted, not a review).', evidence: `${c1}`, confidence: 'low' });
  await s.close();
  const policy = validatePolicy({ schema: 'gamewatch/gw2-policy@1', id: 'p3-demo', requirements: [{ id: 'open-two-cases', kind: 'must-access', targets: [c1, inv.cases[2]], reason: 'demonstration: one target opened, one not' }] }, inv);
  const completeness = evaluate(policy, inv, loadSession(s.dir)), coverage = sessionCoverage(inv, s.dir);
  const cF = join(s.dir, 'completeness.json'), vF = join(s.dir, 'coverage.json');
  writeFileSync(cF, JSON.stringify(completeness, null, 1) + '\n'); writeFileSync(vF, JSON.stringify(coverage, null, 1) + '\n');
  const imported = importSession(s.dir, join(exp, 'judgments.ndjson'), { completeness: cF, coverage: vF });
  const freeze = freezeHypotheses(exp, { at: opts.freezeAt });
  return { session: s.session, dir: s.dir, imported, freeze };
}

if (process.argv[1]?.endsWith('gw2/p3-demo.ts')) {
  const exp = process.argv[2];
  if (!exp) { console.error('usage: p3-demo.ts <expDir>'); process.exit(2); }
  const r = await runP3Demo(exp);
  console.log(`session ${r.session}: ${r.imported.nodes.length} nodes imported; frozen ${r.freeze.counts.hypotheses} hypotheses + ${r.freeze.counts.abstentions} abstentions; anchor ${r.freeze.graph.anchor.count}:${r.freeze.graph.anchor.lastLineSha256}`);
}
