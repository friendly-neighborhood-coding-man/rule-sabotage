/**
 * PRIVATE closed-loop scorer. Run ONLY after the coding agent has finished, by the operator.
 *
 *   node --experimental-strip-types --no-warnings gamewatch/private/score.ts <corrected-engine.ts> [kane-findings.ndjson]
 *
 * 1. Materializes the corrected engine file as a build (server/v6-build-scored/) and runs the frozen independent probes:
 *    for each planted defect, is it still present? Do the controls still match the clean baseline (regressions)?
 * 2. If Kane findings are given, prints them next to the ground truth for MANUAL labelling (true detection / partial /
 *    false positive / unsupported). Matching free text automatically would be a claim this script cannot back, so it
 *    does not do it.
 */
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, materialize, loadBuild } from '../builds.ts';
import { probeShield, probeChain, probeActions, controlWalk, controlFreeze } from './probes.ts';
import type { Player } from '../../server/rules.ts';

const [enginePath, findingsPath] = process.argv.slice(2);
if (!enginePath || !existsSync(enginePath)) { console.error('usage: score.ts <corrected-engine.ts> [findings.ndjson]'); process.exit(2); }
const M = JSON.parse(readFileSync(join(ROOT, 'gamewatch/private/mutations.json'), 'utf8'));
const base = readFileSync(join(ROOT, 'server/v6/engine.ts'), 'utf8').replace(/\r\n/g, '\n');
const fixed = readFileSync(enginePath, 'utf8').replace(/\r\n/g, '\n');
materialize('scored', [{ id: 'corrected', file: 'server/v6/engine.ts', find: base, replace: fixed }]);
materialize('gt-clean', []);
const b = await loadBuild('scored'), clean = await loadBuild('gt-clean');
const S: Player[] = ['human', 'ai'];
const same = (f: (x: typeof b, p: Player) => unknown) => S.every(p => JSON.stringify(f(b, p)) === JSON.stringify(f(clean, p)));
const result = {
  B1: same(probeShield) ? 'fixed' : 'still present',
  B2: same(probeChain) ? 'fixed' : 'still present',
  B3: same(probeActions) ? 'fixed' : 'still present',
  controls: same(controlWalk) && same(controlFreeze) ? 'unchanged' : 'REGRESSION',
};
console.log(JSON.stringify({ engine: enginePath, result }, null, 2));
console.log('\nGround truth:');
for (const m of M.mutations) console.log(`  ${m.id} (${m.class}): ${m.intendedViolation}`);
if (findingsPath) {
  console.log('\nKane findings (label each by hand: true detection of B1/B2/B3, partial, false positive, unsupported, clean):');
  for (const line of readFileSync(findingsPath, 'utf8').split('\n').filter(Boolean)) { const n = JSON.parse(line); console.log(`- [${n.category}] ${n.claim}\n    evidence: ${n.evidence}`); }
}
