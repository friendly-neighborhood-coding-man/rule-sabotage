/**
 * V4.1 diagnostics (reproducible; plays NO new game, reads the V4 pilot records only):
 *   npm run balance:v41:diagnose            -> evidence/balance/v4/diagnostics/v41-diagnostics.json
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { loadRecs, tempo, openings, mirrorCheck, turn2Captures, timeline, openingProbe } from '../server/balance/v4/diagnose.ts';
import { ROOT } from '../server/balance/v3/batch.ts';
const dir = join(ROOT, 'evidence/balance/v4/pilot/2026-11-19T21-42-56Z-v4-pilot');
const recs = loadRecs(dir), A = recs.filter(r => r.arm === 'A'), B = recs.filter(r => r.arm === 'B');
const probeSet = B.filter((_, i) => i % 5 === 0);
const log = (s: string) => console.log(`[${new Date().toISOString()}] ${s}`);
const out: Record<string, unknown> = { source: 'evidence/balance/v4/pilot/2026-11-19T21-42-56Z-v4-pilot', newGamesPlayed: 0 };
log('D1 tempo / timeline / turn-2 captures'); out.D1 = { tempo: { A: tempo(A), B: tempo(B) }, timeline: { A: timeline(A), B: timeline(B) }, turn2Captures: { A: turn2Captures(A), B: turn2Captures(B) } };
log('D3 openings'); out.D3 = { A: openings(A), B: openings(B) };
log('D2 mirror checks'); out.D2 = { production: mirrorCheck(A, { sample: 40, planner: 'production' }), ev: mirrorCheck(B, { sample: 40, planner: 'ev' }), evSideRelative: mirrorCheck(B, { sample: 40, planner: 'ev', variant: { sideRelativeOrder: true } }) };
log('opening probes');
out.openingProbes = [
  openingProbe(probeSet, {}), openingProbe(probeSet, { variant: { placementAwareReply: true } }), openingProbe(probeSet, { variant: { truncatedCandidates: true, placementAwareReply: true } }),
  ...[0, 1, 2, 3].map(k => openingProbe(probeSet, { forcedMoves: k })), ...[0, 1, 2, 3].map(k => openingProbe(probeSet, { forcedMoves: k, noPlacement: true })),
];
mkdirSync(join(ROOT, 'evidence/balance/v4/diagnostics'), { recursive: true });
writeFileSync(join(ROOT, 'evidence/balance/v4/diagnostics/v41-diagnostics.json'), JSON.stringify(out, null, 2));
log('written evidence/balance/v4/diagnostics/v41-diagnostics.json');
