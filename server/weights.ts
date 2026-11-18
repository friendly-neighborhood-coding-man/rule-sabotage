/**
 * Balance weights (Rule Space V0.3 §10): signed ACTIVATOR utilities for each implemented effect family
 * (positive = good for the owner of the piece that steps on it, whoever installed it), blended into the
 * planner's placement ranking with `weightMix`, plus a per-effect placement upkeep.
 *
 * They change WHICH plans the planner prefers. They never reach the engine: legality, effect execution,
 * symmetry and the referee do not import this file (tests/balance.test.ts checks it).
 *
 * File: balance/balance.weights.json (the promoted version). Every game freezes one version at start.
 */
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { type Effect, type Player, isEffect } from './rules.ts';

export const FEATURES = ['shovePerSquare', 'shoveBackPerSquare', 'shoveForwardPerSquare', 'shoveLateralPerSquare', 'freeze', 'home', 'teleport', 'shield', 'haste'] as const;
export type FeatureKey = typeof FEATURES[number];
export type PlannerWeights = { selfHarmFactor: number; immediateWeight: number; replyWeight: number; temperature: number; scoredBonus: number };
export type UnsupportedEffect = { utility: number | null; status: 'UNSUPPORTED'; note: string };
export type Weights = {
  schema: 'rule-sabotage/balance-weights@2'; version: string; label: string; parent: string | null; createdAt: string;
  ruleSpaceVersion: string; actorPerspective: 'activator'; origin: string;
  /** V0.3 §10B: signed utility to the activator (per square for shoves). */
  featureUtilityToActivator: Record<FeatureKey, number>;
  /** V0.3 §11: how strongly the utility overlay nudges the planner's engine-simulated ranking (0 = PR #2 planner). */
  weightMix: number;
  /** Turn-score the planner pays to place each implemented effect. Its keys are exactly the effects the planner may place. */
  placementUpkeep: Record<string, number>;
  planner: PlannerWeights;
  /** V0.3 §10C: future effects. Recorded, never simulated, never placed. */
  unsupported: Record<string, UnsupportedEffect>;
};
export type FrozenWeights = Readonly<Weights> & { readonly hash: string };

/** Stable id of an effect, e.g. "shove:back:2", "freeze". */
export const effectId = (e: Effect) => (e.kind === 'shove' ? `shove:${e.dir}:${e.amount}` : e.kind);
export function effectFromId(id: string): Effect | null {
  const [kind, dir, amount] = id.split(':');
  const e = kind === 'shove' ? { kind, dir, amount: Number(amount) } : { kind };
  return isEffect(e) ? e as Effect : null;
}
/** Which feature prices an effect. East/west shoves share one parameter, signed by the activator's goal direction. */
export function featureOf(e: Effect): FeatureKey {
  if (e.kind !== 'shove') return e.kind;
  return e.dir === 'back' ? 'shoveBackPerSquare' : e.dir === 'forward' ? 'shoveForwardPerSquare' : e.dir === 'north' || e.dir === 'south' ? 'shoveLateralPerSquare' : 'shovePerSquare';
}
/** V0.3 §10A: signed utility for the player whose piece steps on the effect. */
export function activationUtility(e: Effect, stepping: Player, w: Pick<Weights, 'featureUtilityToActivator'>): number {
  const U = w.featureUtilityToActivator;
  if (e.kind !== 'shove') return U[e.kind];
  if (e.dir === 'east' || e.dir === 'west') { const goalDir = stepping === 'human' ? 1 : -1; return (e.dir === 'east' ? goalDir : -goalDir) * U.shovePerSquare * e.amount; }
  return U[featureOf(e)] * e.amount;
}

export const BOUNDS = {
  utility: [-10, 10], weightMix: [0, 1], upkeep: [0, 2], selfHarmFactor: [0.5, 3], immediateWeight: [0, 1], replyWeight: [0, 1], temperature: [0, 3], scoredBonus: [1, 20],
} as const;
export const PLANNER_DEFAULTS: PlannerWeights = { selfHarmFactor: 1.15, immediateWeight: 0.4, replyWeight: 0.6, temperature: 0.6, scoredBonus: 6 };
export const CANDIDATE_IDS = ['shove:back:2', 'shove:back:3', 'shove:west:2', 'shove:east:2', 'shove:north:2', 'shove:south:2', 'freeze', 'home', 'teleport', 'haste', 'shield', 'shove:forward:2'];

