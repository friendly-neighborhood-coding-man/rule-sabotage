/**
 * Sandboxed rule trial. Copies the current game, applies ONE proposed placement in the copy,
 * and runs bounded what-if scenarios with the real engine:
 *   symmetry   a lone Human piece and a lone AI piece enter each new cell from the same
 *              neighbour in the same direction; the outcome must be identical
 *   revisit    the same piece steps off and back on: the burnt cell must not fire again
 *   chains     forced movement that sets off further effects (engine cap MAX_CHAIN)
 *   rollout    both players play greedy turns for up to 10 turns on the hypothetical board
 * The result is plain data (rendered as a static page for Kane) plus deterministic engine checks.
 */
import { createHash } from 'node:crypto';
import {
  type State, type Placement, type GameEvent, type Dir, type Piece, key, parseKey, inside, cellName, DIRS, MAX_CHAIN,
  applyPlacement, applyMove, endTurn, legalMoves, validatePlacement, onBoard, ruleAt,
} from './engine.ts';
import { type Player, type Effect, PLAYERS, shortLabel, describeEffect, MAX_CELLS_PER_TURN } from './rules.ts';
import { planMoves } from './ai.ts';

export type Outcome = { fired: boolean; effectSeen: string; endSquare: string; reachedGoal: boolean; frozenTurns: number; shield: boolean; extraActions: number; chain: string[] };
export type SymmetryRow = { scenarioId: string; cell: string; enteredFrom: string; dir: Dir; human: Outcome; ai: Outcome; identical: boolean; secondVisitFired: { human: boolean; ai: boolean } };
export type RolloutRow = { turn: number; player: Player; legalMoves: number; piecesOnBoard: number; frozenPieces: number; movesMade: number; scored: Record<Player, number> };
export type Trial = {
  trialId: string; signature: string; proposer: Player; ruleText: string; effect: Effect; effectLabel: string; effectSummary: string;
  cells: string[]; maxCells: number; existingEffects: { owner: Player; label: string; squares: string[] }[];
  pieces: Record<Player, string[]>; symmetry: SymmetryRow[]; chains: { scenarioId: string; player: Player; length: number; squares: string[] }[];
  rollout: { scenarioId: string; rows: RolloutRow[]; longestStuck: Record<Player, number>; finished: string };
  engineChecks: { id: string; text: string; pass: boolean; detail: string }[]; scenarioIds: string[];
  createdAt: string; buildMs: number;
};

const pieceText = (q: Piece) => (q.scored ? 'scored' : cellName(key(q.x, q.y)) + (q.frozen ? ' (frozen)' : ''));

/** The board as it would be if the placement were accepted. */
export function withPlacement(s: State, proposer: Player, pl: Placement): State {
  const h = structuredClone(s);
  h.current = proposer; h.phase = 'place'; h.winner = null;
  applyPlacement(h, proposer, pl);
  return h;
}

/** A neighbour to enter `cell` from, chosen without regard to who enters. */
function approach(h: State, cell: string): { from: string; dir: Dir } | null {
  const c = parseKey(cell);
  const tries: [number, number, Dir][] = [[-1, 0, 'right'], [1, 0, 'left'], [0, -1, 'down'], [0, 1, 'up']];
  for (const [dx, dy, dir] of tries) {
    const fx = c.x + dx, fy = c.y + dy;
    if (inside(fx, fy) && !ruleAt(h, key(fx, fy))) return { from: key(fx, fy), dir };
  }
  return null;
}

