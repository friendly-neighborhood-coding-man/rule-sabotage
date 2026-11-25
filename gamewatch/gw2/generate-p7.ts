/**
 * GW2 P7 evidence generation (U1, D93): the frozen P5 generator (generate.ts, unchanged so that p5-generation-1 still
 * verifies) with the P7 scripts registered. This module adds the scripts of scenarios-p7.ts to the generator's script
 * registry and nothing else; generation, refusal rules and provenance are generate.ts's.
 *
 *   node --experimental-strip-types --no-warnings gamewatch/gw2/generate-p7.ts hashes <procedure.json>
 *   node --experimental-strip-types --no-warnings gamewatch/gw2/generate-p7.ts run <procedure.json> <run> <outDir>
 */
import { ALL_SCRIPTS, generate, buildHashes, loadGenerationProcedure, GenerationError } from './generate.ts';
import { P7_SCRIPTS } from './scenarios-p7.ts';

for (const s of P7_SCRIPTS) if (!ALL_SCRIPTS.some(x => x.id === s.id)) ALL_SCRIPTS.push(s);
export { generate, buildHashes, loadGenerationProcedure, GenerationError, ALL_SCRIPTS };

if (process.argv[1]?.endsWith('gw2/generate-p7.ts')) {
  const [cmd, proc, run, out] = process.argv.slice(2);
  try {
    if (cmd === 'hashes' && proc) console.log(JSON.stringify(await buildHashes(proc), null, 1));
    else if (cmd === 'run' && proc && run && out) { const r = await generate(proc, run, out, { log: s => console.log(s) }); console.log(`wrote ${r.out}: ${r.provenance.counts.cases} cases, ${r.provenance.counts.matches} matches`); }
    else { console.error('usage: generate-p7.ts hashes <procedure.json> | run <procedure.json> <run> <outDir>'); process.exit(2); }
  } catch (e) { console.error((e as Error).message); process.exit(5); }
}
