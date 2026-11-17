/**
 * Sandboxed rule trial. Re-creates the current game state, applies ONE proposed rule
 * in a copy, and runs bounded what-if scenarios with the real engine:
 *   S1/S2  each player steps on the rule (same rule, same square)
 *   S3     each player re-enters the burnt square (must not fire twice)
 *   S4     chain reactions with existing traps
 *   S5     8-round softlock rollout with both players racing
 *   S6     power budget
 * The result is plain data (rendered as a page for Kane) plus deterministic engine checks.
 */
import { createHash } from 'node:crypto';
import {
  type State, type Action, type GameEvent, type Pos, type Dir, resolveRound, validateAction, key, parseKey, inside,
  cellName, GOAL_X, DIRS, columnsLeft, NO_ACTION,
} from './engine.ts';
import { type Player, type Effect, PLAYERS, other, effectCost, RULE_BUDGET, shortLabel, describeEffect } from './rules.ts';
import { pathCost } from './ai.ts';

export type TriggerRow = {
  scenarioId: string; player: Player; enteredFrom: string; trapSquare: string; fired: boolean; effectSeen: string;
  endSquare: string; columnsTowardOwnGoal: number; turnsLost: number; statusAfter: string; chainLength: number;
  secondVisitFired: boolean;
};
export type RolloutRow = { round: number; human: string; ai: string; humanLegalMoves: number; aiLegalMoves: number; humanSkipping: boolean; aiSkipping: boolean };
export type Trial = {
  trialId: string; signature: string; proposer: Player; ruleText: string; effect: Effect; effectLabel: string; effectSummary: string;
  cells: string[]; cost: number; budget: number; existingRules: { owner: Player; label: string; squares: string[] }[];
  positions: Record<Player, string>; triggers: TriggerRow[]; chains: { scenarioId: string; player: Player; length: number; squares: string[] }[];
  rollout: { scenarioId: string; rows: RolloutRow[]; maxConsecutiveTurnsLost: Record<Player, number>; finished: string };
  engineChecks: { id: string; text: string; pass: boolean; detail: string }[];
  createdAt: string; buildMs: number;
};

const STATUS_TEXT = (s: State, p: Player) => [s.status[p].skip ? 'loses next turn' : '', s.status[p].reverse ? 'next move reversed' : '', s.status[p].shield ? 'shielded' : ''].filter(Boolean).join(', ') || 'none';

/** Apply only the proposed rule (both players hold) to get the hypothetical board. */
function withRule(s: State, proposer: Player, rule: Extract<Action['rule'], { op: 'place' }>): State {
  const acts = { human: NO_ACTION, ai: NO_ACTION } as Record<Player, Action>;
  acts[proposer] = { rule, move: 'hold' };
  // Statuses are cleared in the sandbox so the trial measures the rule itself.
  const clean = structuredClone(s);
  for (const p of PLAYERS) clean.status[p] = { skip: false, skipImmune: false, reverse: false, shield: false };
  return resolveRound(clean, acts).state;
}

function approachFor(s: State, p: Player, cell: string): { from: Pos; dir: Dir } | null {
  const c = parseKey(cell), toward = GOAL_X[p] > c.x ? 1 : -1;
  // Prefer entering in the direction of travel (from the player's own side), then from above/below.
  const tries: { dx: number; dy: number; dir: Dir }[] = [
    { dx: -toward, dy: 0, dir: toward > 0 ? 'right' : 'left' }, { dx: 0, dy: -1, dir: 'down' }, { dx: 0, dy: 1, dir: 'up' }, { dx: toward, dy: 0, dir: toward > 0 ? 'left' : 'right' },
  ];
  for (const t of tries) {
    const f = { x: c.x + t.dx, y: c.y + t.dy };
    if (inside(f.x, f.y) && f.x !== GOAL_X[p] && !s.rules.human.concat(s.rules.ai).some(r => r.cells.includes(key(f.x, f.y)))) return { from: f, dir: t.dir };
  }
  return null;
}

