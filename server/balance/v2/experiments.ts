/**
 * Balance Designer V2 controlled experiment executor. Uses the REAL engine and the REAL planner (self-play
 * workers from V1). Each experiment changes ONE factor (see interventions.ts) against the same control:
 * same seeds, both first-player orders, same base weights. Head-to-head runs put the treated planner against
 * the control planner on both sides and both first-player orders, so its win rate is a randomized marginal
 * treatment impact rather than the selection-biased "win rate of players who used X".
 */
import { type Weights } from '../../weights.ts';
import { type Player, PLAYERS } from '../../rules.ts';
import { type GameRec, type Job, runJobs } from '../selfplay.ts';
import { type InterventionSpec, type Applied, applySpec, describeSpec } from './interventions.ts';
import { type Design } from './contracts.ts';
import { metric, firstDivergence } from './metrics.ts';

export type ExperimentDef = { id: string; title: string; spec: InterventionSpec; designs: Design[]; factor: string; manipulation: string };
/** The allowlisted catalogue. E1a/E1b change weights only; E2/E3/E5 one planner component each; E4 one rule property (experimental engine variant). */
export const EXPERIMENTS: Record<string, ExperimentDef> = {
  C0: { id: 'C0', title: 'Control', spec: { kind: 'control' }, designs: ['selfplay', 'observational'], factor: 'none', manipulation: 'none' },
  E1a: { id: 'E1a', title: 'Weight only: Teleport utility set to its measured V1 value (+3.4)', spec: { kind: 'weight', path: 'featureUtilityToActivator.teleport', value: 3.4 }, designs: ['selfplay'], factor: 'V0.3 activator utility of Teleport', manipulation: 'exactly one weight path differs' },
  E1b: { id: 'E1b', title: 'Weight only: utility overlay removed (weightMix 0)', spec: { kind: 'weight', path: 'weightMix', value: 0 }, designs: ['selfplay'], factor: 'V0.3 blend factor', manipulation: 'exactly one weight path differs' },
  E2: { id: 'E2', title: 'Planner valuation only: benefit from own-installed traps ignored', spec: { kind: 'planner', hook: 'selfBenefitFactor', value: 0 }, designs: ['selfplay', 'head-to-head'], factor: 'self-benefit valuation', manipulation: 'decisions diverge from control in some games' },
  E3: { id: 'E3', title: 'Placement search only: own-piece benefit no longer selects candidate cells', spec: { kind: 'planner', hook: 'searchOwnBenefit', value: false }, designs: ['selfplay', 'head-to-head'], factor: 'candidate-cell generation', manipulation: 'decisions diverge from control in some games' },
  E4: { id: 'E4', title: 'EXPERIMENTAL rule variant: Teleport stays in the same column', spec: { kind: 'rule-variant', teleport: 'same-column' }, designs: ['selfplay'], factor: 'Teleport destination geometry', manipulation: 'every teleport leaves the distance to goal unchanged' },
  E5: { id: 'E5', title: 'Planner information only: look-ahead cannot foresee random destinations', spec: { kind: 'planner', hook: 'blindRng', value: true }, designs: ['selfplay', 'head-to-head'], factor: 'RNG foresight in simulation', manipulation: 'decisions diverge from control in some games' },
};
export const experimentDesigns = Object.fromEntries(Object.entries(EXPERIMENTS).map(([k, v]) => [k, { designs: v.designs }]));

export type Seeds = { exploration: number[]; development: number[]; holdout: number[] };
/** Holds the final promotion seeds sealed until hypotheses and corrections are frozen. */
export class SeedVault {
  private seeds: Seeds;
  private unsealedFor: string | null = null;
  readonly accessLog: { at: string; set: string; purpose: string }[] = [];
  constructor(s: Seeds) {
    const all = [...s.exploration, ...s.development, ...s.holdout];
    if (new Set(all).size !== all.length) throw new Error('Seed sets overlap: exploration, development and holdout must be disjoint.');
    if (!s.development.length || !s.holdout.length) throw new Error('Development and holdout seed sets must be non-empty.');
    this.seeds = structuredClone(s);
  }
  exploration(purpose: string) { this.accessLog.push({ at: new Date().toISOString(), set: 'exploration', purpose }); return [...this.seeds.exploration]; }
  development(purpose: string) { this.accessLog.push({ at: new Date().toISOString(), set: 'development', purpose }); return [...this.seeds.development]; }
  /** Allowed only once, after unseal(). Hypothesis generation and experiment design can never see these seeds. */
  holdout(purpose: string) {
    if (!this.unsealedFor) throw new Error(`Holdout seeds are sealed (requested for "${purpose}"). They open only for the final promotion evaluation.`);
    this.accessLog.push({ at: new Date().toISOString(), set: 'holdout', purpose }); return [...this.seeds.holdout];
  }
  unseal(reason: string) { if (this.unsealedFor) throw new Error('Holdout already unsealed once.'); this.unsealedFor = reason; }
  get sealed() { return !this.unsealedFor; }
  /** For leak tests: is any holdout seed number present in this text? */
  leaks(text: string) { return this.seeds.holdout.filter(s => new RegExp(`\\b${s}\\b`).test(text)); }
}

