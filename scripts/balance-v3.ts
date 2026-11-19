/**
 * Living Balance Designer V3 command line (no Kane, no external model calls in any command below).
 *
 *   npm run balance:v3:screen                       the 100-game screen, EXACTLY ONCE per matrix (refuses a second run)
 *   npm run balance:v3:screen -- --smoke DIR        pipeline smoke test on throwaway seeds 90001-90002 (20 games) into DIR; not a dataset
 *   npm run balance:v3:build -- <datasetDir>        rebuild analysis, dashboard, dossier and replays from stored files
 *   npm run balance:v3:verify -- <datasetDir>       manifest hashes, dataset hash, journal chain, engine replay of every game
 *   npm run balance:v3:quarantine -- <runId> --reason "..."   mark a dataset invalid (never deleted)
 *   npm run balance:v3:kane-plan -- <datasetDir>    print the PREPARED Kane investigation (objective, calls, credits). Never calls Kane.
 *
 * Flags: --workers N · --approved-rerun "operator approval text" (only after quarantining the earlier run)
 */
import { resolve, join } from 'node:path';
import { readFileSync, writeFileSync } from 'node:fs';

const argv = process.argv.slice(2);
const cmd = argv.shift() ?? 'help';
const val = (n: string) => { const i = argv.indexOf(`--${n}`); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : undefined; };
const pos = () => argv.find(a => !a.startsWith('--') && argv[argv.indexOf(a) - 1]?.startsWith('--') !== true);

