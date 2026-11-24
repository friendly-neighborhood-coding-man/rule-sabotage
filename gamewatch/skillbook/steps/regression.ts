/**
 * Analyzer: regression review. Compares scripted playtests (matched by script title and seed) and AI-match aggregates of
 * three bundles: the reference build (last accepted release), the build before the fix and the build after the fix.
 * A REGRESSION is a script whose event sequence matched the reference before the fix and no longer does after it.
 *   node gamewatch/skillbook/steps/regression.ts <reference.json> <refBuild> <before.json> <beforeBuild> <after.json> <afterBuild> <out.json>
 * Exit 0 no regression; 10 regression found (listed).
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { GWBundle, GWCase } from '../../evidence.ts';

const [rf, rb, bf, bb, af, ab, outF] = process.argv.slice(2);
const load = (f: string, build: string) => { const b = JSON.parse(readFileSync(f, 'utf8')) as GWBundle; return b.cases.filter(c => c.build === build); };
const sig = (c: GWCase) => JSON.stringify(c.steps.map(s => [s.actor, s.action, s.outcome, s.events.map(e => { const { type, ...r } = e; return [type, r]; })]));
const ref = load(rf, rb), before = load(bf, bb), after = load(af, ab);
const key = (c: GWCase) => `${c.title} @${c.seed}`;
const rows = ref.map(r => {
  const b = before.find(c => key(c) === key(r)), a = after.find(c => key(c) === key(r));
  return { script: key(r), beforeMatchesReference: b ? sig(b) === sig(r) : null, afterMatchesReference: a ? sig(a) === sig(r) : null };
});
const regressions = rows.filter(r => r.beforeMatchesReference === true && r.afterMatchesReference === false).map(r => r.script);
const fixed = rows.filter(r => r.beforeMatchesReference === false && r.afterMatchesReference === true).map(r => r.script);
const stillDifferent = rows.filter(r => r.beforeMatchesReference === false && r.afterMatchesReference === false).map(r => r.script);
mkdirSync(dirname(outF), { recursive: true });
writeFileSync(outF, JSON.stringify({ reference: rb, before: bb, after: ab, scripts: rows.length, nowMatchingReference: fixed, stillDifferent, regressions, rows }, null, 1) + '\n');
console.log(`${rows.length} scripts: ${fixed.length} now match the reference, ${stillDifferent.length} still differ, ${regressions.length} regressions`);
process.exit(regressions.length ? 10 : 0);
