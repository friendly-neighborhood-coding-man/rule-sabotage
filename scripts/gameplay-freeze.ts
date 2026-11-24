/**
 * Freeze of Rule Sabotage's clean gameplay implementation (operator verdict 2026-11-24, after PR #20).
 * Writes the SHA-256 (LF-normalised) of every file that defines how the V6 / V6.1 game plays: engine, rules, weights,
 * the generated policy forks, the turn/referee wiring, the opponents and adapters, the game server and the client.
 * tests/gameplay-freeze.test.ts fails if any of them changes. NOT frozen (separate, experimental, never part of play):
 * server/v6/coverage.ts (coverage check), server/v6/kaneshadow.ts and pilot.ts (evidence collection), scripts, docs.
 * To change gameplay later, regenerate this file in a reviewed commit: npm run gameplay:freeze
 */
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { ROOT } from './v6-fork.ts';

export const FREEZE_FILE = 'evidence/v6/gameplay-freeze.json';
export function frozenFiles(): string[] {
  const forks = readdirSync(join(ROOT, 'server/v6/forks')).filter(f => f.endsWith('.ts')).map(f => `server/v6/forks/${f}`);
  const client = readdirSync(join(ROOT, 'client/v6')).map(f => `client/v6/${f}`);
  return ['server/rules.ts', 'server/weights.ts', 'server/v6/engine.ts', 'server/v6/turn.ts', 'server/v6/opponents.ts', 'server/v6/referee-aware.ts', 'server/v6/budgeted.ts', 'server/v6/fastclone.ts', 'server/v6/planworker.ts', 'server/v6/session.ts', 'server/v6/server.ts', ...forks, ...client].sort();
}
export const hashFile = (f: string) => createHash('sha256').update(readFileSync(join(ROOT, f), 'utf8').replace(/\r\n/g, '\n')).digest('hex');

if (process.argv[1]?.endsWith('gameplay-freeze.ts')) {
  const files = Object.fromEntries(frozenFiles().map(f => [f, hashFile(f)]));
  writeFileSync(join(ROOT, FREEZE_FILE), JSON.stringify({ schema: 'rule-sabotage/gameplay-freeze@1', frozenAt: new Date().toISOString(), reason: 'Operator verdict 2026-11-24: freeze the clean V6 / V6.1 gameplay implementation; further work is the GameWatch QA harness.', defaults: { ruleset: 'rule-sabotage/v6.1-all-piece-proximity@1', pilotOpponents: ['v6-ev-k1.2-ra@1', 'v6-softmax-v2-ra@1', 'v6-oa-v3-ra@1'] }, notFrozen: ['server/v6/coverage.ts (experimental coverage check, separate from the live referee)', 'server/v6/kaneshadow.ts, server/v6/pilot.ts (evidence collection, no gameplay effect)'], files }, null, 1) + '\n');
  console.log(`frozen ${Object.keys(files).length} gameplay files -> ${FREEZE_FILE}`);
}
