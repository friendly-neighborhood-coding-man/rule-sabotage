/**
 * GW2 Extension V1: blind-site guard (D133). Operator-facing specification discrepancies must never be reachable through
 * the blinded agent's serving routes. The GW2 review server serves only files inside its --site directory (resolvePage
 * containment); this check makes the remaining assumption explicit: the site directory itself holds no operator output.
 * blindSiteProblems lists every file in the site that carries the operator-audience marker, has an operator output's
 * file name, mentions unmatched actions or the operator banner, or contains the text of a specification rule.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

export const OPERATOR_FILES = ['behaviour.html', 'unmatched-actions.html', 'contradictions.html', 'measures.html', 'behaviour.json', 'unmatched-actions.json', 'contradictions.json', 'measures.json', 'unmatched-groups.json'];
const MARKERS = [/gamewatch-audience"\s+content="operator-only/, /Unmatched action/i, /Operator view\./, /encoded specification/i];

function walk(d: string): string[] { return readdirSync(d).sort().flatMap(f => { const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : [p]; }); }

export function blindSiteProblems(site: string, specRuleTexts: string[]): string[] {
  const out: string[] = [];
  for (const f of walk(site)) {
    const rel = relative(site, f), text = readFileSync(f, 'utf8');
    if (OPERATOR_FILES.includes(rel.split(/[\\/]/).pop()!)) out.push(`${rel}: operator output file name`);
    for (const m of MARKERS) if (m.test(text)) out.push(`${rel}: operator marker ${m}`);
    for (const t of specRuleTexts) if (t.length > 20 && text.includes(t)) out.push(`${rel}: contains specification rule text`);
  }
  return out;
}
