/**
 * GameWatch adapter for Rule Sabotage V6.1 (EXPERIMENTAL, QA demonstration only).
 *
 * Turns REAL executions of a materialized build (gamewatch/builds.ts) into the game-independent GameWatch evidence
 * format (gamewatch/evidence.ts). Nothing here simulates the game: every step is a call into the build's own engine and
 * referee (refereeV6 for every placement, applyMove for every move, endTurn for every turn end), and every event is the
 * event list the engine returned. Refused placements and refused moves are recorded as refused, never skipped silently.
 */
import type { GWState, GWEvent, GWStep, GWCase, GWMatch, GWTurnRow } from '../evidence.ts';
import { loadBuild } from '../builds.ts';
import { canonicalRuleText, type Effect, type Player } from '../../server/rules.ts';
import { loadWeights } from '../../server/weights.ts';

type B = Awaited<ReturnType<typeof loadBuild>>;
type S = import('../../server/v6/engine.ts').State;
type E = import('../../server/v6/engine.ts').GameEvent;

const SIDE: Record<Player, 'Human' | 'AI'> = { human: 'Human', ai: 'AI' };

export function snapshot(b: B, s: S): GWState {
  const n = b.engine.cellName;
  return {
    turn: s.turn, toMove: SIDE[s.current], actionsLeft: s.actionsLeft, phase: s.phase,
    pieces: s.pieces.map(q => ({ id: q.id, side: SIDE[q.owner], square: q.scored ? 'scored' : n(b.engine.key(q.x, q.y)), frozenTurns: q.frozen, shield: q.shield })),
    effects: Object.entries(s.cells).map(([k, id]) => { const r = b.engine.ruleById(s, id)!; return { square: n(k), owner: SIDE[r.owner], effect: r.label, effectId: r.id }; }).sort((a, c) => a.square.localeCompare(c.square)),
    winner: s.winner ? (s.winner === 'draw' ? 'draw' : SIDE[s.winner]) : null,
  };
}

export function events(b: B, ev: E[]): GWEvent[] {
  const n = (k: string) => (k.includes('|') ? k.split('|').map(b.engine.cellName).join('|') : b.engine.cellName(k));
  return ev.map((e): GWEvent => {
    switch (e.t) {
      case 'turn': return { type: 'turn-start', side: SIDE[e.p], actionsGranted: e.actions, turn: e.turn };
      case 'remove': return { type: 'effect-removed', side: SIDE[e.p], squares: e.cells.map(n) };
      case 'place': return { type: 'effect-placed', side: SIDE[e.p], effectId: e.ruleId, effect: e.label, squares: e.cells.map(n), replaced: e.replaced.map(n) };
      case 'move': return { type: 'move', side: SIDE[e.p], pieces: e.pieces, from: n(e.from), to: n(e.to), dir: e.dir };
      case 'trigger': return { type: 'effect-fired', side: SIDE[e.p], effectOwner: SIDE[e.owner], pieces: e.pieces, effectId: e.ruleId, effect: e.label, square: n(e.cell), chainDepth: e.chain };
      case 'shielded': return { type: 'shield-absorbed', pieces: e.pieces, square: n(e.cell) };
      case 'forced': return { type: 'forced-move', pieces: e.pieces, from: n(e.from), to: n(e.to), how: e.how };
      case 'status': return { type: 'status', pieces: e.pieces, status: e.status };
      case 'haste': return { type: 'extra-action', side: SIDE[e.p], thisTurn: e.now };
      case 'capture': return { type: 'capture', side: SIDE[e.by], pieces: e.pieces, square: n(e.cell) };
      case 'stack': return { type: 'stack', side: SIDE[e.p], pieces: e.pieces, square: n(e.cell) };
      case 'score': return { type: 'score', side: SIDE[e.p], pieces: e.pieces, square: n(e.cell), total: e.total };
      case 'chain-limit': return { type: 'chain-limit', square: n(e.cell) };
      case 'end': return { type: 'turn-end', side: SIDE[e.p] };
      case 'win': return { type: 'game-over', winner: e.winner === 'draw' ? 'draw' : SIDE[e.winner], reason: e.reason };
    }
  });
}

/** A scripted playtest: both sides' actions are fixed in advance; the engine and referee decide every outcome. */
export type ScriptTurn = { side: Player; place?: { effect: Effect; squares: string[] }; moves?: [string, 'up' | 'down' | 'left' | 'right'][] };
export type Script = { id: string; title: string; seed: number; first: Player; turns: ScriptTurn[] };

