/**
 * Living Balance Loop V1 command line.
 *
 *   npm run balance:loop                      one cycle, DRY-RUN (no kane-cli, nothing promoted)
 *   npm run balance:loop -- --run-kane        one cycle with REAL kane-cli verification (uses credits)
 *   npm run balance:loop -- --run-kane --cycles 2
 *   npm run balance:loop -- --quick           4 training + 4 held-out seeds (smoke test)
 *   npm run balance:replay -- --seed 1003 --first ai [--turn 7] [--weights balance/history/weights-0.3.0.json]
 *   npm run balance:verify-journal [-- balance/journal.ndjson]
 *
 * Other flags: --port N (dashboard, default 4100) · --keep-open · --no-unit-tests · --no-promote
 *              --config FILE · --weights FILE · --journal FILE
 */
import { resolve } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';

const argv = process.argv.slice(2);
const cmd = argv[0] && !argv[0].startsWith('--') ? argv.shift()! : 'loop';
const flag = (n: string) => argv.includes(`--${n}`);
const val = (n: string, d?: string) => { const i = argv.indexOf(`--${n}`); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d; };

if (cmd === 'verify-journal') {
  const { verifyJournal } = await import('../server/balance/journal.ts');
  const f = resolve(argv[0] ?? 'balance/journal.ndjson');
  const v = verifyJournal(f);
  console.log(`${f}: ${v.entries} entries, ${v.ok ? 'hash chain verified' : `BROKEN: ${v.problem}`}`);
  process.exit(v.ok ? 0 : 1);
}
if (cmd === 'replay') {
  const { playGame } = await import('../server/balance/selfplay.ts');
  const { loadWeights, freezeWeights, validateWeights } = await import('../server/weights.ts');
  const wf = val('weights');
  const w = wf ? (() => { const v = validateWeights(JSON.parse(readFileSync(resolve(wf), 'utf8'))); if (!v.ok) throw new Error(v.errors.join('; ')); return freezeWeights(v.weights); })() : loadWeights();
  const seed = Number(val('seed', '1000')), first = (val('first', 'human') === 'ai' ? 'ai' : 'human') as 'human' | 'ai', turn = val('turn');
  const r = playGame(seed, first, { human: w, ai: w });
  console.log(`seed ${seed}, ${first} first, weights ${w.version}#${w.hash}: ${r.winner} after ${r.turns} turns (${r.reason})`);
  for (const t of r.triggers.filter(t => !turn || t.turn === Number(turn))) console.log(`  turn ${t.turn} ${t.mover} piece entered ${t.effect} (owner ${t.owner}) at ${t.cell}: ${t.how}; realized ${t.realized}, predicted ${t.predicted.toFixed(2)}`);
  process.exit(0);
}

const { runLoop } = await import('../server/balance/loop.ts');
const runKane = flag('run-kane');
const cycles = Number(val('cycles', '1'));
if (runKane) {
  const { loadConfig } = await import('../server/balance/loop.ts');
  const c = loadConfig(val('config') ? resolve(val('config')!) : undefined);
  const calls = Math.min(c.kane.maxCallsTotal, c.kane.maxCallsPerCycle * Math.min(cycles, c.budget.maxCycles));
  console.log(`REAL KANE RUN: at most ${calls} kane-cli call(s) (${c.kane.maxCallsPerCycle}/cycle), credit cap ${c.kane.maxCreditsTotal}, timeout ${c.kane.timeoutS}s each, ${c.kane.maxConcurrent} at a time.`);
}
if (val('weights') && !existsSync(resolve(val('weights')!))) throw new Error(`no such weights file: ${val('weights')}`);
const st = await runLoop({
  runKane, cycles, port: Number(val('port', '4100')), configFile: val('config') && resolve(val('config')!), weightsFile: val('weights') && resolve(val('weights')!),
  journalFile: val('journal') && resolve(val('journal')!), quick: flag('quick'), runUnitTests: !flag('no-unit-tests'), keepOpen: flag('keep-open'), promote: !flag('no-promote'),
});
console.log(`\nRun ${st.runId} finished${st.checkpoint ? ` at checkpoint: ${st.checkpoint}` : ''}. Evidence: ${st.runDir}`);
if (!flag('keep-open')) process.exit(st.checkpoint?.startsWith('FAILED') ? 1 : 0);
