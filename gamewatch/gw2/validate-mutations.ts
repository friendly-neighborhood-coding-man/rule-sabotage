/**
 * GW2 P5: real-engine single-defect validation (AC-P4.6 → D69: engine validation completed in P5).
 *
 *   node --experimental-strip-types --no-warnings gamewatch/gw2/validate-mutations.ts <procedure.json> <generatedDir> <out.json>
 *
 * Two independent checks on the unchanged ground-truth builds clean, B1, B2, B3 (gamewatch/private/mutations.json):
 *  (a) the private probes (gamewatch/private/probes.ts: probeShield, probeChain, probeActions, controlWalk,
 *      controlFreeze), run directly on each build's engine, both sides; results compared with the documented
 *      expectations of gamewatch/private/groundtruth.test.ts;
 *  (b) the verifier: O↔S of every encoded spec record (encoding-2, provisional) on the recorded scripted cases of the
 *      frozen "validation" run of the P5 generation procedure, one build at a time.
 * EXPECTED_DEVIATIONS is declared here, from the documented intended violation of each mutation, before the validation
 * observations are analysed. Observed and expected deviations are both reported; nothing is adjusted to make them
 * agree (no engine change, no encoding change, no re-run).
 */
import { readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, assertWritableOutput, repoRelative } from './paths.ts';
import { fileSha256 } from './judgments.ts';
import { materialize, loadBuild } from '../builds.ts';
import { probeShield, probeChain, probeActions, controlWalk, controlFreeze } from '../private/probes.ts';
import { loadGenerationProcedure, treeHashes } from './generate.ts';
import { extractSituations } from './situations.ts';
import { threeWay, loadEncoding } from './verify.ts';
import type { Player } from '../../server/rules.ts';

export const P5_ENCODING = join(ROOT, 'gamewatch/gw2/spec-encodings/rule-sabotage-v6.1-p5.json');
/** Declared from mutations.json "intendedViolation" (B1: asymmetric shield; B2: forced arrival not used up; B3: first mover +1). */
export const EXPECTED_DEVIATIONS: Record<string, string[]> = { 'gt-clean': [], 'gt-B1': ['R7', 'R14'], 'gt-B2': ['R8'], 'gt-B3': ['R3'] };
/** What each expected deviation's witnesses must look like (a reading of the intended violation). */
const WITNESS: Record<string, (f: Record<string, unknown>) => boolean> = {
  'gt-B1:R14': f => f.pieceSide === 'Human' && f.pieceShieldedBefore === true,
  'gt-B1:R7': f => f.pieceShieldedBefore === true,
  'gt-B2:R8': f => f.arrival === 'forced',
  'gt-B3:R3': f => f.isFirstMover === true,
};
const SIDES: Player[] = ['human', 'ai'];

