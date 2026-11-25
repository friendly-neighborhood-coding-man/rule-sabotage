/**
 * GW2 P1 demonstration: one TEST-DOUBLE review session (a scripted HTTP client; no Kane, no model) against the GW2
 * review server, serving the GW1 evidence site read-only, with a policy that mixes mandatory and optional evidence.
 *
 *   node --experimental-strip-types --no-warnings gamewatch/gw2/demo-session.ts [outDir]     default evidence/gw2/p1-demo
 *
 * Script: index → C-757669 (mandatory) → C-757669 again (duplicate) → HEAD C-0ad0c4 → /favicon.ico (unrelated, 404)
 * → report form → finding citing C-757669, C-9fc650 (not yet served), M-0056c3 (optional, never served) and R8
 * → C-9fc650 (served after the finding) → session end. Mandatory C-ba3871 is never requested.
 * Expected: must-access unsatisfied (C-ba3871 missing), must-cite satisfied (R8), must-evaluate not-evaluable (P4);
 * the finding is reported verbatim whatever the completeness result; C-9fc650 is "cited without access" for the
 * finding but "recorded" at session end.
 */
import { writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { startGw2Server } from './serve.ts';
import { validatePolicy, evaluate } from './policy.ts';
import { loadInventory } from './inventory.ts';
import { loadSession } from './session.ts';
import { sessionCoverage, renderMarkdown } from './coverage.ts';
import { assertWritableOutput, ROOT } from './paths.ts';

export const DEMO_POLICY = {
  schema: 'gamewatch/gw2-policy@1', id: 'p1-demo',
  requirements: [
    { id: 'shove-chain-cases', kind: 'must-access', targets: ['C-757669', 'C-ba3871'], reason: 'Developer requires the reviewer to open the shove-chain case on the reference build and the shield case.' },
    { id: 'cite-burn-rule', kind: 'must-cite', targets: ['R8'], reason: 'Any review must say whether R8 (burn on entry) holds.' },
    { id: 'evaluate-burn-rule', kind: 'must-evaluate', targets: ['R8'], reason: 'R8 must be checked by the deterministic verifier.' },
  ],
};

export async function runDemo(outDir: string, bundle = join(ROOT, 'evidence/gamewatch/evidence.json'), site = join(ROOT, 'evidence/gamewatch/site')) {
  const out = assertWritableOutput(outDir);
  if (existsSync(join(out, 'sessions')) && readdirSync(join(out, 'sessions')).length) throw new Error(`${out} already holds a session; use a new directory`);
  mkdirSync(out, { recursive: true });
  const inv = loadInventory(bundle), policy = validatePolicy(DEMO_POLICY, inv);
  writeFileSync(join(out, 'policy.json'), JSON.stringify(DEMO_POLICY, null, 1) + '\n');
  const s = await startGw2Server({ exp: 'p1-demo', out, site, label: 'test-double' });
  const base = `http://127.0.0.1:${s.port}`, ua = { 'user-agent': 'gw2-test-double/1' };
  const get = (p: string, method = 'GET') => fetch(base + p, { method, headers: ua }).then(r => r.text());
  await get('/index.html');
  await get('/case-C-757669.html');
  await get('/case-C-757669.html');
  await get('/case-C-0ad0c4.html', 'HEAD');
  await get('/favicon.ico');
  await get('/report.html');
  await fetch(`${base}/report`, { method: 'POST', headers: { ...ua, 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({
    category: 'confirmed observable anomaly', rules: 'R8', builds: 'QX-73',
    claim: 'TEST DOUBLE finding (scripted, not a review): a +1 action cell reached by a shove fires again on re-entry.',
    evidence: 'C-757669 steps 6-9 (reference); C-9fc650 steps 6-9; compare M-0056c3', reproduce: 'scripted', suggestion: 'none', confidence: 'low', nonce: s.nonce }) });
  await get('/case-C-9fc650.html');
  await s.close();
  const session = loadSession(s.dir);
  const completeness = evaluate(policy, inv, session), coverage = sessionCoverage(inv, s.dir);
  writeFileSync(join(out, 'completeness.json'), JSON.stringify(completeness, null, 1) + '\n');
  writeFileSync(join(out, 'coverage.json'), JSON.stringify(coverage, null, 1) + '\n');
  writeFileSync(join(out, 'COVERAGE.md'), renderMarkdown(coverage));
  return { dir: s.dir, completeness, coverage };
}

if (process.argv[1]?.endsWith('gw2/demo-session.ts')) {
  const r = await runDemo(process.argv[2] ?? join(ROOT, 'evidence/gw2/p1-demo'));
  console.log(`session ${r.dir}\ncompleteness: ${r.completeness.investigationCompleteness.completeness}; ${r.completeness.investigationCompleteness.requirements.map(x => `${x.id}=${x.result}`).join(', ')}`);
  for (const c of r.coverage.columns) { const x = c.summary as { serverRecorded: { cases: number; matches: number }; citedWithoutAccess: string[] }; console.log(`${c.label}: served ${x.serverRecorded.cases} cases, ${x.serverRecorded.matches} matches; cited without access: ${x.citedWithoutAccess.join(', ') || 'none'}`); }
}
