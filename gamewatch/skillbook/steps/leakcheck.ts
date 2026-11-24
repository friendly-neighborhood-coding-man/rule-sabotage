/**
 * Porter: check that the evidence pages carry no expected answers. Fails (exit 1) when a page contains any generic
 * answer-revealing term, or a term from an optional private list (gamewatch/private/leak-terms.json, operator only).
 * Also checks that case and match ids are anonymous hashes. Writes out/porter.json.
 *   node gamewatch/skillbook/steps/leakcheck.ts <siteDir> <out.json>
 */
import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { ROOT } from '../../builds.ts';

const [site, outF] = process.argv.slice(2);
const GENERIC = ['mutation', 'mutated', 'inject', 'planted', 'ground truth', 'ground-truth', 'expected verdict', 'expected answer', 'known bug', 'seeded defect', 'answer key'];
const privF = join(ROOT, 'gamewatch/private/leak-terms.json');
const terms = [...GENERIC, ...(existsSync(privF) ? JSON.parse(readFileSync(privF, 'utf8')) as string[] : [])].map(t => t.toLowerCase());
const hits: string[] = [];
const pages = readdirSync(site).filter(f => f.endsWith('.html'));
for (const f of pages) {
  const t = readFileSync(join(site, f), 'utf8').toLowerCase();
  for (const term of terms) if (t.includes(term)) hits.push(`${f}: "${term}"`);
  if (!/^(index|report|case-C-[0-9a-f]{6}|match-M-[0-9a-f]{6})\.html$/.test(f)) hits.push(`${f}: non-anonymous page name`);
}
mkdirSync(dirname(outF), { recursive: true });
writeFileSync(outF, JSON.stringify({ pages: pages.length, termsChecked: terms.length, privateTerms: existsSync(privF), hits }, null, 1) + '\n');
console.log(hits.length ? `LEAKS:\n  ${hits.join('\n  ')}` : `${pages.length} pages clean (${terms.length} terms)`);
process.exit(hits.length ? 1 : 0);