export function validateWeights(w: unknown): { ok: true; weights: Weights } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  const o = w as Weights;
  if (!o || typeof o !== 'object') return { ok: false, errors: ['not an object'] };
  if (o.schema !== 'rule-sabotage/balance-weights@2') errors.push('schema must be rule-sabotage/balance-weights@2');
  if (typeof o.version !== 'string' || !o.version) errors.push('version missing');
  if (o.actorPerspective !== 'activator') errors.push('actorPerspective must be "activator" (Rule Space V0.3 §10A)');
  const inB = (v: unknown, [lo, hi]: readonly [number, number]) => typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi;
  const U = o.featureUtilityToActivator as Record<string, number> | undefined;
  if (!U || typeof U !== 'object') errors.push('featureUtilityToActivator missing');
  else {
    for (const f of FEATURES) if (!inB(U[f], BOUNDS.utility)) errors.push(`featureUtilityToActivator.${f}=${U[f]} outside ${BOUNDS.utility}`);
    for (const k of Object.keys(U)) if (!(FEATURES as readonly string[]).includes(k)) errors.push(`featureUtilityToActivator.${k}: not an implemented effect family (future effects belong in "unsupported")`);
  }
  if (!inB(o.weightMix, BOUNDS.weightMix)) errors.push(`weightMix=${o.weightMix} outside ${BOUNDS.weightMix}`);
  if (!o.placementUpkeep || typeof o.placementUpkeep !== 'object' || !Object.keys(o.placementUpkeep).length) errors.push('placementUpkeep missing');
  else for (const [id, v] of Object.entries(o.placementUpkeep)) {
    if (!effectFromId(id)) errors.push(`placementUpkeep.${id}: the engine has no such effect`);
    if (!inB(v, BOUNDS.upkeep)) errors.push(`placementUpkeep.${id}=${v} outside ${BOUNDS.upkeep}`);
  }
  for (const [id, u] of Object.entries(o.unsupported ?? {})) {
    if (u.status !== 'UNSUPPORTED') errors.push(`unsupported.${id}: status must be UNSUPPORTED`);
    if (effectFromId(id) || (FEATURES as readonly string[]).includes(id)) errors.push(`unsupported.${id}: the engine implements this, it cannot be listed as unsupported`);
  }
  const p = o.planner as PlannerWeights | undefined;
  if (!p) errors.push('planner missing');
  else for (const k of Object.keys(PLANNER_DEFAULTS) as (keyof PlannerWeights)[]) if (!inB(p[k], BOUNDS[k])) errors.push(`planner.${k}=${p[k]} outside ${BOUNDS[k]}`);
  return errors.length ? { ok: false, errors } : { ok: true, weights: o };
}

const sortKeys = (v: unknown): unknown => (v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b)).map(([k, x]) => [k, sortKeys(x)])) : v);
export const weightsHash = (w: Weights) => createHash('sha256').update(JSON.stringify(sortKeys({ ...w, hash: undefined }))).digest('hex').slice(0, 16);

function deepFreeze<T>(v: T): T { if (v && typeof v === 'object') { Object.values(v).forEach(deepFreeze); Object.freeze(v); } return v; }
/** A frozen copy for one game (or one self-play batch). Mutating it throws in strict mode. */
export function freezeWeights(w: Weights): FrozenWeights {
  const c = structuredClone(w) as Weights & { hash?: string };
  delete c.hash;
  return deepFreeze({ ...c, hash: weightsHash(c) });
}

/** Built-in fallback (only if the file is missing): weightMix 0, i.e. exactly the PR #2 planner. */
export function defaultWeights(): Weights {
  return {
    schema: 'rule-sabotage/balance-weights@2', version: '0.0.0-builtin', label: 'Built-in: PR #2 planner, no utility overlay (weightMix 0)', parent: null, createdAt: '2026-11-18T00:00:00Z',
    ruleSpaceVersion: '0.3', actorPerspective: 'activator', origin: 'built-in',
    featureUtilityToActivator: { shovePerSquare: 0.9, shoveBackPerSquare: -0.9, shoveForwardPerSquare: 0.9, shoveLateralPerSquare: -0.15, freeze: -2.2, home: -3.8, teleport: -0.8, shield: 1.4, haste: 1.8 },
    weightMix: 0, placementUpkeep: Object.fromEntries(CANDIDATE_IDS.map(id => [id, 0.15])), planner: { ...PLANNER_DEFAULTS }, unsupported: {},
  };
}
export const DEFAULT_WEIGHTS: FrozenWeights = freezeWeights(defaultWeights());

export const WEIGHTS_FILE = fileURLToPath(new URL('../balance/balance.weights.json', import.meta.url));
export function loadWeights(file = process.env.BALANCE_WEIGHTS_FILE || WEIGHTS_FILE): FrozenWeights {
  let raw: unknown;
  try { raw = JSON.parse(readFileSync(file, 'utf8')); } catch { return DEFAULT_WEIGHTS; }
  const v = validateWeights(raw);
  if (!v.ok) throw new Error(`Invalid balance weights in ${file}: ${v.errors.join('; ')}`);
  return freezeWeights(v.weights);
}

export const effectUpkeep = (w: Weights, e: Effect) => w.placementUpkeep[effectId(e)] ?? 0.15;
/** The effects the planner may place: the placementUpkeep keys (implemented only). Unsupported entries are never simulated. */
export const plannerEffects = (w: Weights): Effect[] => Object.keys(w.placementUpkeep).map(effectFromId).filter((e): e is Effect => !!e);
export const unsupportedEffects = (w: Weights) => Object.entries(w.unsupported ?? {}).map(([id, u]) => ({ id, note: `${u.note}${u.utility === null ? '' : ` (prior ${u.utility})`}` }));