function triggerScenario(h: State, p: Player, cell: string, ruleId: number, sid: string): { row: TriggerRow; chain: string[] } | null {
  const ap = approachFor(h, p, cell);
  if (!ap) return null;
  const s = structuredClone(h);
  s.positions[p] = ap.from;
  const q = other(p);
  if (s.positions[q].x === ap.from.x && s.positions[q].y === ap.from.y) s.positions[q] = { x: GOAL_X[p] === 6 ? 6 : 0, y: (ap.from.y + 3) % 7 };
  s.winner = null;
  const before = columnsLeft(s, p);
  const acts = { human: NO_ACTION, ai: NO_ACTION } as Record<Player, Action>;
  acts[p] = { rule: { op: 'none' }, move: ap.dir };
  if (!validateAction(s, p, acts[p]).ok) return null;
  const { state: after, events } = resolveRound(s, acts);
  const trig = events.filter((e): e is Extract<GameEvent, { t: 'trigger' }> => e.t === 'trigger' && e.p === p);
  const fired = trig.some(e => e.ruleId === ruleId);
  const moved = Math.abs(ap.from.x - parseKey(cell).x) > 0 ? 1 : 0; // a normal step toward goal would gain this
  const gained = before - columnsLeft(after, p);
  // Second visit: step off and back on; the burnt square must not fire again.
  let secondVisitFired = false;
  const s2 = structuredClone(after); s2.winner = null;
  s2.positions[p] = ap.from; s2.status[p] = { skip: false, skipImmune: false, reverse: false, shield: false };
  const a2 = { human: NO_ACTION, ai: NO_ACTION } as Record<Player, Action>; a2[p] = { rule: { op: 'none' }, move: ap.dir };
  if (validateAction(s2, p, a2[p]).ok) {
    const r2 = resolveRound(s2, a2);
    secondVisitFired = r2.events.some(e => e.t === 'trigger' && e.ruleId === ruleId && e.cell === cell);
  }
  return {
    row: {
      scenarioId: sid, player: p, enteredFrom: cellName(key(ap.from.x, ap.from.y)), trapSquare: cellName(cell), fired,
      effectSeen: fired ? trig.find(e => e.ruleId === ruleId)!.label : 'none', endSquare: cellName(key(after.positions[p].x, after.positions[p].y)),
      columnsTowardOwnGoal: gained - moved, turnsLost: after.status[p].skip ? 1 : 0, statusAfter: STATUS_TEXT(after, p), chainLength: trig.length,
      secondVisitFired,
    },
    chain: trig.map(e => cellName(e.cell)),
  };
}

function greedyMove(s: State, p: Player): Dir {
  if (s.status[p].skip) return 'hold';
  let best: Dir = 'hold', bestCost = Infinity;
  for (const d of ['left', 'right', 'up', 'down', 'hold'] as Dir[]) {
    const a: Action = { rule: { op: 'none' }, move: d };
    if (!validateAction(s, p, a).ok) continue;
    const acts = { human: NO_ACTION, ai: NO_ACTION } as Record<Player, Action>;
    if (s.status[other(p)].skip) acts[other(p)] = NO_ACTION;
    acts[p] = a;
    try { const n = resolveRound(s, acts).state; const c = n.winner === p ? -1 : pathCost(n, p); if (c < bestCost) { bestCost = c; best = d; } } catch { /* skip */ }
  }
  return best;
}
const legalMoves = (s: State, p: Player) => s.status[p].skip ? 0 : (['left', 'right', 'up', 'down'] as Dir[]).filter(d => validateAction(s, p, { rule: { op: 'none' }, move: d }).ok).length;

