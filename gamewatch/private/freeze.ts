/** PRIVATE: freeze the ground truth and the Kane inputs (sha256 of every listed file). Run once, before any Kane call. */
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { ROOT } from '../builds.ts';
const files = [
  'gamewatch/private/mutations.json', 'gamewatch/private/GROUND_TRUTH.md', 'gamewatch/private/probes.ts', 'gamewatch/private/groundtruth.test.ts', 'gamewatch/private/score.ts',
  'gamewatch/builds.ts', 'gamewatch/scenarios.ts', 'gamewatch/adapters/rule-sabotage.ts', 'gamewatch/rules-doc.ts', 'gamewatch/dashboard.ts', 'gamewatch/run-evidence.ts',
  'server/v6/engine.ts', 'evidence/gamewatch/evidence.json',
  ...readdirSync(join(ROOT, 'evidence/gamewatch/site')).sort().map(f => `evidence/gamewatch/site/${f}`),
];
const out = { schema: 'gamewatch/freeze@1', frozenAt: new Date().toISOString(), note: 'Frozen before any Kane evaluation. Any change to these files after this point must be reported.', files: Object.fromEntries(files.map(f => [f, createHash('sha256').update(readFileSync(join(ROOT, f), 'utf8').replace(/\r\n/g, '\n')).digest('hex')])) };
writeFileSync(join(ROOT, 'gamewatch/private/FREEZE.json'), JSON.stringify(out, null, 1) + '\n');
console.log(`froze ${files.length} files at ${out.frozenAt}`);
