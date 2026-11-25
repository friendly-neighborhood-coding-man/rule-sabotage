/**
 * GW2 P7 exploratory real-Kane pilot: PLAN DATA ONLY (prepared in P6, not executed, not authorized).
 * Used by kane-boundary.ts so that the P6 test-double route exercises exactly the argv a P7 call would get.
 * Nothing here enables a paid call: the paid-call gate (server/balance/v4/kanebudget.ts, PAID_RESEARCH_EXECUTION =
 * 'disabled') is unchanged, and changing it needs the operator's explicit approval.
 */
export const OBJECTIVE_P7 = [
  'You are investigating a two-player board game whose rules are not shown. Open the page at the given URL.',
  'It shows observations of builds of the game: scripted playtests (each step shows the state before and after and every event the game reported) and games between two computer players.',
  'Infer which rules the game appears to follow, and where builds behave differently. Open case and match pages as needed.',
  'For each rule you infer, open hypothesis.html and submit one form: a plain statement, your confidence, the case or match ids you relied on, and, if you can, the optional structured representation described on that page. You may submit competing hypotheses, and you may abstain on questions you cannot settle.',
  'Report only what the observations support. Submit at most 8 forms.',
].join(' ');

export const P7_MAX_STEPS = 80;
export const P7_TIMEOUT_S = 2700;
export const P7_KILL_AFTER_S = P7_TIMEOUT_S + 30;
export const P7_SESSIONS = 3;
export const P7_EXPECTED_CLI_VERSION = '0.10.4'; // the same pinned CLI as GW1 (scripts/kane-single-call.ts)

/** The argv of one objective-mode call (identical for the test-double route in P6 and a real call in P7). */
export const kaneArgv = (port: number, o: { maxSteps?: number; timeoutS?: number; objective?: string } = {}) =>
  ['run', o.objective ?? OBJECTIVE_P7, '--url', `http://127.0.0.1:${port}/index.html`, '--agent', '--headless', '--max-steps', String(o.maxSteps ?? P7_MAX_STEPS), '--timeout', String(o.timeoutS ?? P7_TIMEOUT_S)];

/** Cost basis from the repository's own records (no new measurement). */
export const P7_COST_BASIS = {
  gw1Run: { maxSteps: 80, creditsByBalanceDelta: 72.398, source: 'evidence/gamewatch/review/ledger.ndjson (GW1-blind-review call-end)' },
  kx1Run: { maxSteps: 25, creditsByBalanceDelta: 40.09, source: 'gamewatch/kane/plan-data.ts credits.historical' },
  gateFormulaPerRun: Math.round(P7_MAX_STEPS * 3.1 * 10) / 10,
  note: 'kane-cli has no credit limit; --max-steps and --timeout bound a call. The gate formula (steps x 3.1) is a worst-case local estimate, not a cap.',
};
