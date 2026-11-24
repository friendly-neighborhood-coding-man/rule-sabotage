/**
 * Closed-loop step 1 (operator only): export a BLIND workspace for the coding agent.
 *
 *   node --experimental-strip-types --no-warnings gamewatch/closed-loop/export-workspace.ts <build-label> <target-dir> [kane-findings.ndjson]
 *
 * The workspace is a plain copy of the committed tree (git archive: no history) in which server/v6/engine.ts is the
 * engine of the build under test, and everything that could reveal the planted defects is removed: gamewatch/private/,
 * the GameWatch design doc, the evidence bundle (it names the other build) and this exporter. The agent receives the
 * Kane findings (verbatim) and gamewatch/closed-loop/AGENT_BRIEF.md, and can re-run the same playtests with
 *   GW_BUILDS=under-test node --experimental-strip-types gamewatch/run-evidence.ts all
 * Limitation: the agent must also be denied network and repository access, or it could fetch the original engine.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, copyFileSync, existsSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { ROOT } from '../builds.ts';

const [label, target, findings] = process.argv.slice(2);
if (!label || !target) { console.error('usage: export-workspace.ts <build-label> <target-dir> [findings.ndjson]'); process.exit(2); }
const dst = resolve(target);
if (dst.startsWith(resolve(ROOT))) throw new Error('target must be outside the repository');
if (existsSync(dst) && readdirSync(dst).length) throw new Error('target must be empty');
const built = join(ROOT, 'server', `v6-build-${label}`, 'engine.ts');
if (!existsSync(built)) throw new Error(`build ${label} not materialized (run gamewatch/run-evidence.ts all first)`);
mkdirSync(dst, { recursive: true });
execFileSync('sh', ['-c', `git -C "${ROOT}" archive HEAD | tar -x -C "${dst}"`]);
copyFileSync(built, join(dst, 'server/v6/engine.ts'));
for (const p of ['gamewatch/private', 'gamewatch/closed-loop/export-workspace.ts', 'gamewatch/kane/plan.ts', 'docs/GAMEWATCH.md', 'evidence/gamewatch']) rmSync(join(dst, p), { recursive: true, force: true });
if (findings) copyFileSync(findings, join(dst, 'KANE_FINDINGS.ndjson'));
console.log(`blind workspace ready: ${dst}\nbrief: gamewatch/closed-loop/AGENT_BRIEF.md`);