const sq = (b: B, name: string) => { const x = b.engine.COLS.indexOf(name[0]), y = Number(name.slice(1)) - 1; return b.engine.key(x, y); };

export async function runScript(b: B, script: Script, caseId: string, buildLabel: string): Promise<GWCase> {
  const s = b.engine.init(script.seed, { first: script.first, ruleset: b.engine.RULESET_V61 });
  const steps: GWStep[] = [];
  const push = (actor: 'Human' | 'AI', action: string, before: GWState, ev: E[], outcome: GWStep['outcome'], note?: string) =>
    steps.push({ n: steps.length + 1, actor, action, outcome, ...(note ? { note } : {}), before, after: snapshot(b, s), events: events(b, ev) });
  steps.push({ n: 0, actor: 'system', action: 'start of game', outcome: 'ok', before: snapshot(b, s), after: snapshot(b, s), events: events(b, [{ t: 'turn', p: s.current, actions: s.actionsLeft, turn: s.turn }]) });
  for (const t of script.turns) {
    if (s.winner) break;
    if (s.current !== t.side) throw new Error(`script ${script.id}: expected ${t.side} to move on turn ${s.turn}`);
    const actor = SIDE[t.side];
    if (t.place) {
      const before = snapshot(b, s);
      const pl = { text: canonicalRuleText(t.place.effect), effect: t.place.effect, cells: t.place.squares.map(x => sq(b, x)), interpretedBy: 'scripted playtest' };
      const r = b.turn.refereeV6(s, t.side, pl, { keepTrial: false });
      push(actor, `place "${r.verdict.label}" on ${t.place.squares.join(', ')}`, before, r.events, r.verdict.activated ? 'ok' : 'refused', `referee: ${r.verdict.final}${r.verdict.tier ? ` (tier ${r.verdict.tier})` : ''}. ${r.verdict.message}`);
    }
    if (s.phase === 'place') s.phase = 'move';
    for (const [from, dir] of t.moves ?? []) {
      if (s.winner) break;
      const before = snapshot(b, s);
      const m = { from: sq(b, from), dir, mode: 'stack' as const };
      const v = b.engine.validateMove(s, t.side, m);
      if (!v.ok) { push(actor, `move ${from} ${dir}`, before, [], 'refused', `engine: ${v.reason}`); continue; }
      push(actor, `move ${from} ${dir}`, before, b.engine.applyMove(s, t.side, m), 'ok');
    }
    if (!s.winner) { const before = snapshot(b, s); push(actor, 'end turn', before, b.engine.endTurn(s), 'ok'); }
  }
  return { caseId, kind: 'scripted', build: buildLabel, title: script.title, seed: script.seed, firstMover: SIDE[script.first], steps };
}

/** One AI-vs-AI game with the existing forked V6 policies, both sides through the shared referee and executor. */
export async function runSelfPlay(b: B, seed: number, first: Player, policy: 'ev-k1.2' | 'softmax-v2' | 'oa-v3', matchId: string, buildLabel: string): Promise<GWMatch> {
  const w = loadWeights();
  const s = b.engine.init(seed, { first, ruleset: b.engine.RULESET_V61 });
  const rows: GWTurnRow[] = [];
  const t0 = performance.now();
  while (!s.winner) {
    const p = s.current, turn = s.turn, granted = s.actionsLeft, onBoard = s.pieces.filter(q => q.owner === p && !q.scored).length;
    const r = await b.turn.aiTurnV6(s, p, policy, w);
    rows.push({
      turn, side: SIDE[p], piecesOnBoard: onBoard, actionsGranted: granted, movesMade: r.moves.length,
      placement: r.verdict ? { effect: r.verdict.label, squares: r.verdict.cells, result: r.verdict.final } : null,
      events: events(b, [...r.events, ...r.endEvents.filter(e => e.t !== 'turn')]),
    });
    if (r.error && r.zeroMoves?.kind === 'planner-error' && rows.filter(x => x.movesMade === 0).length > 6) throw new Error(`planner errors: ${r.error}`);
  }
  const sc = (p: Player) => s.pieces.filter(q => q.owner === p && q.scored).length;
  return {
    matchId, build: buildLabel, seed, policy: { Human: policy, AI: policy }, firstMover: SIDE[first],
    winner: s.winner === 'draw' ? 'draw' : SIDE[s.winner!], reason: s.winReason, turns: s.turn,
    scored: { Human: sc('human'), AI: sc('ai') }, ms: Math.round(performance.now() - t0), rows,
  };
}
