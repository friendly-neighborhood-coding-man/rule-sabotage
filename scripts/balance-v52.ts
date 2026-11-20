/**
 * V5.2 2x2 (offline, 0 Kane, 0 external calls):
 *   npm run balance:v52 -- preregister | run | evaluate <dir>
 */
import { resolve } from 'node:path';
const R = await import('../server/balance/v5_2/run.ts');
const [cmd, arg] = process.argv.slice(2);
if (cmd === 'preregister') { const e = R.preregister(); console.log(`preregistered #${e.seq}`, JSON.stringify({ ...(e.data as object), assignments: '[120]' })); }
else if (cmd === 'run') await R.run52();
else if (cmd === 'evaluate') { const e = R.evaluate52(resolve(arg)); console.log(JSON.stringify(e.verdicts)); }
else { console.log('usage: preregister | run | evaluate <dir>'); process.exit(2); }
