/**
 * Trial COVERAGE completeness (EXPERIMENTAL, separate step; it changes no referee decision and no frozen code).
 *
 * Why it exists (KS1, 2026-11-24): Kane judged all six fixed conditions true on a trial page that entered only 2 of the 3
 * proposed cells. The six conditions never ask whether every cell was tested, so a referee approval, engine or Kane, is
 * not sufficient evidence on its own. This module checks, from the trial itself, whether every required scenario exists:
 *
 *   required per proposed cell: at least one entry scenario (Human and AI piece entering the cell);
 *   for entry-relative effects (shove back / forward): one per in-board orthogonal entry side, because the outcome
 *   depends on the side. Missing scenarios => INCOMPLETE_EVIDENCE, whatever the condition results were.
 *   Missing coverage is NOT evidence that the effect is unsafe; it is missing evidence.
 *
 * Why A1 was not entered in KS1: the trial's approach() picks a neighbour to enter from, trying left, right, up, down,
 * and accepts only a neighbour inside the board with NO effect on it after the placement. A1 (0,0) has two in-board
 * neighbours, B1 (1,0) and A2 (0,1), and both were cells of the same placement, so no neighbour qualified and the trial
 * silently skipped A1 (the tier step then sent it to tier 3, "a new cell could not be entered").
 *
 * Proposed deterministic improvement (supplementaryScenarios): for a cell with no effect-free neighbour, enter from the
 * first in-board neighbour in the trial's fixed order (left, right, up, down), after removing ("pre-burning") its effect IN THE SANDBOX
 * COPY ONLY. This isolates the target cell: the scenario measures what the target cell does to a piece entering from that
 * side, with the neighbour's effect assumed already used up. It reuses the frozen trial's own enter() and sameOutcome(),
 * so a supplementary scenario is judged exactly like an original one. It is never fed back into the referee here.
 */
import { type State, type Placement, type Dir, key, parseKey, inside, cellName } from './engine.ts';
import { type Player } from '../rules.ts';
import { withPlacement, enter, sameOutcome, type Trial, type Outcome } from './forks/trial.ts';

export type CoverageStatus = 'COMPLETE' | 'INCOMPLETE_EVIDENCE';
export type Requirement = { cell: string; side: Dir | 'any'; covered: boolean; by: string | null };
export type Coverage = { status: CoverageStatus; requirements: Requirement[]; missing: string[]; entryRelative: boolean; note: string };

const SIDES: [number, number, Dir][] = [[-1, 0, 'right'], [1, 0, 'left'], [0, -1, 'down'], [0, 1, 'up']]; // same order as the trial's approach()
const entryRelative = (pl: Placement) => pl.effect.kind === 'shove' && (pl.effect.dir === 'back' || pl.effect.dir === 'forward');

/** Coverage of an existing trial for a placement (cells as engine keys). Pure. */
export function trialCoverage(trial: Pick<Trial, 'symmetry'>, pl: Placement): Coverage {
  const rel = entryRelative(pl), req: Requirement[] = [];
  for (const k of pl.cells) {
    const name = cellName(k), rows = trial.symmetry.filter(r => r.cell === name);
    if (!rel) req.push({ cell: name, side: 'any', covered: rows.length > 0, by: rows[0]?.scenarioId ?? null });
    else {
      const { x, y } = parseKey(k);
      for (const [dx, dy, dir] of SIDES) if (inside(x + dx, y + dy)) { const r = rows.find(z => z.dir === dir); req.push({ cell: name, side: dir, covered: !!r, by: r?.scenarioId ?? null }); }
    }
  }
  const missing = req.filter(r => !r.covered).map(r => (r.side === 'any' ? r.cell : `${r.cell} entering ${r.side}`));
  return { status: missing.length ? 'INCOMPLETE_EVIDENCE' : 'COMPLETE', requirements: req, missing, entryRelative: rel, note: missing.length ? 'Some required scenarios were never run. This is missing evidence, not evidence that the effect is unsafe.' : 'Every required scenario was run.' };
}

export type Supplementary = { cell: string; enteredFrom: string; dir: Dir; preBurned: string | null; human: Outcome; ai: Outcome; identical: boolean; fired: boolean; secondVisitFired: { human: boolean; ai: boolean } };
/**
 * Generates the missing single-entry scenarios (entry-independent effects) with the pre-burn rule above. Deterministic,
 * sandbox-only: `state` is not modified. Returns one scenario per cell that had none.
 */
