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

import { PLAN } from './plan-data.ts';

const sha = (f: string) => createHash('sha256').update(readFileSync(join(ROOT, f), 'utf8').replace(/\r\n/g, '\n')).digest('hex'); // LF-normalised (Windows checkouts)
const freeze = JSON.parse(readFileSync(join(ROOT, 'gamewatch/private/FREEZE.json'), 'utf8'));
const bad = Object.entries(freeze.files as Record<string, string>).filter(([f, h]) => sha(f) !== h).map(([f]) => f);
console.log(JSON.stringify({ ...PLAN, frozenInputs: bad.length ? { ok: false, changed: bad } : { ok: true, files: Object.keys(freeze.files).length, frozenAt: freeze.frozenAt } }, null, 2));
mkdirSync(join(ROOT, 'evidence/gamewatch/review'), { recursive: true });
writeFileSync(join(ROOT, 'evidence/gamewatch/review/PLAN.json'), JSON.stringify(PLAN, null, 2) + '\n');
if (bad.length) process.exit(1);
