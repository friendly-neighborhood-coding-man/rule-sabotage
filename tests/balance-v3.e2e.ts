/**
 * End-to-end check of the PREPARED V3 Kane interface with the kane-cli TEST DOUBLE (tests/fixtures/fake-kane.mjs,
 * FAKE_KANE_V3=1): a small real-engine dataset -> dossier pages -> loopback server with a per-call nonce ->
 * objective-mode call -> notebook entries captured verbatim -> typed proposals -> provenance sealed and checked.
 * It proves plumbing only. The double's entries are fixed scripts, labelled kane-test-double, never Kane.
 *   npm run test:balance-v3-e2e
 */
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const tmp = mkdtempSync(join(tmpdir(), 'rs-v3-e2e-'));
Object.assign(process.env, { KANE_REFEREE: 'on', KANE_CLI: join(root, 'tests/fixtures/fake-kane.mjs'), FAKE_KANE_V3: '1', FAKE_KANE_OBJECTIVE_MODE: 'note' });
const E = await import('../server/engine.ts');
const W = await import('../server/weights.ts');
const { playGame } = await import('../server/balance/selfplay.ts');
const B = await import('../server/balance/v3/batch.ts');
const S = await import('../server/balance/v3/screen.ts');
const K3 = await import('../server/balance/v3/kane3.ts');
const P = await import('../server/balance/v3/proposals.ts');
const { kaneExplore } = await import('../server/balance/v2/kane2.ts');
const ok = (name: string, c: boolean, d = '') => { assert.ok(c, `${name} ${d}`); console.log(`PASS ${name}`); };

// 1. a tiny dataset (throwaway seeds) in the same layout as a real screen
const w = W.loadWeights();
const dir = join(tmp, 'ds'); mkdirSync(join(dir, 'games'), { recursive: true });
const conds = [{ id: 'C0', label: '3/3', firstMover: 3, secondMover: 3 }, { id: 'C3', label: '3/2', firstMover: 3, secondMover: 2 }];
const games = conds.flatMap(c => [93].flatMap(seed => (['human', 'ai'] as const).map(first => {
  const rec = playGame(seed, first, { human: W.freezeWeights(w), ai: W.freezeWeights(w) }, { start: { id: c.id, experimental: E.EXPERIMENTAL_START_CONFIG, pieces: { firstMover: c.firstMover, secondMover: c.secondMover }, layout: 'spread' }, detail: true });
  return { row: B.summaryRow(rec, { gameId: B.gameId(c.id, seed, first), condition: c.id }), rec };
})));
writeFileSync(join(dir, 'games.ndjson'), games.map(g => JSON.stringify(g.row)).join('\n') + '\n');
for (const g of games) writeFileSync(join(dir, 'games', `${g.row.gameId}.json`), JSON.stringify({ rec: g.rec }));
writeFileSync(join(dir, 'replay-check.json'), JSON.stringify({ engineReplays: games.map(g => ({ gameId: g.row.gameId, ...B.replayDetail(g.rec) })) }));
const dh = S.datasetHash(dir);
writeFileSync(join(dir, 'run.json'), JSON.stringify({ runId: 'e2e', matrix: { conditions: conds, totalGames: games.length }, datasetHash: dh, wallMs: 0, externalCalls: { total: 0 }, replay: { engineReplayOk: games.length } }));
S.buildOutputs(dir);
ok('dossier built from real-engine games', readFileSync(join(dir, 'dossier', 'notebook.html'), 'utf8').includes('name="nonce"'));
ok('dossier states no hypothesis or auto-finding', !/SIGNAL|DESCRIPTIVE|NO_EVIDENCE/.test(readFileSync(join(dir, 'dossier', 'index.html'), 'utf8') + readFileSync(join(dir, 'dossier', 'conditions.html'), 'utf8')));

// 2. one objective-mode call through the V2 runner against the V3 dossier
const kdir = join(tmp, 'kane');
const ids = new Set(games.map(g => g.row.gameId));
const session = K3.openV3Session(kdir, 'KX3', { gameIds: ids, datasetHash: dh, isTestDouble: true });
const { server, url } = await K3.serveDossier(dir, session, 0 as never, () => '0.0.0-test-double').catch(async () => K3.serveDossier(dir, session, 4391, () => '0.0.0-test-double'));
const port = (server.address() as { port: number }).port;
const realUrl = url.replace(/:\d+\//, `:${port}/`);
const res = await kaneExplore({ session: session as never, url: realUrl, objective: K3.objectiveV3(), dir: kdir, maxSteps: 5, timeoutS: 60 });
server.close();
const sha = K3.sealProvenance(session);
ok('test double ran to run_end', res.execution === 'COMPLETE', res.execution);
ok('two entries captured with a valid nonce inside the call window', session.notes.length === 2 && session.notes.every(n => n.validNonce && n.inWindow), JSON.stringify(session.notes.map(n => n.problems)));
const [h, c] = session.notes.map(n => n.proposal);
ok('hypothesis became a typed proposal with a catalog intervention', h.kind === 'hypothesis' && h.intervention?.id === 'S3_FIRST_TURN_ACTIONS' && h.intervention.value === 2 && h.predictions.length === 1);
ok('final conclusion captured', c.kind === 'conclusion' && c.verdict === 'more-evidence-needed');
ok('provenance is kane-test-double and verifies against the raw notes file', h.provenance.origin === 'kane-test-double' && h.provenance.kane!.rawSha256 === sha && P.checkProposal(h).length === 0, P.checkProposal(h).join('; '));
const forged = structuredClone(h); forged.provenance.origin = 'kane';
ok('the test double cannot be relabelled as Kane', P.checkProposal(forged).some(p => /test double/.test(p)));
const t = P.toTreatment([h.intervention!]);
ok('the proposal maps to a typed experimental start (nothing executed from text)', t.ok && t.treatment.start?.firstTurnActions === 2);
ok('a real Kane run stays refused without approval', (() => { try { K3.assertKaneApproved(null, 'e2e'); return false; } catch { return true; } })());
console.log(`ALL PASS (${tmp})`);
