/** PRIVATE: the evidence builds and their source changes, from mutations.json. Nothing from here enters the bundle. */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, type Change } from '../builds.ts';
export function evidenceBuilds(): { label: string; changes: Change[] }[] {
  const m = JSON.parse(readFileSync(join(ROOT, 'gamewatch/private/mutations.json'), 'utf8'));
  return Object.entries(m.builds.evidence as Record<string, string[]>).map(([label, ids]) => ({ label, changes: m.mutations.filter((x: Change) => ids.includes(x.id)) }));
}
