/**
 * PRIVATE GROUND TRUTH (never shown to Kane or to the coding agent under evaluation).
 *
 * Independent reproduction tests for the planted defects in gamewatch/private/mutations.json. They do not use the
 * GameWatch adapter, the scripted playtests or any recorded evidence: each probe builds a minimal position directly on a
 * materialized build's engine and calls applyMove / endTurn. Every probe runs on the clean build (control) and on each
 * single-mutation build, so each test shows (a) the clean baseline does not exhibit the defect, (b) the mutated build
 * does, and (c) a mutation changes nothing the other probes look at.
 *
 *   node --experimental-strip-types --no-warnings --test gamewatch/private/groundtruth.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, materialize, loadBuild } from '../builds.ts';
import type { Player } from '../../server/rules.ts';

const M = JSON.parse(readFileSync(join(ROOT, 'gamewatch/private/mutations.json'), 'utf8'));
const GT: Record<string, string[]> = M.builds.groundTruth;
const builds: Record<string, Awaited<ReturnType<typeof loadBuild>>> = {};
for (const [name, ids] of Object.entries(GT)) {
  materialize(`gt-${name}`, M.mutations.filter((m: { id: string }) => ids.includes(m.id)));
  builds[name] = await loadBuild(`gt-${name}`);
}
import { probeShield, probeChain, probeActions, controlWalk, controlFreeze } from './probes.ts';

const SIDES: Player[] = ['human', 'ai'];

test('clean baseline: shield protects both sides identically (P1)', () => {
  for (const p of SIDES) assert.deepEqual(probeShield(builds.clean, p), { absorbed: true, fired: false, at: builds.clean.engine.key(p === 'human' ? 6 : 4, 4), shieldLeft: false, cellLive: false }, p);
});
test('B1: shielded Human piece is NOT protected, shielded AI piece is', () => {
  const b = builds.B1;
  const h = probeShield(b, 'human'), a = probeShield(b, 'ai');
  assert.equal(h.absorbed, false); assert.equal(h.fired, true); assert.equal(h.at, b.engine.key(0, 2), 'human piece sent home (start A3 = 0,2)'); assert.equal(h.shieldLeft, false);
  assert.deepEqual(a, probeShield(builds.clean, 'ai'));
});
test('clean baseline: a cell reached by a forced chain arrival is used up (P2)', () => {
  for (const p of SIDES) assert.deepEqual(probeChain(builds.clean, p), { firedFirst: 1, liveAfter: false, firedAgain: false }, p);
});
test('B2: a chain-reached cell stays live and fires again, for both sides', () => {
  for (const p of SIDES) assert.deepEqual(probeChain(builds.B2, p), { firedFirst: 1, liveAfter: true, firedAgain: true }, p);
});
test('clean baseline: every turn grants 3 actions to both seats (P3)', () => {
  for (const f of SIDES) assert.ok(probeActions(builds.clean, f).every(r => r.actions === 3), f);
});
test('B3: the first mover gets 4 actions on every one of its turns, the second mover 3', () => {
  for (const f of SIDES) for (const r of probeActions(builds.B3, f)) assert.equal(r.actions, r.side === f ? 4 : 3, `${f} first, ${r.side}`);
});
test('each mutation is isolated: other probes and the controls match the clean baseline', () => {
  const clean = builds.clean;
  for (const [name, b] of Object.entries(builds)) for (const p of SIDES) {
    if (name !== 'B1') assert.deepEqual(probeShield(b, p), probeShield(clean, p), `${name} P1 ${p}`);
    if (name !== 'B2') assert.deepEqual(probeChain(b, p), probeChain(clean, p), `${name} P2 ${p}`);
    if (name !== 'B3') assert.deepEqual(probeActions(b, p), probeActions(clean, p), `${name} P3 ${p}`);
    assert.deepEqual(controlWalk(b, p), { cellLive: false }, `${name} C1 ${p}`);
    assert.deepEqual(controlFreeze(b, p), { frozen: 2 }, `${name} C2 ${p}`);
  }
});
test('the clean ground-truth build is byte-identical to the playable server/v6/engine.ts', () => {
  const a = readFileSync(join(ROOT, 'server/v6/engine.ts'), 'utf8'), c = readFileSync(join(builds.clean.dir, 'engine.ts'), 'utf8');
  assert.equal(c, a);
});