export type ConditionRun = {
  key: string; experiment: string; design: Design; spec: InterventionSpec; description: string; specHash: string; component: string; diff: string[];
  seedSet: 'exploration' | 'development' | 'holdout'; seeds: number[]; games: GameRec[]; treated?: Player[]; startedAt: string; ms: number;
};

export function jobsFor(base: Weights, applied: Applied, seeds: number[], design: Design): { jobs: Job[]; treated?: Player[] } {
  if (design === 'selfplay' || design === 'observational') {
    const jobs = seeds.flatMap(seed => PLAYERS.map(first => ({ seed, first, weights: { human: applied.weights, ai: applied.weights }, ...(applied.hooks ? { hooks: { human: applied.hooks, ai: applied.hooks } } : {}), ...(applied.variant ? { variant: applied.variant } : {}) } as Job)));
    return { jobs };
  }
  if (applied.variant) throw new Error('A rule variant changes the game for both players; it has no head-to-head design.');
  const jobs: Job[] = [], treated: Player[] = [];
  for (const seed of seeds) for (const side of PLAYERS) for (const first of PLAYERS) {
    const other: Player = side === 'human' ? 'ai' : 'human';
    jobs.push({ seed, first, weights: { [side]: applied.weights, [other]: base } as Record<Player, Weights>, ...(applied.hooks ? { hooks: { [side]: applied.hooks } } : {}) });
    treated.push(side);
  }
  return { jobs, treated };
}

export async function runCondition(o: { base: Weights; experiment: string; spec?: InterventionSpec; design: Design; seeds: number[]; seedSet: ConditionRun['seedSet']; key?: string; workers?: number; maxMs?: number; onGame?: (d: number, t: number) => void }): Promise<ConditionRun> {
  const def = EXPERIMENTS[o.experiment];
  const spec = o.spec ?? def?.spec;
  if (!spec) throw new Error(`unknown experiment ${o.experiment}`);
  const applied = applySpec(o.base, spec);
  const { jobs, treated } = jobsFor(o.base, applied, o.seeds, o.design);
  const t0 = Date.now(), startedAt = new Date().toISOString();
  const games = await runJobs(jobs, { workers: o.workers, maxMs: o.maxMs, onGame: (d, t) => o.onGame?.(d, t) });
  return { key: o.key ?? `${o.experiment}/${o.design}/${o.seedSet}`, experiment: o.experiment, design: o.design, spec, description: describeSpec(spec), specHash: applied.specHash, component: applied.component, diff: applied.diff, seedSet: o.seedSet, seeds: o.seeds, games, ...(treated ? { treated } : {}), startedAt, ms: Date.now() - t0 };
}

export type Manipulation = { ok: boolean; detail: string; divergedGames: number; games: number; medianDivergenceTurn: number | null };
/** Did the intervention actually do what it declared? Checked on the treatment games, against the matching control games. */
export function manipulationCheck(run: ConditionRun, control: ConditionRun | null): Manipulation {
  const games = run.games.length;
  if (run.spec.kind === 'control') return { ok: true, detail: 'control', divergedGames: 0, games, medianDivergenceTurn: null };
  if (run.spec.kind === 'weight' && run.diff.length !== 1) return { ok: false, detail: `weight intervention changed ${run.diff.length} paths: ${run.diff.join(', ')}`, divergedGames: 0, games, medianDivergenceTurn: null };
  let diverged = 0; const turns: number[] = [];
  if (control && run.design !== 'head-to-head') {
    const ctl = new Map(control.games.map(g => [`${g.seed}/${g.first}`, g]));
    for (const g of run.games) { const c = ctl.get(`${g.seed}/${g.first}`); if (!c) continue; const d = firstDivergence(c, g); if (d !== null) { diverged++; turns.push(d); } }
  }
  turns.sort((a, b) => a - b);
  const med = turns.length ? turns[Math.floor(turns.length / 2)] : null;
  if (run.spec.kind === 'rule-variant') {
    const tps = run.games.flatMap(g => g.triggers.filter(t => t.kind === 'teleport' && t.realized !== null));
    const moved = tps.filter(t => t.realized !== 0);
    const tagged = run.games.every(g => g.variant === 'teleport-same-column');
    return { ok: tagged && moved.length === 0, detail: `${tps.length} teleports, ${moved.length} changed the distance to goal; variant tag on every game: ${tagged}`, divergedGames: diverged, games, medianDivergenceTurn: med };
  }
  if (run.design === 'head-to-head') {
    const tagged = run.games.every((g, i) => !!g.hooks?.[run.treated![i]] || run.spec.kind === 'weight');
    return { ok: tagged, detail: `treated planner on both sides and both first-player orders; hooks recorded on every game: ${tagged}`, divergedGames: 0, games, medianDivergenceTurn: null };
  }
  const ok = diverged > 0 || run.spec.kind === 'weight';
  return { ok, detail: `${diverged}/${games} games diverged from their control game (median first divergence turn ${med ?? '—'})${run.spec.kind === 'weight' && !diverged ? '; a weight change the planner ignores is a valid result, not a confound' : ''}`, divergedGames: diverged, games, medianDivergenceTurn: med };
}

export const quickSummary = (games: GameRec[]) => ({ games: games.length, tp_self_share: metric('tp_self_share', { recs: games }), ew_aligned_share: metric('ew_aligned_share', { recs: games }), safety: metric('safety_events', { recs: games }) });
