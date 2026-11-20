/** V4.2 manipulation checks (no games): npm run balance:v42:manip -> evidence/balance/v4/v42/manipulation.json */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from '../server/balance/v3/batch.ts';
import { recordedPositions, syntheticPositions, checkK1, checkK2, checkK3 } from '../server/balance/v4/manipulation.ts';
import { evPlannerHash } from '../server/balance/v4/evplanner.ts';
const dir = join(ROOT, 'evidence/balance/v4/pilot/2026-11-19T21-42-56Z-v4-pilot');
const log = (s: string) => console.log(`[${new Date().toISOString()}] ${s}`);
const rec = recordedPositions(dir, 40), syn = syntheticPositions(30);
log(`positions: ${rec.length} recorded (offset 3 / every 11th, arms A/B/C), ${syn.length} synthetic`);
const out: Record<string, unknown> = { evPlannerHash: evPlannerHash(), newGamesPlayed: 0, positions: { recorded: rec.map(x => x.id), synthetic: syn.length } };
log('K1'); out.K1 = { recorded: checkK1(rec), synthetic: checkK1(syn) };
log('K3'); out.K3 = { recorded: checkK3(rec), synthetic: checkK3(syn) };
log('K2'); out.K2 = { recorded: checkK2(rec), synthetic: checkK2(syn) };
writeFileSync(join(ROOT, 'evidence/balance/v4/v42/manipulation.json'), JSON.stringify(out, null, 2));
log('written evidence/balance/v4/v42/manipulation.json');
console.log(JSON.stringify({ K1: out.K1, K2: out.K2, K3: out.K3 }));