/** One lone piece of `p` enters `cell`; every other piece is parked so captures cannot differ by owner. */
export function enter(h: State, p: Player, from: string, dir: Dir, ruleId: number, cell: string): { out: Outcome; secondVisitFired: boolean } {
  const s = structuredClone(h);
  s.winner = null; s.current = p; s.phase = 'move'; s.actionsLeft = 5; s.bonus = { human: 0, ai: 0 };
  const f = parseKey(from);
  let tester: Piece | null = null;
  for (const q of s.pieces) {
    if (!tester && q.owner === p) { tester = q; q.scored = false; q.x = f.x; q.y = f.y; q.frozen = 0; q.shield = false; }
    else q.scored = true; // parked
  }
  const ev = applyMove(s, p, { from, dir, mode: 'single' });
  const trig = ev.filter((e): e is Extract<GameEvent, { t: 'trigger' }> => e.t === 'trigger');
  const mine = trig.find(e => e.ruleId === ruleId && e.cell === cell);
  const q = tester!;
  const home = q.x === q.home.x && q.y === q.home.y && mine?.kind === 'home';
  const out: Outcome = {
    fired: Boolean(mine), effectSeen: mine ? mine.label : 'none', endSquare: home ? 'own start square' : cellName(key(q.x, q.y)),
    reachedGoal: q.scored, frozenTurns: q.frozen, shield: q.shield, extraActions: s.actionsLeft - 4, chain: trig.map(e => cellName(e.cell)),
  };
  // Second visit: put the piece back next to the cell and enter again.
  const s2 = structuredClone(s);
  s2.winner = null; s2.current = p; s2.phase = 'move'; s2.actionsLeft = 2;
  const q2 = s2.pieces.find(x => x.id === q.id)!;
  q2.scored = false; q2.x = f.x; q2.y = f.y; q2.frozen = 0; q2.shield = false;
  let secondVisitFired = false;
  try { secondVisitFired = applyMove(s2, p, { from, dir, mode: 'single' }).some(e => e.t === 'trigger' && e.ruleId === ruleId && e.cell === cell); } catch { /* not reachable */ }
  return { out, secondVisitFired };
}

/** A piece that reaches its own goal column leaves the board, so its status no longer matters: compare it only when neither did. */
export const sameOutcome = (a: Outcome, b: Outcome) => {
  const core = (o: Outcome) => JSON.stringify([o.fired, o.effectSeen, o.endSquare, o.extraActions, o.chain]);
  return core(a) === core(b) && (a.reachedGoal || b.reachedGoal || (a.frozenTurns === b.frozenTurns && a.shield === b.shield));
};

