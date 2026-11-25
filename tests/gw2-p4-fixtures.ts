/**
 * GW2 P4 SYNTHETIC mutation-sanity fixtures. Hand-written observation records (gamewatch/evidence@1 shapes) that
 * transcribe the SETUPS of the private probes (gamewatch/private/probes.ts: probeShield, probeChain, probeActions,
 * controlWalk) and write the OUTCOMES each single-defect build is documented to produce (gamewatch/private/mutations.json
 * "intendedViolation"; clean = the documented rules). They are NOT engine observations: no engine was run to make
 * them, and P4 generates no new engine observations. They test that the verifier detects each documented defect and
 * nothing else; recorded single-defect observations are a P5 question.
 */
import type { GWState, GWEvent, GWStep } from '../gamewatch/evidence.ts';

type Side = 'Human' | 'AI';
const START: Record<string, string> = { h1: 'A3', h2: 'A5', h3: 'A7', a1: 'M3', a2: 'M5', a3: 'M7' };
const pieces = (over: Record<string, { square?: string; shield?: boolean }> = {}) => Object.keys(START).map(id => ({ id, side: id[0] === 'h' ? 'Human' : 'AI', square: over[id]?.square ?? START[id], frozenTurns: 0, shield: over[id]?.shield ?? false }));
const state = (p: ReturnType<typeof pieces>, effects: GWState['effects'], turn = 1, toMove: Side = 'Human'): GWState => ({ turn, toMove, actionsLeft: 3, phase: 'move', winner: null, pieces: p, effects });
const step = (n: number, actor: string, before: GWState, after: GWState, events: GWEvent[]): GWStep => ({ n, actor, action: 'scripted', outcome: 'ok', before, after, events });
export type Defect = 'clean' | 'B1' | 'B2' | 'B3';

/** probeShield: a shielded piece of `side` walks onto an enemy "Send home" cell. */
function shield(side: Side, d: Defect) {
  const id = side === 'Human' ? 'h1' : 'a1', from = side === 'Human' ? 'E4' : 'I4', to = side === 'Human' ? 'F4' : 'H4', enemy: Side = side === 'Human' ? 'AI' : 'Human';
  const before = state(pieces({ [id]: { square: from, shield: true } }), [{ square: to, owner: enemy, effect: 'Send home', effectId: 1 }], 1, side);
  const hit = d === 'B1' && side === 'Human'; // B1: a shielded HUMAN piece is not protected; the shield is used up silently
  const events: GWEvent[] = [{ type: 'move', side, pieces: [id], from, to, dir: side === 'Human' ? 'right' : 'left' },
    ...(hit ? [{ type: 'effect-fired', side, effectOwner: enemy, pieces: [id], effectId: 1, effect: 'Send home', square: to, chainDepth: 1 }, { type: 'forced-move', pieces: [id], from: to, to: START[id], how: 'home' }] : [{ type: 'shield-absorbed', pieces: [id], square: to }])];
  const after = state(pieces({ [id]: { square: hit ? START[id] : to, shield: false } }), [], 1, side);
  return { caseId: `syn-shield-${side}-${d}`, kind: 'scripted' as const, build: d, firstMover: side, steps: [step(1, side, before, after, events)] };
}
/** probeChain: own "Shove 2" pushes the piece onto an own "+1 action" cell (a forced arrival). */
function chain(side: Side, d: Defect) {
  const id = side === 'Human' ? 'h1' : 'a1', [x0, x1, x3] = side === 'Human' ? ['C4', 'D4', 'F4'] : ['K4', 'J4', 'H4'];
  const fx = [{ square: x1, owner: side, effect: side === 'Human' ? 'Shove east 2' : 'Shove west 2', effectId: 1 }, { square: x3, owner: side, effect: '+1 action', effectId: 2 }];
  const before = state(pieces({ [id]: { square: x0 } }), fx, 1, side);
  const events: GWEvent[] = [{ type: 'move', side, pieces: [id], from: x0, to: x1, dir: side === 'Human' ? 'right' : 'left' },
    { type: 'effect-fired', side, effectOwner: side, pieces: [id], effectId: 1, effect: fx[0].effect, square: x1, chainDepth: 1 },
    { type: 'forced-move', pieces: [id], from: x1, to: x3, how: 'shove' },
    { type: 'effect-fired', side, effectOwner: side, pieces: [id], effectId: 2, effect: '+1 action', square: x3, chainDepth: 2 },
    { type: 'extra-action', side, thisTurn: true }];
  const after = state(pieces({ [id]: { square: x3 } }), d === 'B2' ? [fx[1]] : [], 1, side); // B2: a forced arrival does not use the cell up
  return { caseId: `syn-chain-${side}-${d}`, kind: 'scripted' as const, build: d, firstMover: side, steps: [step(1, side, before, after, events)] };
}
/** controlWalk + a two-cell effect: walking onto one cell uses it up; the effect's other cell stays. */
function walk(side: Side, d: Defect) {
  const id = side === 'Human' ? 'h2' : 'a2', [from, to, other] = side === 'Human' ? ['C5', 'D5', 'D7'] : ['K5', 'J5', 'J7'];
  const fx = [{ square: to, owner: side, effect: 'Freeze', effectId: 3 }, { square: other, owner: side, effect: 'Freeze', effectId: 3 }];
  const before = state(pieces({ [id]: { square: from } }), fx, 1, side);
  const events: GWEvent[] = [{ type: 'move', side, pieces: [id], from, to, dir: side === 'Human' ? 'right' : 'left' }, { type: 'effect-fired', side, effectOwner: side, pieces: [id], effectId: 3, effect: 'Freeze', square: to, chainDepth: 1 }];
  return { caseId: `syn-walk-${side}-${d}`, kind: 'scripted' as const, build: d, firstMover: side, steps: [step(1, side, before, state(pieces({ [id]: { square: to } }), [fx[1]], 1, side), events)] };
}
/** probeActions: actions granted at the first 6 turn starts, all pieces on the board, no earned extras. */
function actions(first: Side, d: Defect) {
  const other: Side = first === 'Human' ? 'AI' : 'Human', s = state(pieces(), []);
  const steps = Array.from({ length: 6 }, (_, i) => {
    const side = i % 2 ? other : first, turn = i + 1;
    return step(i, 'system', s, { ...s, turn, toMove: side }, [{ type: 'turn-start', side, actionsGranted: 3 + (d === 'B3' && turn % 2 === 1 ? 1 : 0), turn }]); // B3: odd turns get one more
  });
  return { caseId: `syn-actions-${first}-${d}`, kind: 'scripted' as const, build: d, firstMover: first, steps };
}

export function syntheticProbeObservations() {
  const builds: Defect[] = ['clean', 'B1', 'B2', 'B3'];
  return { builds, cases: builds.flatMap(d => (['Human', 'AI'] as Side[]).flatMap(side => [shield(side, d), chain(side, d), walk(side, d), actions(side, d)])), matches: [] as never[] };
}
