/**
 * V5 policy-diversity experiment (offline, 0 Kane, 0 external calls):
 *   npm run balance:v5 -- preregister      freeze protocol + hashes + assignments (clean tree, preflight present)
 *   npm run balance:v5 -- run              exactly 300 games, once
 *   npm run balance:v5 -- evaluate <dir>   preregistered evaluation -> <dir>/evaluation.json
 */
import { resolve } from 'node:path';
const { preregister, runV5, evaluateV5 } = await import('../server/balance/v5/run.ts');
const [cmd, arg] = process.argv.slice(2);
if (cmd === 'preregister') { const e = preregister(); console.log(`preregistered (journal #${e.seq})`, JSON.stringify({ ...(e.data as object), assignments: '[300]' })); }
else if (cmd === 'run') await runV5();
else if (cmd === 'evaluate') { const e = evaluateV5(resolve(arg)); console.log(JSON.stringify({ eligibility: e.eligibility, ruleRobustness: Object.fromEntries(Object.entries(e.ruleRobustness).map(([k, v]) => [k, v.verdict])) })); }
else { console.log('usage: preregister | run | evaluate <dir>'); process.exit(2); }
