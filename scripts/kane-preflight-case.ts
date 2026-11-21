/**
 * Kane single-call PREFLIGHT, step 1: build the ONE historical case (no Kane call, no network).
 *
 * Case: V6.1 AI self-play (no human participant data), replay of the existing smoke game oa-v3 vs oa-v3, seed 96001,
 * AI first (evidence/v6/v6-2-replay.json). On turn 8 the policy playing the "human" side proposed "Send home" on
 * A1 A2 B1 and the engine-only referee left it unverified (tier 3: "a new cell could not be entered in the trial"), the
 * reason behind 81% of V6.1 non-placements. The game is replayed deterministically to that turn; the referee runs on it
 * exactly as in the game; the verdict must equal the recorded one or the script fails.
 *
 * Output (evidence/v6/kane-preflight/): state-before.json, engine-verdict.json, trial-page.html, case.json (a Kane
 * shadow case, kaneshadow.ts schema), conditions.json, manifest.json (SHA-256 of every file). Run once:
 *   npm run kane:preflight-case
 */
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { init, RULESET_V61, cellName } from '../server/v6/engine.ts';
import { aiTurnV6, trials } from '../server/v6/turn.ts';
import { shadowCase } from '../server/v6/kaneshadow.ts';
import { KANE_CONDITIONS } from '../server/v6/forks/trial.ts';
import { loadWeights } from '../server/weights.ts';
import { ROOT } from './v6-fork.ts';

const W8 = loadWeights();
export const CASE = { game: 'oa-v3/96001/ai-first', policy: 'oa-v3', seed: 96001, first: 'ai', turn: 8, side: 'human' } as const;
const recorded = (JSON.parse(readFileSync(join(ROOT, 'evidence/v6/v6-2-replay.json'), 'utf8')).attempts as { game: string; turn: number; p: string; final: string; code: string | null; label: string; cells: string[]; message: string }[])
  .find(a => a.game === CASE.game && a.turn === CASE.turn && a.p === CASE.side)!;
if (!recorded) throw new Error('recorded attempt not found');

const s = init(CASE.seed, { first: CASE.first, ruleset: RULESET_V61 });
let before = null as unknown, r = null as Awaited<ReturnType<typeof aiTurnV6>> | null;
while (!s.winner && s.turn <= CASE.turn) {
  const snap = structuredClone(s);
  const t = await aiTurnV6(s, s.current, CASE.policy, W8);
  if (snap.turn === CASE.turn) { before = snap; r = t; break; }
}
const v = r?.verdict;
if (!v || !before) throw new Error('turn not reached');
const same = v.final === recorded.final && v.code === recorded.code && v.label === recorded.label && JSON.stringify(v.cells) === JSON.stringify(recorded.cells) && v.message === recorded.message;
if (!same) throw new Error(`replayed verdict differs from the recorded one: ${JSON.stringify({ v, recorded })}`);
const html = trials.get(v.trialId!)!.html;
const c = shadowCase({ ruleset: RULESET_V61, gameId: `selfplay:${CASE.game}`, turn: CASE.turn, proposer: 'human', placement: { text: v.ruleText, effect: v.effect!, cells: v.cellKeys! }, verdict: v, trialHtml: html, refereeMs: v.ms ?? null })!;

const dir = join(ROOT, 'evidence/v6/kane-preflight');
mkdirSync(dir, { recursive: true });
const files: Record<string, string> = {
  'state-before.json': JSON.stringify(before, null, 1) + '\n',
  'engine-verdict.json': JSON.stringify({ ...v, note: 'As decided by the engine-only referee during the replayed self-play turn. Preserved unchanged; Kane has no authority over it.' }, null, 1) + '\n',
  'trial-page.html': html,
  'case.json': JSON.stringify(c, null, 1) + '\n',
  'conditions.json': JSON.stringify({ version: c.conditionsVersion, conditions: KANE_CONDITIONS }, null, 1) + '\n',
};
for (const [f, body] of Object.entries(files)) writeFileSync(join(dir, f), body);
const sha = (x: string) => createHash('sha256').update(x).digest('hex');
writeFileSync(join(dir, 'manifest.json'), JSON.stringify({
  schema: 'rule-sabotage/kane-single-call-case@1', createdAt: new Date().toISOString(), source: CASE, participantData: false,
  recordedVerdict: recorded, placement: { side: CASE.side, effect: v.label, cells: v.cells }, cellNames: (v.cellKeys ?? []).map(cellName),
  files: Object.fromEntries(Object.entries(files).map(([f, b]) => [f, sha(b)])),
}, null, 1) + '\n');
console.log(`case ${c.caseId}: ${v.label} on ${v.cells.join(' ')} -> ${v.final} (${v.code}); trial ${v.trialId}; files in evidence/v6/kane-preflight/`);
