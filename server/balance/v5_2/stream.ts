/**
 * V5.2 planner randomness streams ('stream-1'). EXPERIMENT-ONLY. Historical planners keep their legacy stream.
 *
 *  legacy  rng((seed ^ Math.imul(turn + 7, 0x9e3779b1)) >>> 0): one xorshift32 stream per (seed, turn), shared by planning
 *          noise and the temperature roll. Its first draws barely change between consecutive seeds (V5.1 finding).
 *  mixed   counter-based SHA-256: draw i of stream (seed, turn, role, purpose) = first 52 bits of
 *          sha256("rule-sabotage/planner-stream/v1|" + seed + "|" + turn + "|" + role + "|" + purpose + "|" + i) / 2^52.
 *          Domain-separated by purpose ('noise', 'temperature'), and by the mover's role relative to the first mover
 *          ('F' / 'S'), which a position and its mirror share (mirror swaps sides AND the first player), so mirror
 *          symmetry holds. Inputs are public (game seed, turn number, role): never the engine RNG state.
 */
import { createHash } from 'node:crypto';
import { type State } from '../../engine.ts';
import { type Player } from '../../rules.ts';

export type StreamKind = 'legacy' | 'mixed';
export const STREAM_ID = 'stream-1';
export const legacyStream = (seed: number, turn: number) => { let x = ((seed ^ Math.imul(turn + 7, 0x9e3779b1)) >>> 0) || 1; return () => { x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0; return x / 0x100000000; }; };
export function mixedDraw(seed: number, turn: number, role: 'F' | 'S', purpose: string, i: number): number {
  const h = createHash('sha256').update(`rule-sabotage/planner-stream/v1|${seed >>> 0}|${turn}|${role}|${purpose}|${i}`).digest();
  return (h.readUInt32BE(0) * 2 ** 20 + (h.readUInt32BE(4) >>> 12)) / 2 ** 52;
}
export const mixedStream = (seed: number, turn: number, role: 'F' | 'S', purpose: string) => { let i = 0; return () => mixedDraw(seed, turn, role, purpose, i++); };
export const roleOf = (s: State, p: Player): 'F' | 'S' => (p === s.firstPlayer ? 'F' : 'S');
/** The two streams a planner turn uses: planning noise and the temperature roll. Legacy: one shared stream. */
export function plannerStreams(kind: StreamKind, s: State, p: Player): { noise: () => number; temperature: () => number } {
  if (kind === 'legacy') { const r = legacyStream(s.seed, s.turn); return { noise: r, temperature: r }; }
  const role = roleOf(s, p);
  return { noise: mixedStream(s.seed, s.turn, role, 'noise'), temperature: mixedStream(s.seed, s.turn, role, 'temperature') };
}
