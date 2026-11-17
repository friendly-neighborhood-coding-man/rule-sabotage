/**
 * Live Kane referee measurement (REAL kane-cli, no doubles).
 *   npm run kane:trial            -> runs the scenarios below, writes evidence/kane/live-<ts>.json + .md
 * Scenarios:
 *   A  human rule: shove north 2 on 3 scattered cells         expected: approved
 *   B  same rule proposed by the AI (equal scrutiny)          expected: approved
 *   C  CANARY: page deliberately corrupted so the AI piece
 *      gets a different outcome + a cell fires twice          expected: rejected
 *   D  repeat of A (cache)                                    expected: cached verdict, ~0 ms
 *   E  real in-game turns: human places a rule, AI replies; Kane runs in the background
 *      while play continues                                   expected: approved, request latency ~1.5 s
 * Only real Kane output is recorded; failures are reported as unverified.
 * Each Kane run records per-stage timings (probe, browser spawn, CDP ready, CLI, first output, run_end, parse, cleanup).
 * With REFEREE_TIERS=on, the in-game rows (E) show which rules the engine decided and which went to Kane.
 */
import { writeFile, mkdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
process.env.RULE_SABOTAGE_NO_LISTEN = '1';
const { server } = await import('../server/server.ts');
const { trials } = await import('../server/game.ts');
const { buildTrial, renderTrialPage, KANE_CONDITIONS } = await import('../server/trial.ts');
const { kaneJudge, kaneProbe, kaneConfig } = await import('../server/kane.ts');
const { init } = await import('../server/engine.ts');
const { makeEffect } = await import('../server/rules.ts');

await new Promise<void>(r => server.listen(0, '127.0.0.1', () => r()));
const port = (server.address() as { port: number }).port;
const probe = await kaneProbe();
console.log('Kane probe:', probe);
const cli = kaneConfig().cli;
const balance = () => { const r = spawnSync(cli, ['balance'], { encoding: 'utf8', shell: process.platform === 'win32', timeout: 30000 }); return (r.stdout || r.stderr || '').replace(/\x1b\[[0-9;]*m/g, '').trim().slice(0, 400); };
const out: Record<string, unknown>[] = [];
const balanceBefore = probe.installed ? balance() : null;
try {
  if (!probe.installed || !probe.loggedIn) throw new Error(`Kane not ready: ${probe.detail}`);
  const s = init(2024); s.current = 'human'; s.phase = 'place';
  const rule = { text: 'Anything entering here is shoved two squares north!', effect: makeEffect('shove', 'north', 2), cells: ['3,3', '2,5', '4,1'], interpretedBy: 'live-trial' };
  const runOne = async (label: string, expected: string, proposer: 'human' | 'ai', corrupt = false, n: number) => {
    const st = structuredClone(s); st.current = proposer;
    const t = buildTrial(st, proposer, { ...rule, text: proposer === 'ai' ? 'Step here and you are pushed 2 squares north. Nothing personal.' : rule.text }, n);
    if (corrupt) {
      t.symmetry[0].ai = { ...t.symmetry[0].ai, endSquare: 'D6', effectSeen: 'Shove south 2' };
      t.symmetry[0].secondVisitFired.human = true;
      t.signature = 'canary-' + t.signature;
    }
    const html = renderTrialPage(t);
    trials.set(t.trialId, { trial: t, html });
    const t0 = Date.now();
    const k = await kaneJudge({ trialId: t.trialId, signature: t.signature, url: `http://127.0.0.1:${port}/trial/${t.trialId}`, html, conditions: KANE_CONDITIONS });
    const row = { label, expected, trialId: t.trialId, scenarioIds: t.scenarioIds, wallMs: Date.now() - t0, ...k };
    console.log(`${label}: ${k.status} (${k.elapsedMs} ms, exit ${k.exitCode}, cached ${k.cached}) ${k.reason}`);
    out.push(row);
  };
  await runOne('A human rule', 'approved', 'human', false, 9101);
  await runOne('B same rule from AI', 'approved', 'ai', false, 9102);
  await runOne('C canary corrupted page', 'rejected', 'human', true, 9103);
  await runOne('D repeat of A', 'approved (cached)', 'human', false, 9104);
  // E: the real in-game pipeline (human rule, then the AI's whole turn), end-to-end latency.
  process.env.PORT = String(port);
  const { newGame, preview, placeHuman, endHumanTurn, view } = await import('../server/game.ts');
  for (const seed of [11, 12]) {
    const g = newGame(seed);
    g.state.current = 'human'; g.state.phase = 'place'; g.state.actionsLeft = 3;
    const p = await preview(g, '밟으면 남쪽으로 두 칸 밀려난다');
    const cells = view(g).eligible.filter((k: string) => /^[2-4],/.test(k)).slice(0, 3);
    const t0 = Date.now();
    const placed = await placeHuman(g, { token: p.token!, cells });
    const humanMs = Date.now() - t0;
    const t1 = Date.now();
    const end = await endHumanTurn(g);
    const aiMs = Date.now() - t1;
    console.log(`E seed ${seed}: place request returned in ${humanMs} ms (${placed.verdicts[0]?.final}); AI turn returned in ${aiMs} ms. Waiting for background Kane verdicts…`);
    while (g.reviews.some(r => r.verdict.final === 'pending') && Date.now() - t0 < (kaneConfig().timeoutS * 2 + 120) * 1000) await new Promise(r => setTimeout(r, 1000));
    for (const { verdict: vd } of g.reviews) {
      out.push({ label: `E in-game (seed ${seed}) ${vd.player} rule`, expected: 'approved', trialId: vd.trial.trialId, scenarioIds: vd.trial.scenarioIds, wallMs: vd.player === 'human' ? humanMs : aiMs, status: vd.final, activated: vd.activated, placed: vd.placedCells, skipped: vd.skippedCells, proposedTurn: vd.proposedTurn, resolvedTurn: vd.resolvedTurn, elapsedMs: vd.kane?.elapsedMs, exitCode: vd.kane?.exitCode, cached: vd.kane?.cached, conditionResults: vd.kane?.conditionResults, reason: vd.message, evidencePath: vd.kane?.evidencePath, interpretedBy: vd.player === 'human' ? p.interpretation.source : 'see AI decision', decidedBy: vd.decidedBy, tier: vd.tier?.tier ?? null, tierReasons: vd.tier?.reasons ?? null, submitToVerdictMs: vd.timing.submitToVerdictMs, timings: vd.kane?.timings ?? null });
      console.log(`E seed ${seed} ${vd.player}: ${vd.final} by ${vd.decidedBy}${vd.tier ? ` (tier ${vd.tier.tier})` : ''} in ${vd.timing.submitToVerdictMs} ms activated=${vd.activated} on ${vd.placedCells.join(' ') || '-'} (proposed turn ${vd.proposedTurn}, resolved turn ${vd.resolvedTurn}), kane ${vd.kane?.elapsedMs} ms`);
    }
    if (!end.ai?.verdicts.length) console.log(`E seed ${seed}: the AI placed no rule this turn (${end.ai?.decision.plan.chosen})`);
  }
} catch (e) {
  console.log('NOT RUN:', (e as Error).message);
  out.push({ label: 'NOT_RUN', reason: (e as Error).message, probe });
}
const balanceAfter = probe.installed ? balance() : null;
server.close();
await mkdir('evidence/kane', { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const report = { at: new Date().toISOString(), node: process.version, platform: process.platform, probe, refereeTiers: process.env.REFEREE_TIERS === 'on', mode: kaneConfig().mode, timeoutS: kaneConfig().timeoutS, conditions: KANE_CONDITIONS, balanceBefore, balanceAfter, runs: out };
await writeFile(`evidence/kane/live-${stamp}.json`, JSON.stringify(report, null, 2));
const md = [`# Live Kane referee run ${report.at}`, '', `kane-cli ${probe.version ?? 'n/a'} · mode ${report.mode} · ${process.platform}`, '',
  '| Run | Expected | Kane status | Kane time | Exit | Cached | Reason |', '|---|---|---|---|---|---|---|',
  ...out.map(r => `| ${r.label} | ${r.expected ?? ''} | ${r.status ?? 'NOT_RUN'} | ${r.elapsedMs ?? ''} ms | ${r.exitCode ?? ''} | ${r.cached ?? ''} | ${String(r.reason ?? '').replace(/\|/g, '/').slice(0, 200)} |`),
  '', '## Stage timings (ms) for each run that started kane-cli', '',
  '| Run | Cache | Probe | Browser spawn | CDP ready | CLI total | CLI first output | CLI run_end | Parse | Cleanup | Evidence write | Total |', '|---|---|---|---|---|---|---|---|---|---|---|---|',
  ...out.filter(r => r.timings).map(r => { const t = r.timings as Record<string, unknown>; return `| ${r.label} | ${t.cache} | ${t.probeMs ?? ''} | ${t.browserSpawnMs ?? ''} | ${t.cdpReadyMs ?? ''}${t.cdpReady === false ? ' (not ready)' : ''} | ${t.cliMs ?? ''} | ${t.cliFirstOutputMs ?? ''} | ${t.cliRunEndMs ?? ''} | ${t.parseMs ?? ''} | ${t.cleanupMs ?? ''} | ${t.evidenceWriteMs ?? ''} | ${t.totalMs} |`; }),
  '', `Referee tiers: ${report.refereeTiers ? 'ON' : 'off'}. In-game rows: ${out.filter(r => String(r.label).startsWith('E')).map(r => `${r.label} → ${r.decidedBy ?? '?'}${r.tier ? ` tier ${r.tier}` : ''}, ${r.submitToVerdictMs ?? '?'} ms`).join('; ') || 'none'}`,
  '', `Credits before: ${balanceBefore ?? 'n/a'}`, '', `Credits after: ${balanceAfter ?? 'n/a'}`].join('\n');
await writeFile(`evidence/kane/live-${stamp}.md`, md);
console.log(md);
