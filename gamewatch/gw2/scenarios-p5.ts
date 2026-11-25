/**
 * GW2 P5: additional scripted playtests (Rule Sabotage V6.1), frozen with the P5 generation procedure
 * (evidence/gw2/procedures/generation-p5-1.json) before any P5 observation was generated. Same format and adapter as
 * gamewatch/scenarios.ts (unchanged); the build's engine and referee decide every outcome.
 *
 *   send-home-human / -ai       Q17 R12: an unshielded piece walks into an enemy "Send home" cell
 *   placement-human / -ai       Q17 R5: a placement next to a piece, then a placement on an enemy effect cell
 *   multicell-human / -ai       Q21 R8 clause 3: a piece walks onto one cell of an own two-cell effect
 *   matrix-haste / -freeze / -home
 *                               Q21 R7: within ONE case, a Human piece and an AI piece each enter an own and an enemy
 *                               cell of the same effect (all four side × ownership combinations)
 *   matrix-shield               Q21 R7 / R14: a shielded Human piece and a shielded AI piece each enter an enemy
 *                               "Send home" cell in the same case
 * Matrix scripts have no -human/-ai variant: each is a single unit, so both sides are compared within one partition.
 */
import type { Script } from '../adapters/rule-sabotage.ts';

const SEED = 98100;
const home = { kind: 'home' } as const, haste = { kind: 'haste' } as const, freeze = { kind: 'freeze' } as const, shield = { kind: 'shield' } as const;
type Fx = typeof home | typeof haste | typeof freeze;
/** Own cell then enemy cell, for each side (Human moves first). */
const matrix = (id: string, title: string, fx: Fx): Script => ({ id, title, seed: SEED, first: 'human', turns: [
  { side: 'human', place: { effect: fx, squares: ['C3'] }, moves: [['A3', 'right'], ['B3', 'right']] },
  { side: 'ai', place: { effect: fx, squares: ['K3'] }, moves: [['M3', 'left'], ['L3', 'left']] },
  { side: 'human', place: { effect: fx, squares: ['K5'] }, moves: [['A5', 'right']] },
  { side: 'ai', place: { effect: fx, squares: ['D5'] }, moves: [['M5', 'left'], ['L5', 'left']] },
  { side: 'human', moves: [['B5', 'right'], ['C5', 'right']] },
] });

export const P5_SCRIPTS: Script[] = [
  { id: 'send-home-human', title: 'Human piece walks into an AI "Send home" cell', seed: SEED, first: 'human', turns: [
    { side: 'human', moves: [['A3', 'right']] },
    { side: 'ai', place: { effect: home, squares: ['D3'] }, moves: [['M7', 'left']] },
    { side: 'human', moves: [['B3', 'right'], ['C3', 'right']] },
  ] },
  { id: 'send-home-ai', title: 'AI piece walks into a Human "Send home" cell', seed: SEED, first: 'human', turns: [
    { side: 'human', moves: [['A7', 'right']] },
    { side: 'ai', moves: [['M3', 'left']] },
    { side: 'human', place: { effect: home, squares: ['J3'] }, moves: [['B7', 'right']] },
    { side: 'ai', moves: [['L3', 'left'], ['K3', 'left']] },
  ] },
  { id: 'placement-human', title: 'Human tries to place an effect next to an AI piece, then on an AI effect cell', seed: SEED, first: 'human', turns: [
    { side: 'human', place: { effect: { kind: 'shove', dir: 'east', amount: 1 }, squares: ['L4'] }, moves: [['A3', 'right']] },
    { side: 'ai', place: { effect: freeze, squares: ['F5'] }, moves: [['M3', 'left']] },
    { side: 'human', place: { effect: haste, squares: ['F5'] }, moves: [['B3', 'right']] },
  ] },
  { id: 'placement-ai', title: 'AI tries to place an effect next to a Human piece, then on a Human effect cell', seed: SEED, first: 'human', turns: [
    { side: 'human', place: { effect: freeze, squares: ['H5'] }, moves: [['A3', 'right']] },
    { side: 'ai', place: { effect: { kind: 'shove', dir: 'west', amount: 1 }, squares: ['B4'] }, moves: [['M3', 'left']] },
    { side: 'human', moves: [['B3', 'right']] },
    { side: 'ai', place: { effect: haste, squares: ['H5'] }, moves: [['L3', 'left']] },
  ] },
  { id: 'multicell-human', title: 'Human piece walks onto one cell of its own two-cell "+1 action" effect', seed: SEED, first: 'human', turns: [
    { side: 'human', place: { effect: haste, squares: ['C5', 'C7'] }, moves: [['A5', 'right'], ['B5', 'right']] },
  ] },
  { id: 'multicell-ai', title: 'AI piece walks onto one cell of its own two-cell "+1 action" effect', seed: SEED, first: 'human', turns: [
    { side: 'human', moves: [['A3', 'right']] },
    { side: 'ai', place: { effect: haste, squares: ['K5', 'K7'] }, moves: [['M5', 'left'], ['L5', 'left']] },
  ] },
  matrix('matrix-haste', 'Each side enters an own and an enemy "+1 action" cell', haste),
  matrix('matrix-freeze', 'Each side enters an own and an enemy "Freeze" cell', freeze),
  matrix('matrix-home', 'Each side enters an own and an enemy "Send home" cell', home),
  { id: 'matrix-shield', title: 'A shielded Human piece and a shielded AI piece each enter an enemy "Send home" cell', seed: SEED, first: 'human', turns: [
    { side: 'human', place: { effect: shield, squares: ['C3'] }, moves: [['A3', 'right'], ['B3', 'right']] },
    { side: 'ai', place: { effect: shield, squares: ['K3'] }, moves: [['M3', 'left'], ['L3', 'left']] },
    { side: 'human', place: { effect: home, squares: ['I3'] }, moves: [['C3', 'right']] },
    { side: 'ai', place: { effect: home, squares: ['F3'] }, moves: [['K3', 'left'], ['J3', 'left']] },
    { side: 'human', moves: [['D3', 'right'], ['E3', 'right']] },
  ] },
];
