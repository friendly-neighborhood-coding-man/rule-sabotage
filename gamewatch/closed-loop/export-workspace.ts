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
import { mkdirSync, rmSync, copyFileSync, existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { ROOT, materialize } from '../builds.ts';

export const BLIND_EXCLUDE = [
  'gamewatch/private', 'gamewatch/closed-loop/export-workspace.ts', 'gamewatch/kane/plan.ts', 'gamewatch/skill', 'gamewatch/skillbook',
  'gamewatch/README.md', 'gamewatch/INPUT_CONTRACT.md', 'gamewatch/kane', 'gamewatch/vendor', 'docs/GAMEWATCH.md', 'evidence/gamewatch',
  // gameplay freeze: its hashes and test identify the clean engine and would flag the build under test as changed
  'evidence/v6/gameplay-freeze.json', 'scripts/gameplay-freeze.ts', 'tests/gameplay-freeze.test.ts',
];

const [label, target, findings] = process.argv.slice(2);
if (!label || !target) { console.error('usage: export-workspace.ts <build-label> <target-dir> [findings.ndjson]'); process.exit(2); }
const dst = resolve(target);
if (dst === resolve(ROOT) || dst.startsWith(resolve(ROOT) + sep)) throw new Error('target must be outside the repository');
if (existsSync(dst) && readdirSync(dst).length) throw new Error('target must be empty');
const built = join(ROOT, 'server', `v6-build-${label}`, 'engine.ts');
if (!existsSync(built)) {
  // A checkout that kept the frozen bundle (--keep-existing) never materialized the builds: do it now, from the operator's list.
  const list = join(ROOT, 'gamewatch/private/evidence-builds.ts');
  const b = existsSync(list) ? ((await import(pathToFileURL(list).href)).evidenceBuilds() as { label: string; changes: never[] }[]).find(x => x.label === label) : undefined;
  if (!b) throw new Error(`build ${label} not materialized and not in the operator's build list`);
  materialize(b.label, b.changes);
}
mkdirSync(dst, { recursive: true });
// git archive to a file, then tar -x (works with Git for Windows and the tar.exe shipped with Windows 10+; no sh needed).
const tarFile = join(tmpdir(), `gw-workspace-${process.pid}.tar`);
execFileSync('git', ['-C', ROOT, 'archive', '--format=tar', '-o', tarFile, 'HEAD']);
execFileSync('tar', ['-xf', tarFile, '-C', dst]);
rmSync(tarFile, { force: true });
copyFileSync(built, join(dst, 'server/v6/engine.ts'));
// Everything that would reveal that defects were planted, where, how many, or what the clean engine is.
for (const p of BLIND_EXCLUDE) rmSync(join(dst, p), { recursive: true, force: true });
// The root README opens with the submission banner (it names the experiment): keep the game's own README text only.
const readme = join(dst, 'README.md');
if (existsSync(readme)) writeFileSync(readme, readFileSync(readme, 'utf8').replace(/^(?:>.*\r?\n)+\r?\n?/m, ''));
// npm scripts that point at removed files.
const pkgF = join(dst, 'package.json'), pkg = JSON.parse(readFileSync(pkgF, 'utf8'));
for (const k of Object.keys(pkg.scripts ?? {})) if (/^(gamewatch:(groundtruth|serve|kane-plan)|gameplay:freeze)$/.test(k)) delete pkg.scripts[k];
writeFileSync(pkgF, JSON.stringify(pkg, null, 2) + '\n');
// run-evidence.ts names the operator's private build list; the workspace has none.
const reF = join(dst, 'gamewatch/run-evidence.ts');
writeFileSync(reF, readFileSync(reF, 'utf8').replace('gamewatch/private/evidence-builds.ts', 'gamewatch/evidence-builds.ts'));
// builds.ts header describes how builds are made; in the workspace there is only the build under test.
const bF = join(dst, 'gamewatch/builds.ts');
writeFileSync(bF, readFileSync(bF, 'utf8').replace(/^\/\*\*[\s\S]*?\*\/\r?\n/, '/** GameWatch build loader: copies the game code under server/v6-build-<label>/ so playtests can run on a named build. */\n'));
if (findings) copyFileSync(findings, join(dst, 'KANE_FINDINGS.ndjson'));
console.log(`blind workspace ready: ${dst}\nbrief: gamewatch/closed-loop/AGENT_BRIEF.md`);
