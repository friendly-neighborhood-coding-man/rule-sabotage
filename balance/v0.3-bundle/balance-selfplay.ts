/**
 * Rule Sabotage: reproducible engine-backed AI-vs-AI score comparison.
 * Copy to <repo>/scripts/balance-selfplay.ts, and balance.weights.json to repo root.
 * This imports the REAL current engine; it is NOT an independent simulator.
 * Kane is NOT called here: all Kane decisions remain PENDING_REAL_KANE.
 *
 * Run from repository root:
 * node --experimental-strip-types scripts/balance-selfplay.ts 20
 *   [--ban8]  # experiment only; no change to the production placement engine
 */
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  init, applyPlacement, applyMove, endTurn, validatePlacement,
  type State, type Placement, type GameEvent,
} from '../server/engine.ts';
import { planTurn, planMoves } from '../server/ai.ts';
import { type Effect, type Player } from '../server/rules.ts';

type Weights = {
  version: string;
  featureUtilityToActivator: Record<string, number>;
  weightMix: number;
};
type Config = {
  schemaVersion: number; actorPerspective: 'activator'; baseline: Weights;
  candidate: Weights;
};
type Match = {
  seed: number; arm: string; firstPlayer: Player;
  winner: Player | 'draw'; turns: number;
  installed: number; triggers: number; selfTriggers: number;
  captures: number; chainCaps: number; scores: number;
  sideWins: { human: number; ai: number };
};

const N = Math.max(1, Math.min(500, Number(process.argv[2] ?? '20')));
const ban8 = process.argv.includes('--ban8');
const configPath = 'balance.weights.json';
const rawConfig = readFileSync(configPath, 'utf8');
const cfg = JSON.parse(rawConfig) as Config;
if (cfg.schemaVersion !== 1 || cfg.actorPerspective !== 'activator') throw new Error('Invalid weight schema / actor perspective');
const experiment = `balance-v03-${new Date().toISOString().replace(/[:.]/g, '-')}`;
const out = join('evidence', 'balance', experiment);
mkdirSync(out, { recursive: true });

const hash = (v: string) => createHash('sha256').update(v).digest('hex');
const goalX = (p: Player) => p === 'human' ? 6 : 0;
const opposite = (p: Player): Player => p === 'human' ? 'ai' : 'human';
const abs = Math.abs;

/** Signed activation utility: beneficial > 0, harmful < 0, RELATIVE TO THE PLAYER WHO STEPS. */
function activationUtility(e: Effect, stepping: Player, w: Weights): number {
  const U = w.featureUtilityToActivator;
  if (e.kind !== 'shove') return U[e.kind] ?? 0;
  const perStep = U.shovePerSquare ?? 0;
  if (e.dir === 'back') return (U.shoveBackPerSquare ?? -0.9) * e.amount;
  if (e.dir === 'forward') return (U.shoveForwardPerSquare ?? 0.9) * e.amount;
  const goalDir = stepping === 'human' ? 1 : -1;
  if (e.dir === 'east') return goalDir * perStep * e.amount;
  if (e.dir === 'west') return -goalDir * perStep * e.amount;
  return (U.shoveLateralPerSquare ?? 0) * e.amount;
}

function riskExposure(s: State, p: Player, x: number, y: number): number {
  let prob = 0;
  for (const q of s.pieces) {
    if (q.owner !== p || q.scored) continue;
    if ((goalX(p) - q.x) * (goalX(p) - x) < 0) continue;
    prob += 1 / (1 + 0.6 * abs(q.x - x) + 0.8 * abs(q.y - y));
  }
  return prob;
}
function tooClose(s: State, xy: string) {
  const [x, y] = xy.split(',').map(Number);
  return s.pieces.some(q => !q.scored && Math.max(abs(q.x - x), abs(q.y - y)) <= 1);
}
function placementValue(s: State, p: Player, pl: Placement, w: Weights) {
  let v = 0;
  for (const xy of pl.cells) {
    const [x, y] = xy.split(',').map(Number);
    // All effects apply to STEPPING owner. Installer is used only for tactical utility.
    const opponentExposure = riskExposure(s, opposite(p), x, y);
    const ownExposure = riskExposure(s, p, x, y);
    v += -activationUtility(pl.effect, opposite(p), w) * opponentExposure;
    v += activationUtility(pl.effect, p, w) * ownExposure;
  }
  return v;
}

function pickPlacement(s: State, p: Player, w: Weights): Placement | null {
  // Reuse the existing AI planner's engine-simulated candidates; nudge its ranking
  // with score weights. The weights do NOT change actual engine mechanics.
  const plans = planTurn(s, { me: p, temperature: 0 }).ranked;
  let best: { pl: Placement | null; score: number } | null = null;
  for (const candidate of plans) {
    const pl = candidate.placement;
    if (pl && ban8 && pl.cells.some(cell => tooClose(s, cell))) continue;
    if (pl && !validatePlacement(s, p, pl).ok) continue;
    const score = candidate.score + (pl ? w.weightMix * placementValue(s, p, pl, w) : 0);
    if (!best || score > best.score) best = { pl, score };
  }
  return best?.pl ?? null;
}

