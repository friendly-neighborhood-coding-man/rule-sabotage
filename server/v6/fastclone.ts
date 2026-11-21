/**
 * V6.2 latency, semantics-preserving: a structure-aware copy of the V6 game State.
 *
 * Profiling (docs/V6_2_PLAYABILITY_AND_KANE_SHADOW.md §1) shows 40-60% of a slow decision is spent in structuredClone,
 * called by the planners once per enumerated teleport destination and once per simulated move. structuredClone is a
 * general serializer; a State is plain JSON of a known shape, so it can be copied field by field much faster.
 *
 * cloneState() returns a deep copy equal (deep-equal, no shared mutable objects) to structuredClone(state).
 * withFastClone(fn) runs a SYNCHRONOUS planner call with the global structuredClone answering State objects through
 * cloneState and everything else through the native function, then restores the native function. The planner code
 * itself (the generated forks) is not changed. tests/v6-2.test.ts checks copy equality and identical decisions.
 */
import type { State, Piece, Rule } from './engine.ts';

const native = globalThis.structuredClone;
const isState = (v: unknown): v is State => !!v && typeof v === 'object' && typeof (v as State).ruleset === 'string' && Array.isArray((v as State).pieces) && typeof (v as State).cells === 'object' && Array.isArray((v as State).rules);
const clonePiece = (q: Piece): Piece => ({ id: q.id, owner: q.owner, x: q.x, y: q.y, home: { x: q.home.x, y: q.home.y }, scored: q.scored, frozen: q.frozen, shield: q.shield });
const cloneRule = (r: Rule): Rule => {
  const o: Rule = { ...r, effect: { ...r.effect } as Rule['effect'], cells: [...r.cells], hits: { human: r.hits.human, ai: r.hits.ai } };
  return o;
};
export function cloneState(s: State): State {
  const t = { ...s } as State;
  t.bonus = { human: s.bonus.human, ai: s.bonus.ai };
  t.pieces = s.pieces.map(clonePiece);
  t.cells = { ...s.cells };
  t.rules = s.rules.map(cloneRule);
  t.log = s.log.map(l => native(l));
  t.stats = { activePerTurn: [...s.stats.activePerTurn] };
  return t;
}
/** Exactly the set of keys structuredClone would copy, checked against the known shape (used by tests). */
export const STATE_KEYS = ['ruleset', 'seed', 'rng', 'turn', 'maxTurns', 'current', 'firstPlayer', 'phase', 'actionsLeft', 'bonus', 'pieces', 'cells', 'rules', 'nextId', 'winner', 'winReason', 'log', 'stats'] as const;

export function withFastClone<T>(fn: () => T): T {
  const prev = globalThis.structuredClone;
  globalThis.structuredClone = ((v: unknown, o?: StructuredSerializeOptions) => (o === undefined && isState(v) && Object.keys(v).every(k => (STATE_KEYS as readonly string[]).includes(k)) ? cloneState(v) : native(v, o))) as typeof structuredClone;
  try { return fn(); } finally { globalThis.structuredClone = prev; }
}