export function supplementaryScenarios(state: State, proposer: Player, pl: Placement, cov: Coverage): Supplementary[] {
  const out: Supplementary[] = [];
  const h0 = withPlacement(state, proposer, pl);
  const rule = h0.rules[h0.rules.length - 1];
  for (const req of cov.requirements.filter(r => !r.covered && r.side === 'any')) {
    const k = pl.cells.find(c => cellName(c) === req.cell)!, { x, y } = parseKey(k);
    // exactly the trial's own choice when an effect-free neighbour exists; otherwise the first in-board neighbour, pre-burned
    const side = SIDES.find(([dx, dy]) => inside(x + dx, y + dy) && !h0.cells[key(x + dx, y + dy)]) ?? SIDES.find(([dx, dy]) => inside(x + dx, y + dy));
    if (!side) continue;
    const [dx, dy, dir] = side, from = key(x + dx, y + dy);
    const h = structuredClone(h0);
    let preBurned: string | null = null;
    if (h.cells[from]) { const rid = h.cells[from]; delete h.cells[from]; const r = h.rules.find(z => z.id === rid); if (r) r.cells = r.cells.filter(c => c !== from); preBurned = cellName(from); }
    const hu = enter(h, 'human', from, dir, rule.id, k), ai = enter(h, 'ai', from, dir, rule.id, k);
    out.push({ cell: req.cell, enteredFrom: cellName(from), dir, preBurned, human: hu.out, ai: ai.out, identical: sameOutcome(hu.out, ai.out), fired: hu.out.fired && ai.out.fired, secondVisitFired: { human: hu.secondVisitFired, ai: ai.secondVisitFired } });
  }
  return out;
}

/**
 * The four things the operator asked to keep apart (post-KS1 verdict). None of them implies another.
 */
export type EvaluationRecord = {
  conditionSatisfaction: { protocol: string; results: (boolean | null)[]; allTrue: boolean; source: string };
  trialCoverage: Coverage;
  refereeDecision: { by: 'engine-only referee'; final: string; tier: number | null; activated: boolean; unchanged: true };
  independentSafetyEvidence: { status: 'NONE'; note: string };
  supplementaryScenarios?: { method: string; scenarios: Supplementary[]; status: string };
  overall: 'INCOMPLETE_EVIDENCE' | 'CONDITIONS_SATISFIED_ON_COMPLETE_COVERAGE' | 'CONDITIONS_NOT_SATISFIED' | 'UNVERIFIED';
};
export function evaluationRecord(o: { protocol: string; results: (boolean | null)[]; source: string; coverage: Coverage; referee: { final: string; tier: number | null; activated: boolean }; supplementary?: Supplementary[] }): EvaluationRecord {
  const allTrue = o.results.length > 0 && o.results.every(r => r === true);
  const anyFalse = o.results.some(r => r === false);
  const overall = o.coverage.status === 'INCOMPLETE_EVIDENCE' ? 'INCOMPLETE_EVIDENCE' : anyFalse ? 'CONDITIONS_NOT_SATISFIED' : allTrue ? 'CONDITIONS_SATISFIED_ON_COMPLETE_COVERAGE' : 'UNVERIFIED';
  return {
    conditionSatisfaction: { protocol: o.protocol, results: o.results, allTrue, source: o.source },
    trialCoverage: o.coverage,
    refereeDecision: { by: 'engine-only referee', ...o.referee, unchanged: true },
    independentSafetyEvidence: { status: 'NONE', note: 'Neither the six fixed conditions nor the trial scenarios are an independent safety or correctness proof.' },
    ...(o.supplementary ? { supplementaryScenarios: { method: 'pre-burn: enter from the first in-board neighbour (left, right, up, down) after removing that neighbour\'s effect in the sandbox copy only (EXPERIMENTAL, not used by any referee)', scenarios: o.supplementary, status: o.supplementary.every(s => s.identical && s.fired && !s.secondVisitFired.human && !s.secondVisitFired.ai) ? 'all supplementary scenarios symmetric, fired once' : 'see scenarios' } } : {}),
    overall,
  };
}
