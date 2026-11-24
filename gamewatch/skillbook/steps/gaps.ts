/**
 * Collector: identify missing evidence. For each documented rule, count the evidence that exercises it, per build and per
 * source (scripted cases, AI matches), using the adapter's rule -> event-pattern map. Every pattern of a rule must occur
 * at least once per build. Writes out/gaps.json. Exit 0 = every rule covered on every build; 10 = gaps (listed).
 *   node gamewatch/skillbook/steps/gaps.ts <bundle.json> <coverage.json> <out.json>
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { GWBundle, GWEvent } from '../../evidence.ts';

const [bundleF, covF, outF] = process.argv.slice(2);
const b = JSON.parse(readFileSync(bundleF, 'utf8')) as GWBundle;
const cov = JSON.parse(readFileSync(covF, 'utf8')) as { rules: Record<string, Record<string, unknown>[]> };
type Pat = Record<string, unknown>;
const match = (e: GWEvent, p: Pat) => Object.entries(p).every(([k, v]) => k === 'minChainDepth' ? Number(e.chainDepth ?? 0) >= Number(v) : k === 'refused' ? false : e[k] === v);
const out: Record<string, unknown> = {}, gaps: string[] = [];
for (const build of b.builds.map(x => x.label)) {
  const caseSteps = b.cases.filter(c => c.build === build).flatMap(c => c.steps);
  const caseEv = caseSteps.flatMap(s => s.events), matchEv = b.matches.filter(m => m.build === build).flatMap(m => m.rows.flatMap(r => r.events));
  const refusedPlacements = caseSteps.filter(s => s.outcome === 'refused' && /^place/.test(s.action)).length;
  const per: Record<string, unknown> = {};
  for (const [rule, pats] of Object.entries(cov.rules)) {
    const counts = pats.map(p => ({ pattern: p, cases: p.refused ? refusedPlacements : caseEv.filter(e => match(e, p)).length, matches: p.refused ? 0 : matchEv.filter(e => match(e, p)).length }));
    per[rule] = counts;
    for (const c of counts) if (c.cases + c.matches === 0) gaps.push(`${build} ${rule} ${JSON.stringify(c.pattern)}`);
  }
  out[build] = per;
}
mkdirSync(dirname(outF), { recursive: true });
writeFileSync(outF, JSON.stringify({ rules: Object.keys(cov.rules).length, gaps, coverage: out }, null, 1) + '\n');
console.log(gaps.length ? `gaps (${gaps.length}):\n  ${gaps.join('\n  ')}` : 'every rule exercised on every build');
process.exit(gaps.length ? 10 : 0);
