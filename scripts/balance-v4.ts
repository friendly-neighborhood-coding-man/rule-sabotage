/**
 * Balance Designer V4 commands (all offline, 0 Kane, 0 external calls):
 *   npm run balance:v4 -- preregister          journal the pilot protocol hash (once, before any pilot game)
 *   npm run balance:v4 -- smoke <dir>          tooling smoke on throwaway seeds 99301-99302 (6 games, not a dataset)
 *   npm run balance:v4 -- pilot                the 180-game pilot, run once
 *   npm run balance:v4 -- evaluate <dir>       preregistered evaluation -> <dir>/evaluation.json
 *   npm run balance:v4 -- kane-normalize       replay the stored KX3 Kane entries -> balance/v4/kane-normalized.json
 */
import { resolve } from 'node:path';
import { readJournal, appendJournal } from '../server/balance/journal.ts';
const { runPilot, evaluatePilot, protocolSha, V4_JOURNAL, PROTOCOL_FILE } = await import('../server/balance/v4/pilot.ts');
const [cmd, arg] = process.argv.slice(2);
if (cmd === 'preregister') {
  if (readJournal(V4_JOURNAL).some(e => e.type === 'pilot-preregistered')) throw new Error('already preregistered');
  const e = appendJournal(V4_JOURNAL, 'pilot-preregistered', 'V4-PILOT-180', null, { protocol: 'balance/v4/pilot-protocol.json', protocolSha256: protocolSha(), note: 'frozen before any pilot game' });
  console.log(`preregistered ${PROTOCOL_FILE} sha256 ${protocolSha()} (journal #${e.seq})`);
} else if (cmd === 'smoke') {
  await runPilot({ smoke: { seedsAB: [99301], seedsC: [99302], dir: resolve(arg) } });
} else if (cmd === 'pilot') {
  await runPilot();
} else if (cmd === 'evaluate') {
  const e = evaluatePilot(resolve(arg), process.env.V4_UNIT_TESTS === 'pass');
  console.log(JSON.stringify({ gates: e.gates, verdicts: e.verdicts, strength: e.strength, foresight: e.foresight }, null, 2));
} else if (cmd === 'kane-normalize') {
  const { replayKaneKX3 } = await import('../server/balance/v4/kanereplay.ts');
  console.log(replayKaneKX3(true).counts);
} else { console.log('usage: preregister | smoke <dir> | pilot | evaluate <dir> | kane-normalize'); process.exit(2); }