function play(seed: number, human: Weights, ai: Weights): Match {
  const s = init(seed);
  const firstPlayer = s.firstPlayer;
  let installed = 0, triggers = 0, selfTriggers = 0, captures = 0, chainCaps = 0, scores = 0;
  let guard = 0;
  function observe(events: GameEvent[]) {
    for (const e of events) {
      if (e.t === 'place') installed += e.cells.length;
      if (e.t === 'trigger') { triggers++; if (e.self) selfTriggers++; }
      if (e.t === 'capture') captures += e.pieces.length;
      if (e.t === 'chain-limit') chainCaps++;
      if (e.t === 'score') scores += e.pieces.length;
    }
  }
  while (!s.winner && ++guard <= 65) {
    const p = s.current;
    const w = p === 'human' ? human : ai;
    const pl = pickPlacement(s, p, w);
    if (pl && s.phase === 'place') observe(applyPlacement(s, p, pl));
    // Always calculate legal moves on the actual post-placement board.
    const movePlan = planMoves(s, p);
    for (const m of movePlan.moves) {
      if (s.winner) break;
      observe(applyMove(s, p, m));
    }
    if (!s.winner) observe(endTurn(s));
  }
  if (!s.winner) throw new Error(`Game did not terminate after ${guard} turns, seed ${seed}`);
  const winner = s.winner;
  return {
    seed, arm: '', firstPlayer, winner, turns: s.turn, installed,
    triggers, selfTriggers, captures, chainCaps, scores,
    sideWins: { human: winner === 'human' ? 1 : 0, ai: winner === 'ai' ? 1 : 0 },
  };
}

const rows: Match[] = [];
for (let i = 0; i < N; i++) {
  const seed = 10000 + i;
  rows.push({ ...play(seed, cfg.baseline, cfg.baseline), arm: 'baseline-v-baseline' });
  rows.push({ ...play(seed, cfg.candidate, cfg.baseline), arm: 'candidate-human' });
  rows.push({ ...play(seed, cfg.baseline, cfg.candidate), arm: 'candidate-ai' });
}
const arms = ['baseline-v-baseline', 'candidate-human', 'candidate-ai'];
const summary = arms.map(arm => {
  const arr = rows.filter(r => r.arm === arm);
  const count = (predicate: (r: Match) => boolean) => arr.filter(predicate).length;
  const avg = (pick: (r: Match) => number) => Number((arr.reduce((a, r) => a + pick(r), 0) / arr.length).toFixed(3));
  return {
    arm, n: arr.length, humanWins: count(r => r.winner === 'human'),
    aiWins: count(r => r.winner === 'ai'), draws: count(r => r.winner === 'draw'),
    firstPlayerWinRate: avg(r => Number(r.winner === r.firstPlayer)),
    meanTurns: avg(r => r.turns), meanTriggers: avg(r => r.triggers),
    meanSelfTriggers: avg(r => r.selfTriggers), meanInstalled: avg(r => r.installed),
    meanCaptures: avg(r => r.captures), meanChainCaps: avg(r => r.chainCaps),
  };
});
const evidence = {
  status: 'ENGINE_SELFPLAY_NO_KANE', schemaVersion: 1,
  experiment, timestamp: new Date().toISOString(),
  repo: 'friendly-neighborhood-coding-man/rule-sabotage',
  runtime: process.version,
  sourceFiles: ['server/engine.ts', 'server/rules.ts', 'server/ai.ts'],
  expectedBranch: 'claude/project-thread-2cwg9i',
  weightsSHA256: hash(rawConfig), gamesPerArm: N, ban8,
  notes: [
    'Both sides use local deterministic TypeScript AI, not LLMs.',
    'No Kane run. No weight promotion. Initial and candidate scores are human-proposed priors.',
    'Only currently implemented effect families are exercised.',
    'The ban8 toggle filters candidate placements but does not change the engine legality rules.',
    'Candidate shifts affect the AI decision policy, not the deterministic engine effects.',
  ],
  summary,
};
writeFileSync(join(out, 'matches.jsonl'), rows.map(r => JSON.stringify(r)).join('\n') + '\n');
writeFileSync(join(out, 'summary.json'), JSON.stringify(evidence, null, 2) + '\n');
writeFileSync(join(out, 'weights.snapshot.json'), rawConfig);
const ledgerEntry = {
  eventType: 'KANE_REVIEW_REQUESTED', status: 'PENDING_REAL_KANE',
  experiment, summaryPath: join(out, 'summary.json'), weightsSHA256: hash(rawConfig),
  issue: 'Check whether the candidate weight vector improves balance and does not exploit board asymmetry or softlocks.',
  reviewer: null, kaneCliVersion: null, kaneRunId: null, kaneVerdict: null,
  scorePatch: null, evidencePath: null, approvedForPromotion: false,
};
writeFileSync(join(out, 'kane-ledger.jsonl'), JSON.stringify(ledgerEntry) + '\n');
console.log(JSON.stringify({ evidencePath: out, summary }, null, 2));