export function buildTrial(state: State, proposer: Player, rule: Extract<Action['rule'], { op: 'place' }>, trialNo: number): Trial {
  const t0 = performance.now();
  const h = withRule(state, proposer, rule);
  const placed = h.rules[proposer].find(r => r.text === rule.text.trim() && r.round === state.round);
  const id = `T${String(trialNo).padStart(4, '0')}`;
  const triggers: TriggerRow[] = [], chains: Trial['chains'] = [];
  let n = 0;
  if (placed) {
    for (const cell of placed.cells.slice(0, 2)) for (const p of PLAYERS) {
      const sid = `${id}-S${++n}`;
      const r = triggerScenario(h, p, cell, placed.id, sid);
      if (r) { triggers.push(r.row); if (r.chain.length > 1) chains.push({ scenarioId: sid, player: p, length: r.chain.length, squares: r.chain }); }
    }
  }
  // Rollout: both players race greedily for 8 rounds on the hypothetical board.
  let s = structuredClone(h); s.winner = null;
  const rows: RolloutRow[] = [];
  const streak = { human: 0, ai: 0 }, maxStreak = { human: 0, ai: 0 };
  let finished = 'still running after 8 rounds';
  for (let i = 0; i < 8 && !s.winner; i++) {
    const row: RolloutRow = { round: i + 1, human: '', ai: '', humanLegalMoves: legalMoves(s, 'human'), aiLegalMoves: legalMoves(s, 'ai'), humanSkipping: s.status.human.skip, aiSkipping: s.status.ai.skip };
    for (const p of PLAYERS) { if (s.status[p].skip) { streak[p]++; maxStreak[p] = Math.max(maxStreak[p], streak[p]); } else streak[p] = 0; }
    const acts = { human: { rule: { op: 'none' }, move: greedyMove(s, 'human') }, ai: { rule: { op: 'none' }, move: greedyMove(s, 'ai') } } as Record<Player, Action>;
    s = resolveRound(s, acts).state;
    row.human = cellName(key(s.positions.human.x, s.positions.human.y)); row.ai = cellName(key(s.positions.ai.x, s.positions.ai.y));
    rows.push(row);
    if (s.winner) finished = s.winner === 'draw' ? `both reached goal in round ${i + 1}` : `${s.winner} reached goal in round ${i + 1}`;
  }
  const rollout = { scenarioId: `${id}-S${++n}`, rows, maxConsecutiveTurnsLost: maxStreak, finished };
  const cost = effectCost(rule.effect) * rule.cells.length;

  const engineChecks: Trial['engineChecks'] = [];
  const add = (cid: string, text: string, pass: boolean, detail: string) => engineChecks.push({ id: cid, text, pass, detail });
  const kinds = new Set(triggers.filter(r => r.fired).map(r => r.effectSeen));
  const firedBy = new Set(triggers.filter(r => r.fired).map(r => r.player));
  add('E1', 'Same effect for both players', triggers.length === 0 || (kinds.size === 1 && firedBy.size === 2), `fired for: ${[...firedBy].join(', ') || 'nobody'}; effects seen: ${[...kinds].join(', ') || 'none'}`);
  add('E2', 'Each square fires at most once', triggers.every(r => !r.secondVisitFired), triggers.filter(r => r.secondVisitFired).map(r => r.scenarioId).join(', ') || 'no re-fires');
  add('E3', 'No chain longer than 3', chains.every(c => c.length <= 3), chains.map(c => `${c.scenarioId}:${c.length}`).join(', ') || 'no chains');
  add('E4', 'No player loses 2+ turns in a row', maxStreak.human < 2 && maxStreak.ai < 2, `max streak human ${maxStreak.human}, ai ${maxStreak.ai}`);
  add('E5', 'Both players always have a legal move', rows.every(r => (r.humanSkipping || r.humanLegalMoves > 0) && (r.aiSkipping || r.aiLegalMoves > 0)), 'checked over rollout');
  add('E6', 'Within power budget', cost <= RULE_BUDGET, `cost ${cost} / budget ${RULE_BUDGET}`);

  const sigData = { proposer, effect: rule.effect, cells: [...rule.cells].sort(), pos: state.positions, rules: state.rules.human.concat(state.rules.ai).map(r => [r.owner, r.effect, r.cells]) };
  const signature = createHash('sha256').update(JSON.stringify(sigData)).digest('hex').slice(0, 16);
  return {
    trialId: id, signature, proposer, ruleText: rule.text, effect: rule.effect, effectLabel: shortLabel(rule.effect), effectSummary: describeEffect(rule.effect),
    cells: rule.cells.map(cellName), cost, budget: RULE_BUDGET,
    existingRules: state.rules.human.concat(state.rules.ai).map(r => ({ owner: r.owner, label: r.label, squares: r.cells.map(cellName) })),
    positions: { human: cellName(key(state.positions.human.x, state.positions.human.y)), ai: cellName(key(state.positions.ai.x, state.positions.ai.y)) },
    triggers, chains, rollout, engineChecks, createdAt: new Date().toISOString(), buildMs: Math.round(performance.now() - t0),
  };
}

const esc = (s: unknown) => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

