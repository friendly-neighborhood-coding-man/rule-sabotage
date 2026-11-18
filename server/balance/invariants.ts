/**
 * Hard safety checks that do not depend on balance weights: for every implemented effect, a
 * sandboxed trial on fixed boards must pass the engine checks the referee uses (legal placement,
 * identical outcome for both sides, fire-once, chain cap, no softlock, placement decides nothing).
 */
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { init, eligibleCells } from '../engine.ts';
import { buildTrial } from '../trial.ts';
import { type Weights, plannerEffects, effectId } from '../weights.ts';
import { canonicalRuleText } from '../rules.ts';

const here = (f: string) => fileURLToPath(new URL(f, import.meta.url));
/** Hash of the files that define legality and effect execution. Weights must never change it. */
export const engineSourceHash = () => createHash('sha256').update(['../engine.ts', '../rules.ts', '../trial.ts'].map(f => readFileSync(here(f), 'utf8')).join('\0')).digest('hex').slice(0, 16);

export function runInvariants(w: Weights): { pass: boolean; checked: number; failures: string[] } {
  const failures: string[] = [];
  let checked = 0, n = 9000;
  for (const e of plannerEffects(w)) for (const seed of [3, 7, 11]) {
    const s = init(seed); s.current = 'human'; s.phase = 'place';
    const cells = eligibleCells(s, 'human').filter(k => /^[2-4],/.test(k)).filter((_, i) => i % 4 === seed % 4).slice(0, 3);
    const t = buildTrial(s, 'human', { text: canonicalRuleText(e), effect: e, cells, interpretedBy: 'invariants' }, ++n);
    checked++;
    for (const c of t.engineChecks) if (!c.pass) failures.push(`${effectId(e)} seed ${seed}: ${c.id} ${c.text} (${c.detail})`);
  }
  return { pass: failures.length === 0, checked, failures };
}
