/**
 * Evidence inventory and exact citation matching for GW2 (P1).
 * The inventory is read from a gamewatch/evidence@1 bundle: case ids, match ids and rule ids. Citations are found by
 * EXACT token match: a finding's text is split on every character that cannot be part of an identifier, and a token
 * counts only if it equals an inventory id. So "C-9fc650" matches C-9fc650, but "C-9fc6501", "xC-9fc650" and "R14" (for
 * R1) do not. The GW1 audit (steps/audit.ts) keeps its own substring matching; it is not changed.
 */
import { readFileSync, existsSync } from 'node:fs';
import type { GWBundle } from '../evidence.ts';

export type Inventory = { cases: string[]; matches: string[]; rules: string[]; evidence: Set<string>; ruleSet: Set<string> };

export function inventoryFromBundle(b: Pick<GWBundle, 'cases' | 'matches' | 'game'>): Inventory {
  const cases = b.cases.map(c => c.caseId), matches = b.matches.map(m => m.matchId), rules = b.game.rules.map(r => r.id);
  return { cases, matches, rules, evidence: new Set([...cases, ...matches]), ruleSet: new Set(rules) };
}
export const loadInventory = (bundleFile: string) => inventoryFromBundle(JSON.parse(readFileSync(bundleFile, 'utf8')));

/** The text fields of a finding that may carry citations (GW1 form fields; the nonce is never searched). */
export const CITATION_FIELDS = ['category', 'rules', 'builds', 'claim', 'evidence', 'reproduce', 'suggestion', 'confidence'];
export const tokens = (s: string) => s.split(/[^A-Za-z0-9-]+/).filter(Boolean);

export type Citations = { evidence: string[]; rules: string[]; unknownIdLike: string[]; byField: Record<string, string[]> };
/** Exact citations of inventory ids in one finding. unknownIdLike lists tokens shaped like ids that are not in the inventory. */
export function citations(note: Record<string, unknown>, inv: Inventory): Citations {
  const ev = new Set<string>(), ru = new Set<string>(), unk = new Set<string>(), byField: Record<string, string[]> = {};
  for (const f of CITATION_FIELDS) {
    const v = note[f]; if (typeof v !== 'string') continue;
    const hit: string[] = [];
    for (const t of tokens(v)) {
      if (inv.evidence.has(t)) { ev.add(t); hit.push(t); }
      else if (inv.ruleSet.has(t)) { ru.add(t); hit.push(t); }
      else if (/^[CM]-[0-9a-f]{4,}$/.test(t) || /^R\d{1,3}$/.test(t)) unk.add(t);
    }
    if (hit.length) byField[f] = [...new Set(hit)];
  }
  return { evidence: [...ev].sort(), rules: [...ru].sort(), unknownIdLike: [...unk].sort(), byField };
}

export function readNdjson(file: string): { lines: string[]; records: Record<string, unknown>[] } {
  if (!existsSync(file)) return { lines: [], records: [] };
  const lines = readFileSync(file, 'utf8').split('\n').filter(l => l.trim());
  return { lines, records: lines.map(l => JSON.parse(l)) };
}
