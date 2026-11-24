/** The blind Kane review plan (data only). Printed by plan.ts, executed by run.ts. */
export const OBJECTIVE = [
  'You are a game QA reviewer. Open the GameWatch page at the given URL.',
  'It lists the documented rules (R1-R15) of a board game and evidence from playtests of two builds: scripted playtest cases (each step shows the state before and after and the engine events) and AI-vs-AI matches with aggregate statistics.',
  'Investigate whether either build violates the documented rules, behaves inconsistently (the same effect or rule giving different results in equivalent situations), handles the life cycle of pieces, effects or turns incorrectly, or shows a balance problem. Open case and match pages as needed and compare builds where the same script was run on both.',
  'For each finding, open report.html and submit one form. Choose the category: confirmed observable anomaly (you saw it directly in the evidence), suspected bug needing reproduction, balance hypothesis, or clean / no problem found. Cite case or match ids and step or turn numbers, name the rule, say how to reproduce or verify it, and suggest a fix and how to check it.',
  'Report only what the evidence supports and say when you are unsure. If you find nothing wrong, submit one "clean / no problem found" form saying what you checked. Submit at most 6 forms.',
].join(' ');

/**
 * GW1 budget policy (Eric, 2026-11-24 17:57 UTC): discovery quality over credit efficiency. No credit ceiling is an
 * experimental constraint. The shared paid-call gate (kanebudget.ts, used unchanged since KS1) still needs a number in the
 * approval and refuses when steps x 3.1 exceeds it, so the approval carries GATE_FIELD_CREDITS purely as gate bookkeeping:
 * it is set above the gate's own worst-case formula so that it never binds. Actual credits and time are logged.
 */
export const MAX_STEPS = 80;
export const TIMEOUT_S = 2700;
export const KILL_AFTER_S = TIMEOUT_S + 30;
export const GATE_FIELD_CREDITS = 300;

export const PLAN = {
  runId: 'GW1-blind-review',
  calls: 1, retries: 0, parallel: false, followUp: false, maxSteps: MAX_STEPS, timeoutS: TIMEOUT_S, killAfterS: KILL_AFTER_S,
  mode: 'objective',
  url: 'http://127.0.0.1:3210/index.html (served by run.ts itself on loopback, findings stored with source "kane")',
  args: ['run', '<OBJECTIVE>', '--url', 'http://127.0.0.1:3210/index.html', '--agent', '--headless', '--max-steps', String(MAX_STEPS), '--timeout', String(TIMEOUT_S)],
  objective: OBJECTIVE,
  inputs: 'evidence/gamewatch/site/ (56 static pages generated from evidence/gamewatch/evidence.json), hashes frozen in gamewatch/private/FREEZE.json',
  outputs: ['evidence/gamewatch/review/notes.ndjson (each submitted form, verbatim, with time and nonce validity)', 'evidence/gamewatch/review/run/GW1-blind-review/ (args, raw stdout.ndjson, stderr, meta with run_end, elapsed time, findings count)', 'evidence/gamewatch/review/ledger.ndjson (balance before and after, credits used, outcome)'],
  credits: {
    policy: 'No credit ceiling as an experimental constraint (operator decision 2026-11-24). Actual use is measured by strict balance reads before and after and logged.',
    historical: 'The one earlier objective-mode call (KX1, 25 max steps) used 40.09 credits by balance delta (run_end said 38.01).',
    gateFormula: `${MAX_STEPS} steps x 3.1 credits/step = ${Math.round(MAX_STEPS * 3.1 * 10) / 10} credits: the existing gate's own worst-case formula, an estimate only`,
    gateBookkeepingField: GATE_FIELD_CREDITS, hardCap: false,
    note: 'kane-cli 0.10.4 has no credit limit option; --max-steps and --timeout bound the call, and the process tree is killed after killAfterS. A running call cannot be stopped at a credit amount.',
  },
  limits: [
    'Exactly one kane-cli process; no retry on failure, timeout or unparsable output; no follow-up call; nothing in parallel.',
    `Before the call: frozen input hashes must match, the real CLI 0.10.4, strict balance read, balance >= ${GATE_FIELD_CREDITS * 1.5} (the gate's 1.5x rule on its bookkeeping field).`,
    `kane-cli --timeout ${TIMEOUT_S} s; the whole process tree is terminated at ${KILL_AFTER_S} s.`,
    'After the call: strict balance read; actual credits and elapsed time are logged. The gate is restored to disabled by the operator script; the SkillBook then stops before the coding-agent repair step.',
    'Kane sees only the loopback site. It never sees the repository, the private manifest, the reproduction tests or this plan.',
  ],
  scoring: 'After the call, findings are labelled by hand against gamewatch/private/mutations.json (gamewatch/private/score.ts prints both side by side): true detection, partial, false positive, unsupported, clean. Partial findings and failures are kept as they are. A forms count of 0 = Kane produced no finding (reported as such).',
  capabilityRisk: `The objective is unchanged and still asks for at most 6 forms; ${MAX_STEPS} steps should let Kane open the index and many of the 22 case pages and some of the 32 match pages, but not necessarily all 56. Which pages it opened is part of what the experiment measures.`,
};
