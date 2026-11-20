/**
 * V4.2 development experiment (offline, 0 Kane, 0 external calls):
 *   npm run balance:v42 -- smoke <dir>       tooling smoke on throwaway seed 99403 (12 games, not a dataset)
 *   npm run balance:v42 -- preregister       freeze protocol + implementation hashes in the journal (clean tree required)
 *   npm run balance:v42 -- run               the 300 games, once
 *   npm run balance:v42 -- evaluate <dir>    preregistered evaluation -> <dir>/evaluation.json
 */
import { resolve, join } from 'node:path';
import { readFileSync } from 'node:fs';
import { ROOT } from '../server/balance/v3/batch.ts';
const { runDev, preregisterDev, evaluateDev } = await import('../server/balance/v4/devrun.ts');
const MANIP = join(ROOT, 'evidence/balance/v4/v42/manipulation.json');
const [cmd, arg] = process.argv.slice(2);
if (cmd === 'smoke') await runDev({ smoke: { dir: resolve(arg), seeds: [99403] } });
else if (cmd === 'preregister') { const e = preregisterDev(MANIP); console.log(`preregistered (journal #${e.seq})`, JSON.stringify(e.data)); }
else if (cmd === 'run') await runDev();
else if (cmd === 'evaluate') { const e = evaluateDev(resolve(arg), JSON.parse(readFileSync(MANIP, 'utf8'))); console.log(JSON.stringify({ hypotheses: e.hypotheses, manipulation: e.manipulation, guards: e.guards, crucialQuestion: e.crucialQuestion, headToHead: e.headToHead }, null, 1)); }
else { console.log('usage: smoke <dir> | preregister | run | evaluate <dir>'); process.exit(2); }