export async function validateMutations(procFile: string, generatedDir: string, outFile: string) {
  const p = loadGenerationProcedure(procFile), run = p.runs.validation;
  const bundleF = join(generatedDir, 'bundle.json'), bundle = JSON.parse(readFileSync(bundleF, 'utf8'));
  const mut = JSON.parse(readFileSync(join(ROOT, p.mutations.path), 'utf8'));
  // (a) probes on freshly materialized, hash-checked builds
  const probes: Record<string, unknown> = {}, b: Record<string, Awaited<ReturnType<typeof loadBuild>>> = {}, dirs: string[] = [];
  for (const x of run.builds) {
    const info = materialize(`gw2p5v-${x.label}`, mut.mutations.filter((m: { id: string }) => mut.builds[x.from][x.key].includes(m.id)));
    dirs.push(info.dir);
    if (treeHashes(info.dir).tree !== p.buildHashes[x.label].tree) throw new Error(`build ${x.label}: source tree differs from the frozen hash`);
    b[x.label] = await loadBuild(`gw2p5v-${x.label}`);
  }
  const clean = b['gt-clean'];
  const probeRows = run.builds.flatMap(x => SIDES.map(side => {
    const e = b[x.label], got = { shield: probeShield(e, side), chain: probeChain(e, side), actions: probeActions(e, side), walk: controlWalk(e, side), freeze: controlFreeze(e, side) };
    const ref = { shield: probeShield(clean, side), chain: probeChain(clean, side), actions: probeActions(clean, side) };
    const expected = {
      shield: x.label === 'gt-B1' && side === 'human' ? 'not absorbed, fired, sent home, shield used up' : 'same as clean (absorbed, not fired)',
      chain: x.label === 'gt-B2' ? 'forced-arrival cell stays live and fires again' : 'same as clean (used up)',
      actions: x.label === 'gt-B3' ? 'first mover 4 on its turns, second mover 3' : 'same as clean (3 each)',
    };
    const ok = {
      shield: x.label === 'gt-B1' && side === 'human' ? got.shield.absorbed === false && got.shield.fired === true && got.shield.at === e.engine.key(0, 2) && got.shield.shieldLeft === false : JSON.stringify(got.shield) === JSON.stringify(ref.shield),
      chain: x.label === 'gt-B2' ? JSON.stringify(got.chain) === JSON.stringify({ firedFirst: 1, liveAfter: true, firedAgain: true }) : JSON.stringify(got.chain) === JSON.stringify(ref.chain),
      actions: x.label === 'gt-B3' ? got.actions.every(r => r.actions === (r.side === side ? 4 : 3)) : JSON.stringify(got.actions) === JSON.stringify(ref.actions) && got.actions.every(r => r.actions === 3),
      walk: got.walk.cellLive === false, freeze: got.freeze.frozen === 2,
    };
    return { build: x.label, side, observed: got, expected, asExpected: ok };
  }));
  probes.rows = probeRows;
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
  // (b) verifier on the recorded validation cases, one build at a time
  const enc = loadEncoding(P5_ENCODING, bundle.game.rules), sits = extractSituations(bundle);
  const builds = [...bundle.builds.map((x: { label: string }) => x.label)].sort();
  const r = threeWay([], [{ partition: 'validation', builds, situations: sits }], enc);
  const byId = new Map(sits.map(s => [s.id, s.fields]));
  const matrix = builds.map(build => {
    const rules = r.implementationCorrectness.filter(x => x.scope.build === build).map(x => {
      const expected = EXPECTED_DEVIATIONS[build].includes(x.rule), deviates = x.value === 'deviates';
      const chk = WITNESS[`${build}:${x.rule}`], ce = x.counterExamples.map(c => byId.get(c.id)!);
      return { rule: x.rule, value: x.value, expectedDeviation: expected, observedDeviation: deviates, agreement: expected === deviates ? 'as-expected' : deviates ? 'UNEXPECTED-DEVIATION' : 'EXPECTED-DEVIATION-NOT-OBSERVED',
        evaluated: x.scope.evaluated, support: x.scope.support, counterCount: x.counterCount,
        ...(deviates ? { witnessesMatchIntendedViolation: chk ? ce.every(chk) : null, counterExamples: x.counterExamples } : {}) };
    });
    return { build, mutations: run.builds.find(y => y.label === build)!.key, rules };
  });
  const unexpected = matrix.flatMap(m => m.rules.filter(x => x.agreement !== 'as-expected').map(x => ({ build: m.build, rule: x.rule, agreement: x.agreement, value: x.value })));
  const report = {
    schema: 'gamewatch/gw2-mutation-validation@1', procedure: { id: p.id, sha256: fileSha256(procFile) }, bundle: { path: repoRelative(bundleF) ?? bundleF, sha256: fileSha256(bundleF) },
    encoding: { id: enc.enc.id, sha256: enc.sha256, review: enc.enc.review.status },
    expectedDeviations: EXPECTED_DEVIATIONS,
    probes: { rows: probeRows, allAsExpected: probeRows.every(x => Object.values(x.asExpected).every(Boolean)) },
    verifier: { matrix, unexpected, allAsExpected: unexpected.length === 0 },
    note: 'Real engine observations on unchanged single-defect builds. Expected deviations were declared from the documented intended violations before analysis; nothing was adjusted after.',
  };
  writeFileSync(assertWritableOutput(outFile), JSON.stringify(report, null, 1) + '\n');
  return report;
}

if (process.argv[1]?.endsWith('gw2/validate-mutations.ts')) {
  const [proc, gen, out] = process.argv.slice(2);
  if (!proc || !gen || !out) { console.error('usage: validate-mutations.ts <procedure.json> <generatedDir> <out.json>'); process.exit(2); }
  const r = await validateMutations(proc, gen, out);
  for (const m of r.verifier.matrix) console.log(`${m.build}: ${m.rules.map(x => `${x.rule} ${x.value}${x.agreement === 'as-expected' ? '' : ' [' + x.agreement + ']'}`).join(' · ')}`);
  console.log(`probes all as expected: ${r.probes.allAsExpected}; verifier all as expected: ${r.verifier.allAsExpected}`);
}
