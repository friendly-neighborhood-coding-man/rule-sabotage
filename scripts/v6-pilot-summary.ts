/**
 * V6 human-pilot summary (EXPERIMENTAL). Reads ONLY what consenting participants produced in playtest-data/v6/
 * (gitignored) and reports, per opponent, gameplay FACTS and SUBJECTIVE answers in separate sections:
 *   facts:   games, abandoned, game length, AI referee non-placement rate, AI latency, repeated AI openings,
 *            zero-move turns, deadline-prototype outcomes
 *   answers: ratings exactly as given (n answered per item, median), tags; skipped questionnaires counted
 * It invents nothing: with no records it says so. Run: npm run v6:pilot-summary
 */
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
process.env.PLAYTEST_DATA_DIR ??= resolve(fileURLToPath(new URL('../playtest-data/v6/', import.meta.url)));
const { readAll } = await import('../server/playtest/telemetry.ts');

type Tele = { schema: string; gameId: string; ruleset: string; opponent: { id: string }; result: { turns: number; abandoned: boolean; winner: string | null }; ai: { referee: { attempts: number; notPlaced: number }; latencyMs: { median: number | null; max: number | null }; zeroMoveTurns: unknown[]; deadline: { outcome: string }[] }; opening: { ai: string | null } };
type Ans = { schema: string; gameId: string; skipped: boolean; ratings: Record<string, number | null> | null; tags: string[] };
const tele = (readAll('telemetry') as Tele[]).filter(t => t.schema === 'rule-sabotage/v6-telemetry@1');
const ans = (readAll('feedback') as Ans[]).filter(a => a.schema === 'rule-sabotage/v6-feedback@1');
if (!tele.length) { console.log('No V6 pilot games recorded yet. Nothing to summarise (no data is ever invented).'); process.exit(0); }
const med = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor((s.length - 1) / 2)] : null; };
const byOpp = new Map<string, Tele[]>();
for (const t of tele) byOpp.set(t.opponent.id, [...(byOpp.get(t.opponent.id) ?? []), t]);
for (const [opp, ts] of byOpp) {
  const done = ts.filter(t => !t.result.abandoned), att = ts.reduce((a, t) => a + t.ai.referee.attempts, 0), np = ts.reduce((a, t) => a + t.ai.referee.notPlaced, 0);
  const openings = ts.map(t => t.opening.ai).filter(Boolean) as string[];
  console.log(`\n== ${opp}  (${ts.length} games, ${ts.length - done.length} abandoned)`);
  console.log('  FACTS');
  console.log(`   game length (finished games): median ${med(done.map(t => t.result.turns))} turns`);
  console.log(`   AI effects not placed by the referee: ${np}/${att}${att ? ` (${Math.round((np / att) * 100)}%)` : ''}`);
  console.log(`   AI latency: median of game medians ${med(ts.map(t => t.ai.latencyMs.median ?? 0))} ms, worst ${Math.max(...ts.map(t => t.ai.latencyMs.max ?? 0))} ms`);
  console.log(`   distinct AI openings: ${new Set(openings).size} of ${openings.length}`);
  console.log(`   AI zero-move turns: ${ts.reduce((a, t) => a + t.ai.zeroMoveTurns.length, 0)}`);
  const dl = ts.flatMap(t => t.ai.deadline ?? []); if (dl.length) console.log(`   deadline prototype outcomes: ${JSON.stringify(dl.reduce((a: Record<string, number>, d) => (a[d.outcome] = (a[d.outcome] ?? 0) + 1, a), {}))}`);
  const as = ans.filter(a => ts.some(t => t.gameId === a.gameId));
  console.log('  ANSWERS (as given by participants)');
  console.log(`   questionnaires: ${as.length} (${as.filter(a => a.skipped).length} skipped)`);
  for (const k of ['enjoyment', 'challenge', 'predictability', 'strategicChoice', 'playAgain']) { const v = as.map(a => a.ratings?.[k]).filter((x): x is number => typeof x === 'number'); console.log(`   ${k}: n=${v.length}${v.length ? `, median ${med(v)}` : ''}`); }
}