/** Static, script-free page that Kane inspects. Shows raw observations, not the engine's verdict. */
export function renderTrialPage(t: Trial): string {
  const yes = (b: boolean) => (b ? 'yes' : 'no');
  const trig = t.triggers.map(r => `<tr data-scenario="${r.scenarioId}"><td>${r.scenarioId}</td><td>${r.player === 'human' ? 'Human' : 'AI'}</td><td>${r.enteredFrom} → ${r.trapSquare}</td><td>${yes(r.fired)}</td><td>${esc(r.effectSeen)}</td><td>${r.endSquare}</td><td>${r.columnsTowardOwnGoal}</td><td>${r.turnsLost}</td><td>${esc(r.statusAfter)}</td><td>${r.chainLength}</td><td>${r.secondVisitFired ? 'FIRED AGAIN' : 'did not fire'}</td></tr>`).join('');
  const roll = t.rollout.rows.map(r => `<tr><td>${r.round}</td><td>${r.human}</td><td>${r.humanSkipping ? 'skipping' : r.humanLegalMoves}</td><td>${r.ai}</td><td>${r.aiSkipping ? 'skipping' : r.aiLegalMoves}</td></tr>`).join('');
  const chains = t.chains.length ? t.chains.map(c => `<li>${c.scenarioId}: ${c.player === 'human' ? 'Human' : 'AI'} set off ${c.length} traps in a row (${c.squares.join(' → ')})</li>`).join('') : '<li>No chain reactions in these scenarios.</li>';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Rule trial ${t.trialId}</title>
<style>body{font:15px/1.5 system-ui,sans-serif;margin:24px;max-width:1000px;color:#111}table{border-collapse:collapse;margin:8px 0 18px}td,th{border:1px solid #999;padding:4px 8px;text-align:left}th{background:#eee}h2{margin-top:22px}code{background:#f3f3f3;padding:1px 4px}</style></head><body>
<h1>Rule Sabotage referee trial <span id="trial-id">${t.trialId}</span></h1>
<p>Proposed by: <strong id="proposer">${t.proposer === 'human' ? 'Human' : 'AI'}</strong>. Rule text: <q id="rule-text">${esc(t.ruleText)}</q></p>
<p>Engine interpretation: <strong>${esc(t.effectLabel)}</strong>. ${esc(t.effectSummary)} Squares: ${t.cells.join(', ')}.</p>
<h2>Power</h2><p id="power">Power cost: <strong>${t.cost}</strong>. Budget: <strong>${t.budget}</strong>.</p>
<h2>Board before the rule</h2><p>Human at ${t.positions.human}, AI at ${t.positions.ai}. Existing traps: ${t.existingRules.length ? t.existingRules.map(r => `${r.owner === 'human' ? 'Human' : 'AI'} “${esc(r.label)}” on ${r.squares.join(' ')}`).join('; ') : 'none'}.</p>
<h2>Symmetry: each player steps on the same trap square</h2>
<table id="symmetry"><tr><th>Scenario</th><th>Player</th><th>Step</th><th>Trap fired</th><th>Effect</th><th>Ended on</th><th>Columns gained toward own goal (vs normal step)</th><th>Turns lost</th><th>Status after</th><th>Traps fired in this step</th><th>Second visit to same square</th></tr>${trig || '<tr><td colspan="11">No reachable trap square.</td></tr>'}</table>
<h2>Chain reactions</h2><ul id="chains">${chains}</ul>
<h2>Softlock rollout (${t.rollout.scenarioId}): both players race for up to 8 rounds</h2>
<table id="rollout"><tr><th>Round</th><th>Human square</th><th>Human legal moves</th><th>AI square</th><th>AI legal moves</th></tr>${roll}</table>
<p id="rollout-summary">Result: ${esc(t.rollout.finished)}. Longest run of lost turns: Human ${t.rollout.maxConsecutiveTurnsLost.human}, AI ${t.rollout.maxConsecutiveTurnsLost.ai}.</p>
</body></html>`;
}

/** The fixed conditions Kane judges. Identical for human- and AI-authored rules. */
export const KANE_CONDITIONS = [
  "In the 'Symmetry' table, the trap fired for both the Human row and the AI row, and both rows show the same effect name.",
  "In the 'Symmetry' table, every value in the 'Second visit to same square' column is 'did not fire'.",
  "No player in the 'Symmetry' table or the softlock rollout loses more than 1 turn in a row.",
  "In the softlock rollout table, every round shows either 'skipping' or at least 1 legal move for both the Human and the AI.",
  "The 'Chain reactions' section lists no chain longer than 3 traps.",
  "The power cost shown in the 'Power' section is less than or equal to the budget shown there.",
  "Taken as a whole, nothing on this page shows the rule permanently trapping a player or deciding the game by itself.",
];
