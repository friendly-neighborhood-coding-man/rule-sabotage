/**
 * Living Balance Designer V2 command line.
 *
 *   npm run balance:v2                         one investigation cycle, DRY-RUN (kane-cli NOT called; stops at READY_FOR_OPERATOR_REAL_KANE_V2)
 *   npm run balance:v2 -- --quick              smoke test (4 development + 4 holdout seeds)
 *   npm run balance:v2 -- --run-kane           REAL kane-cli (spends credits; only with the operator's explicit approval)
 *   npm run balance:v2:verify -- <journal>     verify a V2 journal's hash chain
 *
 * Flags: --port N (dashboard, default 4200) · --keep-open · --config FILE · --hypotheses FILE · --weights FILE · --journal FILE · --workers N
 */
import { resolve } from 'node:path';

const argv = process.argv.slice(2);
const cmd = argv[0] && !argv[0].startsWith('--') ? argv.shift()! : 'cycle';
const flag = (n: string) => argv.includes(`--${n}`);
const val = (n: string, d?: string) => { const i = argv.indexOf(`--${n}`); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d; };

if (cmd === 'verify') {
  const { verifyJournal } = await import('../server/balance/journal.ts');
  const f = resolve(argv[0] ?? 'balance/v2/journal.ndjson');
  const v = verifyJournal(f);
  console.log(`${f}: ${v.entries} entries, ${v.ok ? 'hash chain verified' : `BROKEN: ${v.problem}`}`);
  process.exit(v.ok ? 0 : 1);
}
const { runV2, loadV2Config } = await import('../server/balance/v2/cycle.ts');
const runKane = flag('run-kane');
if (runKane) {
  const c = loadV2Config(val('config') ? resolve(val('config')!) : undefined);
  console.log(`REAL KANE V2 RUN: at most ${c.kane.maxCallsTotal} kane-cli call(s), credit cap ${c.kane.maxCreditsTotal} (checked between calls), exploration max ${c.kane.explore.maxSteps} steps / ${c.kane.explore.timeoutS}s, analyzer timeout ${c.kane.analyzerTimeoutS}s, ${c.kane.maxConcurrent} at a time.`);
}
const st = await runV2({
  runKane, port: Number(val('port', '4200')), configFile: val('config') && resolve(val('config')!), hypothesesFile: val('hypotheses') && resolve(val('hypotheses')!),
  weightsFile: val('weights') && resolve(val('weights')!), journalFile: val('journal') ? resolve(val('journal')!) : runKane ? resolve('balance/v2/journal.ndjson') : undefined,
  quick: flag('quick'), keepOpen: flag('keep-open'), workers: val('workers') ? Number(val('workers')) : undefined,
});
console.log(`\nV2 run ${st.runId} finished${st.checkpoint ? ` at: ${st.checkpoint.split('\n')[0]}` : ''}. Evidence: ${st.runDir}`);
if (!flag('keep-open')) process.exit(st.checkpoint?.startsWith('FAILED') ? 1 : 0);
