/**
 * PRIVATE independent evaluation of the closed-loop repair. Run ONLY by the operator, ONLY after the repair attempt
 * ended and its output was frozen (evidence/gamewatch/repair/FREEZE.json). Never shown to the coding agent, and its
 * result never guides another repair attempt in the same experiment.
 *
 *   node --experimental-strip-types --no-warnings gamewatch/private/evaluate-repair.ts [labels.json] [--workspace <dir>]
 *   (--workspace: a re-exported workspace with the frozen output applied, to recompute from a fresh checkout; see docs/DEMO.md)
 *
 * 1. Verifies the frozen output against FREEZE.json (stops if anything changed since the freeze).
 * 2. Materializes the frozen game code (every server/v6 file the agent changed or added) as build "repaired" and runs
 *    the frozen probes against the clean baseline: per planted defect fixed / still present; controls unchanged or
 *    REGRESSION. Same probes and comparison as score.ts, extended to every changed game file.
 * 3. Runs the agent's own regression tests and the existing V6 tests in the workspace (code as frozen).
 * 4. With labels.json (the operator's manual labels of Kane's findings: which planted defect each one detects, if any),
 *    reports detected, missed, repaired and remaining defects separately.
 * Writes gamewatch/private/evaluation/EVALUATION.json.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { ROOT, materialize, loadBuild } from '../builds.ts';
import { probeShield, probeChain, probeActions, controlWalk, controlFreeze } from './probes.ts';
import { hashFile } from '../skillbook/steps/repair-freeze.ts';
import type { Player } from '../../server/rules.ts';

const REP = join(ROOT, 'evidence/gamewatch/repair');
const OUT = join(ROOT, 'gamewatch/private/evaluation');
const fr = JSON.parse(readFileSync(join(REP, 'FREEZE.json'), 'utf8'));
const attempt = JSON.parse(readFileSync(join(REP, 'attempt.json'), 'utf8'));
const wi = process.argv.indexOf('--workspace'); if (wi > 0) attempt.workspace = process.argv[wi + 1];
const M = JSON.parse(readFileSync(join(ROOT, 'gamewatch/private/mutations.json'), 'utf8'));

// 1. frozen output unchanged
const files = fr.files as Record<string, { before: string | null; after: string }>;
const mismatch = Object.entries(files).filter(([f, h]) => !existsSync(join(REP, 'output', f)) || hashFile(join(REP, 'output', f)) !== h.after).map(([f]) => f);
if (mismatch.length) { console.error(`frozen repair output changed since the freeze: ${mismatch.join(', ')}`); process.exit(1); }
const wsChanged = Object.entries(files).filter(([f, h]) => !/^evidence\//.test(f) && (!existsSync(join(attempt.workspace, f)) || hashFile(join(attempt.workspace, f)) !== h.after)).map(([f]) => f);

// 2. probes on the frozen game code
const norm = (f: string) => readFileSync(f, 'utf8').replace(/\r\n/g, '\n');
const game = Object.keys(files).filter(f => f.startsWith('server/v6/'));
const changes = game.filter(f => files[f].before !== null).map(f => ({ id: `repair:${f}`, file: f, find: norm(join(ROOT, f)), replace: norm(join(REP, 'output', f)) }));
const build = materialize('repaired', changes);
for (const f of game.filter(f => files[f].before === null)) { const t = join(build.dir, f.slice('server/v6/'.length)); mkdirSync(dirname(t), { recursive: true }); writeFileSync(t, norm(join(REP, 'output', f))); }
materialize('gt-clean', []);
const b = await loadBuild('repaired'), clean = await loadBuild('gt-clean');
const S: Player[] = ['human', 'ai'];
const same = (f: (x: typeof b, p: Player) => unknown) => S.every(p => JSON.stringify(f(b, p)) === JSON.stringify(f(clean, p)));
const probes: Record<string, 'fixed' | 'still present'> = { B1: same(probeShield) ? 'fixed' : 'still present', B2: same(probeChain) ? 'fixed' : 'still present', B3: same(probeActions) ? 'fixed' : 'still present' };
const controls = same(controlWalk) && same(controlFreeze) ? 'unchanged' : 'REGRESSION';

// 3. tests in the workspace (its code is the frozen code unless wsChanged says otherwise)
const run = (args: string[]) => { const r = spawnSync(process.execPath, args, { cwd: attempt.workspace, encoding: 'utf8', timeout: 900_000 }); const t = `${r.stdout}\n${r.stderr}`; return { exit: r.status, pass: Number(/# pass (\d+)/.exec(t)?.[1] ?? NaN), fail: Number(/# fail (\d+)/.exec(t)?.[1] ?? NaN) }; };
const agentTests = Object.keys(files).filter(f => /^tests\/.*\.test\.ts$/.test(f));
const tests = {
  v6: run(['--experimental-strip-types', '--no-warnings', '--test', ...JSON.parse(readFileSync(join(attempt.workspace, 'package.json'), 'utf8')).scripts['test:v6'].split('--test')[1].trim().split(/\s+/)]),
  agent: Object.fromEntries(agentTests.map(f => [f, run(['--experimental-strip-types', '--no-warnings', '--test', f])])),
};

// 4. detected / missed / repaired / remaining
const labelsF = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : undefined;
const labels = labelsF && existsSync(labelsF) ? JSON.parse(readFileSync(labelsF, 'utf8')) : null;
const ids: string[] = M.mutations.map((m: { id: string }) => m.id);
const detected = labels ? ids.filter(id => (labels.findings as { detects: string[] }[]).some(f => f.detects.includes(id))) : null;
const result = {
  schema: 'gamewatch/repair-evaluation@1', evaluatedAt: new Date().toISOString(), freeze: { frozenAt: fr.frozenAt, files: Object.keys(files).length, verified: true, workspaceCodeChangedSinceFreeze: wsChanged },
  agent: { exit: fr.agentExit, timedOut: fr.timedOut, ms: fr.ms, report: fr.report, changedGameFiles: game },
  probes, controls, tests,
  defects: ids.map(id => ({ id, class: M.mutations.find((m: { id: string }) => m.id === id).class, detectedByKane: detected ? detected.includes(id) : 'unlabelled', afterRepair: probes[id] })),
  summary: detected ? { detected, missed: ids.filter(i => !detected.includes(i)), repaired: ids.filter(i => probes[i] === 'fixed'), remaining: ids.filter(i => probes[i] !== 'fixed'), repairedWithoutKaneDetection: ids.filter(i => probes[i] === 'fixed' && !detected.includes(i)) } : null,
  labels,
};
mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, 'EVALUATION.json'), JSON.stringify(result, null, 1) + '\n');
console.log(JSON.stringify({ probes, controls, tests, summary: result.summary, workspaceCodeChangedSinceFreeze: wsChanged }, null, 1));