export function buildTrial(state: State, proposer: Player, pl: Placement, trialNo: number): Trial {
  const t0 = performance.now();
  const id = `T${String(trialNo).padStart(4, '0')}`;
  const legal = validatePlacement({ ...structuredClone(state), current: proposer, phase: 'place', winner: null }, proposer, pl);
  const h = legal.ok ? withPlacement(state, proposer, pl) : structuredClone(state);
  const rule = legal.ok ? h.rules[h.rules.length - 1] : null;
  const symmetry: SymmetryRow[] = [], chains: Trial['chains'] = [];
  let n = 0;
  if (rule) for (const cell of rule.cells) {
    const ap = approach(h, cell);
    if (!ap) continue;
    const sid = `${id}-S${++n}`;
    const hu = enter(h, 'human', ap.from, ap.dir, rule.id, cell), ai = enter(h, 'ai', ap.from, ap.dir, rule.id, cell);
    symmetry.push({ scenarioId: sid, cell: cellName(cell), enteredFrom: cellName(ap.from), dir: ap.dir, human: hu.out, ai: ai.out, identical: sameOutcome(hu.out, ai.out), secondVisitFired: { human: hu.secondVisitFired, ai: ai.secondVisitFired } });
    for (const [p, o] of [['human', hu.out], ['ai', ai.out]] as [Player, Outcome][]) if (o.chain.length > 1) chains.push({ scenarioId: sid, player: p, length: o.chain.length, squares: o.chain });
  }

  // Rollout: both players play greedy turns on the hypothetical board.
  const s = structuredClone(h); s.winner = null; s.phase = 'move';
  if (s.current !== proposer) { s.current = proposer; }
  const rows: RolloutRow[] = [];
  const stuck = { human: 0, ai: 0 }, longestStuck = { human: 0, ai: 0 };
  let finished = 'still running after 10 turns';
  for (let i = 0; i < 10 && !s.winner; i++) {
    const p = s.current;
    const lm = legalMoves(s, p).length, on = onBoard(s, p);
    let made = 0;
    for (const m of planMoves(s, p).moves) { if (s.winner) break; applyMove(s, p, m); made++; }
    rows.push({ turn: i + 1, player: p, legalMoves: lm, piecesOnBoard: on.length, frozenPieces: on.filter(q => q.frozen > 0).length, movesMade: made, scored: { human: s.pieces.filter(q => q.owner === 'human' && q.scored).length, ai: s.pieces.filter(q => q.owner === 'ai' && q.scored).length } });
    if (on.length && lm === 0) { stuck[p]++; longestStuck[p] = Math.max(longestStuck[p], stuck[p]); } else stuck[p] = 0;
    if (s.winner) { finished = s.winner === 'draw' ? `draw on turn ${i + 1}` : `${s.winner === 'human' ? 'Human' : 'AI'} won on turn ${i + 1}`; break; }
    endTurn(s);
    if (s.winner) finished = `turn limit reached on turn ${i + 1}`;
  }
  const rollout = { scenarioId: `${id}-S${++n}`, rows, longestStuck, finished };

  const engineChecks: Trial['engineChecks'] = [];
  const add = (cid: string, text: string, pass: boolean, detail: string) => engineChecks.push({ id: cid, text, pass, detail });
  add('E1', 'Placement is legal (1 to 3 eligible cells, own or empty)', legal.ok, legal.ok ? `${pl.cells.length} cell(s)` : legal.reason);
  add('E2', 'Identical outcome for a Human piece and an AI piece', symmetry.every(r => r.identical && r.human.fired && r.ai.fired), symmetry.filter(r => !r.identical || !r.human.fired || !r.ai.fired).map(r => r.scenarioId).join(', ') || `${symmetry.length} pair(s) identical`);
  add('E3', 'Each cell fires at most once', symmetry.every(r => !r.secondVisitFired.human && !r.secondVisitFired.ai), symmetry.filter(r => r.secondVisitFired.human || r.secondVisitFired.ai).map(r => r.scenarioId).join(', ') || 'no re-fires');
  add('E4', `Chain reactions stay within the engine cap of ${MAX_CHAIN}`, chains.every(c => c.length <= MAX_CHAIN), chains.map(c => `${c.scenarioId}:${c.length}`).join(', ') || 'no chains');
  add('E5', 'No player is left with no legal move for 2 of their turns in a row', longestStuck.human < 2 && longestStuck.ai < 2, `longest stuck streak: Human ${longestStuck.human}, AI ${longestStuck.ai}`);
  add('E6', 'Placing the effect moves no piece and decides nothing', h.winner === null && JSON.stringify(h.pieces) === JSON.stringify(state.pieces), 'pieces unchanged at placement');

  // Everything the trial's observations depend on: the proposal, every piece, every live effect with its OWNER,
  // the RNG state (teleport destinations), the turn (turn limit) and banked actions.
  const sigData = {
    proposer, text: pl.text, effect: pl.effect, approx: pl.approxNote ?? null, cells: [...pl.cells].sort(), rng: state.rng, turn: state.turn, maxTurns: state.maxTurns, bonus: state.bonus,
    pieces: state.pieces.map(q => [q.id, q.x, q.y, q.scored, q.frozen, q.shield]), cells2: state.cells, rules: state.rules.filter(r => r.cells.length).map(r => [r.id, r.owner, r.effect, [...r.cells].sort()]),
  };
  const signature = createHash('sha256').update(JSON.stringify(sigData)).digest('hex').slice(0, 16);
  return {
    trialId: id, signature, proposer, ruleText: pl.text, effect: pl.effect, effectLabel: shortLabel(pl.effect), effectSummary: describeEffect(pl.effect),
    cells: pl.cells.map(cellName), maxCells: MAX_CELLS_PER_TURN,
    existingEffects: state.rules.filter(r => r.cells.length).map(r => ({ owner: r.owner, label: r.label, squares: r.cells.map(cellName) })),
    pieces: { human: state.pieces.filter(q => q.owner === 'human').map(pieceText), ai: state.pieces.filter(q => q.owner === 'ai').map(pieceText) },
    symmetry, chains, rollout, engineChecks, scenarioIds: [...symmetry.map(r => r.scenarioId), rollout.scenarioId], createdAt: new Date().toISOString(), buildMs: Math.round(performance.now() - t0),
  };
}

const esc = (s: unknown) => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const outcomeCells = (o: Outcome) => `<td>${o.fired ? 'yes' : 'no'}</td><td>${esc(o.effectSeen)}</td><td>${esc(o.endSquare)}</td><td>${o.extraActions}</td><td>${o.chain.length}</td><td>${o.reachedGoal ? 'n/a (reached its goal)' : o.frozenTurns}</td><td>${o.reachedGoal ? 'n/a (reached its goal)' : o.shield ? 'yes' : 'no'}</td>`;

