/**
 * Analyzer: coverage audit of a review. Which rules, builds, cases and matches the reviewer's findings cite, and which
 * evidence no finding looked at. Only findings with a valid session nonce from the named source count.
 *   node gamewatch/skillbook/steps/audit.ts <bundle.json> <notes.ndjson> <source: kane|human|test-double> <out.json>
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';
import type { GWBundle } from '../../evidence.ts';

const [bf, nf, source, outF] = process.argv.slice(2);
const b = JSON.parse(readFileSync(bf, 'utf8')) as GWBundle;
const notes = (existsSync(nf) ? readFileSync(nf, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)) : []).filter(n => n.source === source && n.nonceValid);
const text = notes.map(n => Object.values(n).join(' ')).join(' ');
const cited = (ids: string[]) => ids.filter(id => text.includes(id));
const rules = b.game.rules.map(r => r.id), cases = b.cases.map(c => c.caseId), matches = b.matches.map(m => m.matchId);
const r = {
  source, findings: notes.length, byCategory: notes.reduce((a: Record<string, number>, n) => ({ ...a, [n.category]: (a[n.category] ?? 0) + 1 }), {}),
  rulesCited: rules.filter(id => new RegExp(`\\b${id}\\b`).test(text)), rulesNotCited: rules.filter(id => !new RegExp(`\\b${id}\\b`).test(text)),
  casesCited: cited(cases), casesNotCited: cases.length - cited(cases).length, matchesCited: cited(matches), matchesNotCited: matches.length - cited(matches).length,
  findingsWithoutEvidenceIds: notes.filter(n => !cases.some(c => String(n.evidence).includes(c)) && !matches.some(m => String(n.evidence).includes(m))).length,
};
mkdirSync(dirname(outF), { recursive: true });
writeFileSync(outF, JSON.stringify(r, null, 1) + '\n');
console.log(JSON.stringify(r, null, 1));
process.exit(notes.length ? 0 : 3);