if (cmd === 'screen') {
  const S = await import('../server/balance/v3/screen.ts');
  const { appendJournal } = await import('../server/balance/journal.ts');
  const smoke = val('smoke');
  const r = await S.runScreen({ matrixFile: val('matrix') ? resolve(val('matrix')!) : undefined, withoutKane: val('without-kane'), workers: val('workers') ? Number(val('workers')) : undefined, approvedRerun: val('approved-rerun'), ...(smoke ? { smoke: { outDir: resolve(smoke), seeds: [90001, 90002] } } : {}) });
  const { analysis } = S.buildOutputs(r.dir);
  const n = S.writeManifest(r.dir);
  const mh = (await import('node:crypto')).createHash('sha256').update(readFileSync(join(r.dir, 'manifest.json'))).digest('hex').slice(0, 16);
  if (!smoke) appendJournal(S.V3_JOURNAL, 'dataset-sealed', r.runId, null, { dir: r.run.runId, manifestFiles: n, manifestSha256: mh, datasetHash: r.run.datasetHash, status: r.status });
  console.log(`dataset ${r.dir}\n  ${n} files in manifest (sha256 ${mh})\n  dashboard ${join(r.dir, 'dashboard', 'index.html')}\n  dossier   ${join(r.dir, 'dossier', 'index.html')}`);
  for (const f of analysis.findings) console.log(`  ${f.kind.padEnd(11)} ${f.text}`);
  console.log(r.status === 'accepted' ? (r.run.matrix.id.startsWith('V3-VALIDATE') ? 'VALIDATION GAMES ACCEPTED: run evaluate next' : 'READY_FOR_OPERATOR_V3_KANE_RESEARCH_REVIEW') : 'SCREEN FAILED: quarantine it and ask the operator before any fresh run');
  process.exit(r.status === 'accepted' ? 0 : 1);
} else if (cmd === 'build') {
  const S = await import('../server/balance/v3/screen.ts');
  const dir = resolve(pos()!); S.buildOutputs(dir); console.log(`rebuilt ${dir} (${S.writeManifest(dir)} files in manifest)`);
} else if (cmd === 'verify') {
  const S = await import('../server/balance/v3/screen.ts');
  const v = S.verifyRun(resolve(pos()!));
  for (const c of v.checks) console.log(`${c.pass ? 'PASS' : 'FAIL'}  ${c.check.padEnd(15)} ${c.detail}`);
  process.exit(v.pass ? 0 : 1);
} else if (cmd === 'quarantine') {
  const S = await import('../server/balance/v3/screen.ts');
  const { appendJournal } = await import('../server/balance/journal.ts');
  const id = pos()!, reason = val('reason');
  if (!reason) { console.error('--reason is required'); process.exit(2); }
  const reg = JSON.parse(readFileSync(S.V3_REGISTRY, 'utf8'));
  const e = reg.runs.find((x: { runId: string }) => x.runId === id); if (!e) { console.error(`no run ${id}`); process.exit(2); }
  e.status = 'quarantined'; e.reason = reason; writeFileSync(S.V3_REGISTRY, JSON.stringify(reg, null, 2) + '\n');
  appendJournal(S.V3_JOURNAL, 'quarantine', id, null, { reason });
  console.log(`quarantined ${id}: ${reason}`);
} else if (cmd === 'kane-preflight') {
  const R = await import('../server/balance/v3/kanerun.ts');
  const dir = resolve(pos()!);
  const out = resolve(val('out') ?? join(dir, '..', '..', 'kane', `preflight-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}Z`));
  const r = await R.kanePreflight(dir, out, { fakeCli: resolve('tests/fixtures/fake-kane.mjs') });
  for (const c of r.checks) console.log(`${c.pass ? 'PASS' : 'FAIL'}  ${c.check}: ${c.detail}`);
  console.log(`credits used: 0 · ${out}`);
  process.exit(r.pass ? 0 : 1);
} else if (cmd === 'kane-call') {
  // ONE real call, only with the approval record AND KANE_V3_APPROVED=<runId>. Never retried.
  const R = await import('../server/balance/v3/kanerun.ts');
  const r = await R.runKaneV3Call(resolve(pos()!), resolve(val('approval') ?? 'balance/v3/kane-approval.json'));
  console.log(JSON.stringify(r.summary, null, 2));
} else if (cmd === 'kane-register') {
  const R = await import('../server/balance/v3/kanerun.ts');
  const r = R.registerKaneEntries(resolve(pos()!));
  for (const e of r.entries) console.log(`${e.noteId}: ${e.registered ? 'REGISTERED' : 'not registered'} ${e.proposal.kind} "${e.proposal.title}"${e.problems.length ? ` problems: ${e.problems.join('; ')}` : ''}`);
  console.log(`journal #${r.journal} · raw notes sha256 matches the call record: ${r.sameSha}`);
} else if (cmd === 'evaluate') {
  // Preregistered evaluation of the validation dataset + teleport foresight (validation arms and the screen).
  const S = await import('../server/balance/v3/screen.ts');
  const V = await import('../server/balance/v3/evaluate.ts');
  const { appendJournal } = await import('../server/balance/journal.ts');
  const { existsSync } = await import('node:fs');
  const dir = resolve(pos()!), screen = val('screen') ? resolve(val('screen')!) : null;
  const protocol = JSON.parse(readFileSync('balance/v3/validate-protocol.json', 'utf8'));
  const { games, run } = S.loadDataset(dir);
  const ev = V.evaluateProtocol(games, protocol);
  const kaneFile = 'balance/v3/kane-proposals.json';
  const kane = existsSync(kaneFile) ? V.mapKane(JSON.parse(readFileSync(kaneFile, 'utf8')).entries, ev.comparisons) : [];
  const fs = Object.fromEntries([...new Set(games.map(g => g.row.condition))].map(a => { const f = V.teleportForesight(games.filter(g => g.row.condition === a).map(g => g.rec)); return [a, { all: f.all, turn1: f.turn1 }]; }));
  let screenFs = null;
  if (screen) { const sg = S.loadDataset(screen).games; const f = V.teleportForesight(sg.map(g => g.rec)); const c0 = V.teleportForesight(sg.filter(g => g.row.condition === 'C0').map(g => g.rec)); screenFs = { all: f.all, turn1: f.turn1, C0: { all: c0.all, turn1: c0.turn1 } }; }
  const out = { schema: 'rule-sabotage/v3-validation-evaluation@1', runId: run.runId, datasetHash: run.datasetHash, protocol: 'balance/v3/validate-protocol.json', ...ev, kane, foresight: { validation: fs, screen: screenFs } };
  writeFileSync(join(dir, 'evaluation.json'), JSON.stringify(out, null, 2));
  writeFileSync(join(dir, 'evaluation.html'), await V.evaluationPage(out as never));
  const n = S.writeManifest(dir);
  const mh = (await import('node:crypto')).createHash('sha256').update(readFileSync(join(dir, 'manifest.json'))).digest('hex').slice(0, 16);
  if (!String(run.matrix.id).endsWith('-SMOKE')) appendJournal(S.V3_JOURNAL, 'validation-evaluated', run.runId, null, { hypotheses: Object.fromEntries(Object.entries(ev.hypotheses).map(([k, v]) => [k, v.outcome])), kane: kane.map(k => `${k.noteId}:${k.outcome}`), manifestFiles: n, manifestSha256: mh });
  for (const [k, v] of Object.entries(ev.hypotheses)) console.log(`${k.padEnd(5)} ${v.outcome}${v.reason ? ` (${v.reason})` : ''}`);
  for (const k of kane) console.log(`${k.noteId} ${k.outcome}${'reason' in k && k.reason ? ` (${k.reason})` : ''}`);
  console.log(JSON.stringify({ firstMover: ev.firstMover, morePieces: ev.morePieces, foresight: Object.fromEntries(Object.entries(fs).map(([a, f]) => [a, { adv: f.all.advantageMean, ci: f.all.advantageCi95, pct: f.all.meanPercentile, t1: f.turn1.moves }])) }, null, 1));
} else if (cmd === 'kane-plan') {
  const K = await import('../server/balance/v3/kane3.ts');
  console.log(JSON.stringify({ ...K.KANE_V3_PLAN, objective: K.objectiveV3(), dossier: pos() ? join(resolve(pos()!), 'dossier', 'index.html') : null }, null, 2));
  console.log('\nKane was NOT called. A real run needs Eric’s explicit approval (calls + credit ceiling) and KANE_V3_APPROVED=<runId>.');
} else {
  console.log(readFileSync(new URL(import.meta.url), 'utf8').split('*/')[0]);
}
