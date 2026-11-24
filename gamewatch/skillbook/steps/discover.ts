/**
 * Collector: discover the game's documented rules and existing playtest infrastructure. Read-only. Writes out/discovery.json.
 * Looks for: the documented rules (adapter), the existing opponents, scripted playtests, recorded human playtest data,
 * earlier Kane evidence, and whether kane-cli answers `--version` (free; no account call).
 *   node gamewatch/skillbook/steps/discover.ts <out.json>
 */
import { writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { ROOT } from '../../builds.ts';
import { RULES } from '../../rules-doc.ts';
import { SCRIPTS } from '../../scenarios.ts';
import { OPPONENTS_V6 } from '../../../server/v6/opponents.ts';

const out = process.argv[2];
const count = (d: string) => (existsSync(join(ROOT, d)) ? readdirSync(join(ROOT, d)).length : 0);
const cli = process.env.KANE_CLI || 'kane-cli';
const v = spawnSync(cli, ['--version'], { encoding: 'utf8', timeout: 60_000, shell: process.platform === 'win32' });
const d = {
  game: 'Rule Sabotage V6.1', rules: RULES.map(r => r.id),
  playtestSources: {
    aiOpponents: Object.keys(OPPONENTS_V6), scriptedPlaytests: SCRIPTS.map(s => s.id),
    humanPlaytestData: { dir: 'playtest-data/', entries: count('playtest-data'), note: 'consent-gated, never committed; empty in a fresh checkout' },
    earlierKaneEvidence: { dir: 'evidence/v6/kane-preflight/', entries: count('evidence/v6/kane-preflight') },
  },
  kaneCli: v.status === 0 ? { found: true, version: v.stdout.trim().split(/\r?\n/).pop() } : { found: false, detail: (v.error?.message ?? v.stderr ?? '').slice(0, 200) },
  adapter: 'gamewatch/adapters/rule-sabotage.ts', coverageMap: 'gamewatch/adapters/rule-sabotage.coverage.json',
};
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify(d, null, 1) + '\n');
console.log(`${d.rules.length} rules, ${d.playtestSources.aiOpponents.length} AI opponents, ${d.playtestSources.scriptedPlaytests.length} scripted playtests, kane-cli ${d.kaneCli.found ? 'found' : 'not found'}`);
