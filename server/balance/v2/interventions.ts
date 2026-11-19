/**
 * Balance Designer V2: typed, allowlisted interventions. An intervention changes exactly ONE explanatory
 * factor. Nothing here executes free-form text: every spec is a closed union, validated before use, and
 * turned into (weights, planner hooks, rule variant) for the real engine and the real planner.
 */
import { createHash } from 'node:crypto';
import { type Weights, validateWeights, FEATURES, effectFromId } from '../../weights.ts';
import { type PlannerHooks } from '../../ai.ts';
import { type RuleVariant, EXPERIMENTAL_RULE_VARIANT } from '../../engine.ts';

export type Component = 'none' | 'weights' | 'planner-valuation' | 'planner-search' | 'planner-information' | 'rules';
export type InterventionSpec =
  | { kind: 'control' }
  | { kind: 'weight'; path: string; value: number }
  | { kind: 'planner'; hook: 'selfBenefitFactor'; value: number }
  | { kind: 'planner'; hook: 'searchOwnBenefit'; value: false }
  | { kind: 'planner'; hook: 'blindRng'; value: true }
  | { kind: 'rule-variant'; teleport: 'same-column' };

export type Applied = { weights: Weights; hooks: PlannerHooks | null; variant: RuleVariant | null; component: Component; diff: string[]; specHash: string };

export const componentOf = (s: InterventionSpec): Component =>
  s.kind === 'control' ? 'none' : s.kind === 'weight' ? 'weights' : s.kind === 'rule-variant' ? 'rules'
    : s.hook === 'selfBenefitFactor' ? 'planner-valuation' : s.hook === 'searchOwnBenefit' ? 'planner-search' : 'planner-information';

const sortKeys = (v: unknown): unknown => (v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b)).map(([k, x]) => [k, sortKeys(x)])) : v);
export const specHash = (s: InterventionSpec) => createHash('sha256').update(JSON.stringify(sortKeys(s))).digest('hex').slice(0, 16);

const WEIGHT_PATHS = [...FEATURES.map(f => `featureUtilityToActivator.${f}`), 'weightMix'];
/** Returns the reasons a spec is not allowed (empty = allowed). Unknown shapes are refused, never coerced. */
export function validateSpec(s: unknown): string[] {
  const o = s as Record<string, unknown>;
  if (!o || typeof o !== 'object' || Array.isArray(o)) return ['not an object'];
  const keys = Object.keys(o).sort().join(',');
  switch (o.kind) {
    case 'control': return keys === 'kind' ? [] : ['control takes no parameters'];
    case 'weight': {
      if (keys !== 'kind,path,value') return ['weight needs exactly {path, value}'];
      const p = String(o.path);
      const ok = WEIGHT_PATHS.includes(p) || (/^placementUpkeep\./.test(p) && !!effectFromId(p.slice('placementUpkeep.'.length)));
      if (!ok) return [`weight path ${p} is not allowlisted`];
      return typeof o.value === 'number' && Number.isFinite(o.value) ? [] : ['weight value must be a finite number'];
    }
    case 'planner':
      if (keys !== 'hook,kind,value') return ['planner needs exactly {hook, value}'];
      if (o.hook === 'selfBenefitFactor') return typeof o.value === 'number' && o.value >= 0 && o.value <= 1 ? [] : ['selfBenefitFactor must be in [0, 1]'];
      if (o.hook === 'searchOwnBenefit') return o.value === false ? [] : ['searchOwnBenefit can only be set to false'];
      if (o.hook === 'blindRng') return o.value === true ? [] : ['blindRng can only be set to true'];
      return [`planner hook ${String(o.hook)} is not allowlisted`];
    case 'rule-variant':
      if (keys !== 'kind,teleport' || o.teleport !== 'same-column') return ['the only allowlisted rule variant is {teleport: "same-column"}'];
      return [];
    default: return [`intervention kind ${String(o.kind)} is not allowlisted`];
  }
}

function setPath(w: Weights, path: string, value: number) {
  const [head, tail] = path.split(/\.(.+)/);
  if (tail === undefined) (w as unknown as Record<string, number>)[head] = value;
  else ((w as unknown as Record<string, Record<string, number>>)[head])[tail] = value;
}
function flat(v: unknown, prefix = ''): Record<string, string> {
  if (v && typeof v === 'object' && !Array.isArray(v)) return Object.assign({}, ...Object.entries(v).map(([k, x]) => flat(x, prefix ? `${prefix}.${k}` : k)));
  return { [prefix]: JSON.stringify(v) };
}
/** Every leaf that differs between two weight objects (used to prove a weight intervention touched one path only). */
export function weightDiff(a: Weights, b: Weights): string[] {
  const strip = (w: Weights) => { const c = { ...w, version: '', label: '', parent: '', createdAt: '', origin: '' } as Record<string, unknown>; delete c.hash; return c; };
  const fa = flat(strip(a)), fb = flat(strip(b));
  return [...new Set([...Object.keys(fa), ...Object.keys(fb)])].filter(k => fa[k] !== fb[k]).sort();
}

/** Turns a validated spec into what the executor needs. Throws on anything not allowlisted. */
export function applySpec(base: Weights, s: InterventionSpec): Applied {
  const errs = validateSpec(s);
  if (errs.length) throw new Error(`Refused intervention: ${errs.join('; ')}`);
  const w = structuredClone(base) as Weights & { hash?: string };
  delete w.hash;
  let hooks: PlannerHooks | null = null, variant: RuleVariant | null = null;
  if (s.kind === 'weight') {
    setPath(w, s.path, s.value);
    const v = validateWeights(w);
    if (!v.ok) throw new Error(`Refused intervention: resulting weights are invalid (${v.errors.join('; ')})`);
    w.version = `${base.version}+exp`; w.label = `EXPERIMENT ${s.path}=${s.value}`; w.origin = 'balance-v2 experiment (not promotable by itself)';
  }
  if (s.kind === 'planner') hooks = { [s.hook]: s.value } as PlannerHooks;
  if (s.kind === 'rule-variant') variant = { id: `teleport-${s.teleport}`, experimental: EXPERIMENTAL_RULE_VARIANT, teleport: s.teleport };
  const diff = s.kind === 'weight' ? weightDiff(base, w) : s.kind === 'planner' ? [`hooks.${s.hook}`] : s.kind === 'rule-variant' ? [`rules.teleport=${s.teleport}`] : [];
  return { weights: w, hooks, variant, component: componentOf(s), diff, specHash: specHash(s) };
}

export const describeSpec = (s: InterventionSpec): string =>
  s.kind === 'control' ? 'control: V0.3 weights, production planner, production rules'
    : s.kind === 'weight' ? `weights only: ${s.path} = ${s.value}`
      : s.kind === 'rule-variant' ? `EXPERIMENTAL RULE VARIANT: teleport destination = random empty square in the same column`
        : s.hook === 'selfBenefitFactor' ? `planner valuation only: benefit from own-installed traps × ${s.value}`
          : s.hook === 'searchOwnBenefit' ? 'planner placement search only: own-piece benefit no longer makes a cell a candidate'
            : 'planner information only: look-ahead uses a perturbed RNG copy (cannot foresee teleport destinations)';
