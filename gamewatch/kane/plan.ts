/**
 * GameWatch blind Kane evaluation: REVIEWABLE PLAN. PREPARED, NOT RUN. This script never starts kane-cli.
 *
 *   node --experimental-strip-types --no-warnings gamewatch/kane/plan.ts      prints the plan and checks the frozen inputs
 *
 * Interface used (inspected in server/kane.ts and docs/BALANCE_V2_KANE_RESULT.md, kane-cli 0.10.4):
 *  - OBJECTIVE mode: `kane-cli run "<objective>" --url <url> --agent --headless --max-steps N --timeout S`. A browser agent
 *    follows a free-text objective and can fill in and submit HTML forms. This is the only mode that can produce
 *    open-ended findings: in the one earlier real run (KX1, 2026-11-17) it submitted one free-text notebook note via a
 *    form. run_end itself only carries status + a short summary, so findings are collected from the form submissions.
 *  - ANALYZER mode (`--analyzer-only --condition ...`) returns one boolean (+ a one-line reason) per FIXED condition. It
 *    cannot produce unrestricted bug reports: any condition we write would have to name what to look for, which would
 *    leak the answers. It is NOT used for the blind evaluation.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { ROOT } from '../builds.ts';

export const OBJECTIVE = [
  'You are a game QA reviewer. Open the GameWatch page at the given URL.',
  'It lists the documented rules (R1-R15) of a board game and evidence from playtests of two builds: scripted playtest cases (each step shows the state before and after and the engine events) and AI-vs-AI matches with aggregate statistics.',
  'Investigate whether either build violates the documented rules, behaves inconsistently (the same effect or rule giving different results in equivalent situations), handles the life cycle of pieces, effects or turns incorrectly, or shows a balance problem. Open case and match pages as needed and compare builds where the same script was run on both.',
  'For each finding, open report.html and submit one form. Choose the category: confirmed observable anomaly (you saw it directly in the evidence), suspected bug needing reproduction, balance hypothesis, or clean / no problem found. Cite case or match ids and step or turn numbers, name the rule, say how to reproduce or verify it, and suggest a fix and how to check it.',
  'Report only what the evidence supports and say when you are unsure. If you find nothing wrong, submit one "clean / no problem found" form saying what you checked. Submit at most 6 forms.',
].join(' ');

export const PLAN = {
  runId: 'GW1-blind-review',
  calls: 1, retries: 0, parallel: false, followUp: false,
  mode: 'objective',
  url: 'http://127.0.0.1:3210/index.html (gamewatch/kane/serve.ts --label kane, loopback only)',
  args: ['run', '<OBJECTIVE>', '--url', 'http://127.0.0.1:3210/index.html', '--agent', '--headless', '--max-steps', '25', '--timeout', '600'],
  objective: OBJECTIVE,
  inputs: 'evidence/gamewatch/site/ (56 static pages generated from evidence/gamewatch/evidence.json), hashes frozen in gamewatch/private/FREEZE.json',
  outputs: ['evidence/gamewatch/review/notes.ndjson (each submitted form, verbatim, with time and nonce validity)', 'evidence/gamewatch/review/run/GW1-blind-review/ (args, raw stdout.ndjson, stderr, meta with run_end and balance before/after)'],
  credits: {
    historical: 'The one earlier objective-mode call (KX1, 25 max steps) used 40.09 credits by balance delta (run_end said 38.01).',
    gateFormula: '25 steps x 3.1 credits/step (MEASURED_CREDITS_PER_STEP) = 77.5 credits worst case by the existing gate formula',
    ceiling: 80, hardCap: false,
    note: 'kane-cli 0.10.4 has no credit limit option; --max-steps and --timeout bound the call, a running call cannot be stopped at a credit amount.',
  },
  limits: [
    'Exactly one kane-cli process; no retry on failure, timeout or unparsable output; nothing in parallel.',
    'Before the call: frozen input hashes must match (this script), strict balance read, balance >= 120.',
    'After the call: strict balance read; used > 80 is reported as CEILING_EXCEEDED and blocks further paid calls until the operator clears it.',
    'Kane sees only the loopback site. It never sees the repository, the private manifest, the reproduction tests or this plan.',
  ],
  scoring: 'After the call, findings are labelled by hand against gamewatch/private/mutations.json (gamewatch/private/score.ts prints both side by side): true detection, partial, false positive, unsupported, clean. A forms count of 0 = Kane produced no finding (reported as such).',
  capabilityRisk: 'With 25 steps Kane can read the index (rules + aggregates) and only a handful of the 22 case pages; it may miss findings that live only in case pages. That is part of what the experiment measures.',
};

const sha = (f: string) => createHash('sha256').update(readFileSync(join(ROOT, f), 'utf8').replace(/\r\n/g, '\n')).digest('hex'); // LF-normalised (Windows checkouts)
const freeze = JSON.parse(readFileSync(join(ROOT, 'gamewatch/private/FREEZE.json'), 'utf8'));
const bad = Object.entries(freeze.files as Record<string, string>).filter(([f, h]) => sha(f) !== h).map(([f]) => f);
console.log(JSON.stringify({ ...PLAN, frozenInputs: bad.length ? { ok: false, changed: bad } : { ok: true, files: Object.keys(freeze.files).length, frozenAt: freeze.frozenAt } }, null, 2));
mkdirSync(join(ROOT, 'evidence/gamewatch/review'), { recursive: true });
writeFileSync(join(ROOT, 'evidence/gamewatch/review/PLAN.json'), JSON.stringify(PLAN, null, 2) + '\n');
if (bad.length) process.exit(1);
