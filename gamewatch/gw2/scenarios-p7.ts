/**
 * GW2 P7 evidence scripts (U4, D96): two DISTINCT shielded matrix variants, so that a shielded-piece comparison across
 * player sides (R7 / R14) exists in both discovery and held-out without duplicating any observation.
 *   matrix-shield-v1   a shielded Human piece and a shielded AI piece each enter an enemy "Send home" cell (row 3; the
 *                      same moves as P5's matrix-shield, under a new id and a new script seed)
 *   matrix-shield-v2   a shielded Human piece and a shielded AI piece each enter an enemy "Freeze" cell (row 5)
 * The -v1/-v2 suffixes make them one variant family, so the frozen partition procedure puts one in each partition.
 * Every other P7 script is an existing GW1 or P5 script, unchanged.
 */
import type { Script } from '../adapters/rule-sabotage.ts';

const SEED = 98300;
const shield = { kind: 'shield' } as const, home = { kind: 'home' } as const, freeze = { kind: 'freeze' } as const;
type Fx = typeof home | typeof freeze;
/** Both sides pick up a shield, then each enters an enemy cell of the given effect (Human moves first). */
const shieldedMatrix = (id: string, title: string, fx: Fx, row: number): Script => ({ id, title, seed: SEED, first: 'human', turns: [
  { side: 'human', place: { effect: shield, squares: [`C${row}`] }, moves: [[`A${row}`, 'right'], [`B${row}`, 'right']] },
  { side: 'ai', place: { effect: shield, squares: [`K${row}`] }, moves: [[`M${row}`, 'left'], [`L${row}`, 'left']] },
  { side: 'human', place: { effect: fx, squares: [`I${row}`] }, moves: [[`C${row}`, 'right']] },
  { side: 'ai', place: { effect: fx, squares: [`F${row}`] }, moves: [[`K${row}`, 'left'], [`J${row}`, 'left']] },
  { side: 'human', moves: [[`D${row}`, 'right'], [`E${row}`, 'right']] },
] });

export const P7_SCRIPTS: Script[] = [
  shieldedMatrix('matrix-shield-v1', 'A shielded Human piece and a shielded AI piece each enter an enemy "Send home" cell', home, 3),
  shieldedMatrix('matrix-shield-v2', 'A shielded Human piece and a shielded AI piece each enter an enemy "Freeze" cell', freeze, 5),
];
