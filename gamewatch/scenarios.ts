/**
 * Scripted playtest scripts for GameWatch (Rule Sabotage V6.1). Each script fixes both sides' actions in advance; the
 * build's engine and referee decide everything that happens. Scripts are run unchanged on every build.
 * Squares: columns A..M, rows 1..9. Human pieces start on A3, A5, A7; AI pieces on M3, M5, M7. Human moves first.
 */
import type { Script } from './adapters/rule-sabotage.ts';

const SEED = 97100;
export const SCRIPTS: Script[] = [
  {
    id: 'shield-human', title: 'Human picks up a Shield, then walks into an AI "Send home" cell', seed: SEED, first: 'human', turns: [
      { side: 'human', place: { effect: { kind: 'shield' }, squares: ['C3'] }, moves: [['A3', 'right'], ['B3', 'right']] },
      { side: 'ai', place: { effect: { kind: 'home' }, squares: ['E3'] }, moves: [['M7', 'left']] },
      { side: 'human', moves: [['C3', 'right'], ['D3', 'right']] },
    ],
  },
  {
    id: 'shield-ai', title: 'AI picks up a Shield, then walks into a Human "Send home" cell', seed: SEED, first: 'human', turns: [
      { side: 'human', moves: [['A7', 'right']] },
      { side: 'ai', place: { effect: { kind: 'shield' }, squares: ['K3'] }, moves: [['M3', 'left'], ['L3', 'left']] },
      { side: 'human', place: { effect: { kind: 'home' }, squares: ['I3'] }, moves: [['B7', 'right']] },
      { side: 'ai', moves: [['K3', 'left'], ['J3', 'left']] },
    ],
  },
  {
    id: 'shove-chain-human', title: 'Human piece is shoved east onto a "+1 action" cell, steps off and back on', seed: SEED, first: 'human', turns: [
      { side: 'human', place: { effect: { kind: 'shove', dir: 'east', amount: 2 }, squares: ['C5'] }, moves: [['A3', 'right']] },
      { side: 'ai', moves: [['M3', 'left']] },
      { side: 'human', place: { effect: { kind: 'haste' }, squares: ['E5'] }, moves: [['A5', 'right'], ['B5', 'right'], ['E5', 'right'], ['F5', 'left'], ['E5', 'right']] },
    ],
  },
  {
    id: 'shove-chain-ai', title: 'AI piece is shoved west onto a "+1 action" cell, steps off and back on', seed: SEED, first: 'human', turns: [
      { side: 'human', moves: [['A3', 'right']] },
      { side: 'ai', place: { effect: { kind: 'shove', dir: 'west', amount: 2 }, squares: ['K5'] }, moves: [['M3', 'left']] },
      { side: 'human', moves: [['B3', 'right']] },
      { side: 'ai', place: { effect: { kind: 'haste' }, squares: ['I5'] }, moves: [['M5', 'left'], ['L5', 'left'], ['I5', 'left'], ['H5', 'right'], ['I5', 'left']] },
    ],
  },
  {
    id: 'walk-twice', title: 'Human walks onto its own "+1 action" cell, steps off and back on', seed: SEED, first: 'human', turns: [
      { side: 'human', place: { effect: { kind: 'haste' }, squares: ['C7'] }, moves: [['A7', 'right'], ['B7', 'right'], ['C7', 'right'], ['D7', 'left']] },
    ],
  },
  {
    id: 'freeze-human', title: 'Human piece walks into an AI "Freeze" cell, then tries to move', seed: SEED, first: 'human', turns: [
      { side: 'human', moves: [['A3', 'right']] },
      { side: 'ai', place: { effect: { kind: 'freeze' }, squares: ['D3'] }, moves: [['M5', 'left']] },
      { side: 'human', moves: [['B3', 'right'], ['C3', 'right']] },
      { side: 'ai', moves: [['L5', 'left']] },
      { side: 'human', moves: [['D3', 'right'], ['A5', 'right']] },
      { side: 'ai', moves: [['K5', 'left']] },
      { side: 'human', moves: [['D3', 'right']] },
    ],
  },
  {
    id: 'freeze-ai', title: 'AI piece walks into a Human "Freeze" cell, then tries to move', seed: SEED, first: 'human', turns: [
      { side: 'human', place: { effect: { kind: 'freeze' }, squares: ['J7'] }, moves: [['A5', 'right']] },
      { side: 'ai', moves: [['M7', 'left'], ['L7', 'left'], ['K7', 'left']] },
      { side: 'human', moves: [['B5', 'right']] },
      { side: 'ai', moves: [['J7', 'left'], ['M3', 'left']] },
      { side: 'human', moves: [['C5', 'right']] },
      { side: 'ai', moves: [['J7', 'left']] },
    ],
  },
  {
    id: 'shove-human', title: 'Human piece walks into an AI "shove back 2" cell', seed: SEED, first: 'human', turns: [
      { side: 'human', moves: [['A5', 'right']] },
      { side: 'ai', place: { effect: { kind: 'shove', dir: 'back', amount: 2 }, squares: ['D5'] }, moves: [['M3', 'left']] },
      { side: 'human', moves: [['B5', 'right'], ['C5', 'right']] },
    ],
  },
  {
    id: 'shove-ai', title: 'AI piece walks into a Human "shove back 2" cell', seed: SEED, first: 'human', turns: [
      { side: 'human', place: { effect: { kind: 'shove', dir: 'back', amount: 2 }, squares: ['J5'] }, moves: [['A3', 'right']] },
      { side: 'ai', moves: [['M5', 'left'], ['L5', 'left'], ['K5', 'left']] },
    ],
  },
  {
    id: 'adjacent-placement', title: 'Human tries to place an effect right next to its own piece', seed: SEED, first: 'human', turns: [
      { side: 'human', place: { effect: { kind: 'shove', dir: 'east', amount: 1 }, squares: ['B5'] }, moves: [['A5', 'right']] },
      { side: 'ai', place: { effect: { kind: 'shove', dir: 'west', amount: 1 }, squares: ['J5'] }, moves: [['M5', 'left']] },
    ],
  },
  {
    id: 'teleport-human', title: 'Human piece walks onto its own Teleport cell', seed: SEED, first: 'human', turns: [
      { side: 'human', place: { effect: { kind: 'teleport' }, squares: ['C3'] }, moves: [['A3', 'right'], ['B3', 'right']] },
    ],
  },
];