/** Static, script-free page that Kane inspects. Shows raw observations; the engine's own verdict is not on it. */
export function renderTrialPage(t: Trial): string {
  const sym = t.symmetry.map(r => `<tr data-scenario="${r.scenarioId}"><td rowspan="2">${r.scenarioId}</td><td rowspan="2">${r.enteredFrom} → ${r.cell}</td><td>Human piece</td>${outcomeCells(r.human)}<td>${r.secondVisitFired.human ? 'FIRED AGAIN' : 'did not fire'}</td></tr><tr><td>AI piece</td>${outcomeCells(r.ai)}<td>${r.secondVisitFired.ai ? 'FIRED AGAIN' : 'did not fire'}</td></tr>`).join('');
  const roll = t.rollout.rows.map(r => `<tr><td>${r.turn}</td><td>${r.player === 'human' ? 'Human' : 'AI'}</td><td>${r.piecesOnBoard}</td><td>${r.frozenPieces}</td><td>${r.legalMoves}</td><td>${r.movesMade}</td><td>${r.scored.human}–${r.scored.ai}</td></tr>`).join('');
  const chains = t.chains.length ? t.chains.map(c => `<li>${c.scenarioId}: ${c.player === 'human' ? 'Human' : 'AI'} piece set off ${c.length} effects in a row (${c.squares.join(' → ')})</li>`).join('') : '<li>No chain reactions in these scenarios.</li>';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Rule trial ${t.trialId}</title>
<style>body{font:15px/1.5 system-ui,sans-serif;margin:24px;max-width:1050px;color:#111}table{border-collapse:collapse;margin:8px 0 18px}td,th{border:1px solid #999;padding:4px 8px;text-align:left}th{background:#eee}h2{margin-top:22px}</style></head><body>
<h1>Rule Sabotage referee trial <span id="trial-id">${t.trialId}</span></h1>
<p>Proposed by: <strong id="proposer">${t.proposer === 'human' ? 'Human' : 'AI'}</strong>. Rule text: <q id="rule-text">${esc(t.ruleText)}</q></p>
<p>Engine interpretation: <strong>${esc(t.effectLabel)}</strong>. ${esc(t.effectSummary)}</p>
<h2>Placement</h2><p id="placement">Cells chosen: <strong>${t.cells.length}</strong> (${t.cells.join(', ')}). Limit per turn: <strong>${t.maxCells}</strong>.</p>
<h2>Board before the rule</h2><p>Human pieces: ${t.pieces.human.join(', ')}. AI pieces: ${t.pieces.ai.join(', ')}.</p>
<p>Effects already on the board: ${t.existingEffects.length ? t.existingEffects.map(r => `${r.owner === 'human' ? 'Human' : 'AI'} “${esc(r.label)}” on ${r.squares.join(' ')}`).join('; ') : 'none'}.</p>
<h2>Symmetry: a lone Human piece and a lone AI piece enter the same cell the same way</h2>
<table id="symmetry"><tr><th>Scenario</th><th>Step</th><th>Piece</th><th>Effect fired</th><th>Effect</th><th>Ended on</th><th>Extra actions</th><th>Effects fired in this step</th><th>Frozen turns</th><th>Shield</th><th>Second visit to same cell</th></tr>${sym || '<tr><td colspan="11">No reachable cell.</td></tr>'}</table>
<h2>Chain reactions</h2><ul id="chains">${chains}</ul>
<h2>Softlock rollout (${t.rollout.scenarioId}): both players play up to 10 turns</h2>
<table id="rollout"><tr><th>Turn</th><th>Player</th><th>Pieces on board</th><th>Frozen pieces</th><th>Legal moves</th><th>Moves made</th><th>Scored (Human–AI)</th></tr>${roll}</table>
<p id="rollout-summary">Result: ${esc(t.rollout.finished)}. Longest run of own turns with pieces on the board but no legal move: Human ${t.rollout.longestStuck.human}, AI ${t.rollout.longestStuck.ai}.</p>
</body></html>`;
}

/** The fixed conditions Kane judges. Identical for human- and AI-authored rules. */
export const KANE_CONDITIONS = [
  "In the 'Symmetry' table, for every scenario the Human piece row and the AI piece row show the same values in every column from 'Effect fired' to 'Effects fired in this step' and 'Effect fired' is 'yes'; the 'Frozen turns' and 'Shield' values also match unless one of the two rows says 'n/a (reached its goal)'.",
  "In the 'Symmetry' table, every value in the 'Second visit to same cell' column is 'did not fire'.",
  "The 'Chain reactions' section lists no chain longer than 4 effects.",
  "In the softlock rollout, no player has 2 of their own turns in a row with pieces on the board but 0 legal moves.",
  "The number of cells chosen in the 'Placement' section is less than or equal to the limit per turn shown there.",
  "Taken as a whole, nothing on this page shows the rule permanently trapping a player, targeting only one player, or deciding the game by itself.",
];
export { PLAYERS };
