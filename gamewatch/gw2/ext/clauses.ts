/** One entry point for interpreting a clause on situations (unchanged verifier functions, D121). */
import { evalLaw, evalInvariance, type ClauseEval } from '../verify.ts';
import type { Situation } from '../situations.ts';
export function evalClause(c: any, sits: Situation[]): ClauseEval & { comparisons?: unknown[] } {
  return c.form === 'invariance' ? evalInvariance(c, sits) : evalLaw(c, sits);
}
export const MAX_LISTED = 25;
