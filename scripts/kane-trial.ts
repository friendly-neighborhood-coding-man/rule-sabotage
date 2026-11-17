/**
 * Live Kane referee measurement (REAL kane-cli, no doubles).
 *   npm run kane:trial            -> runs the scenarios below, writes evidence/kane/live-<ts>.json + .md
 * Scenarios:
 *   A  normal human rule (push back 2 on 2 squares)          expected: approved
 *   B  same rule proposed by the AI (equal scrutiny)          expected: approved
 *   C  CANARY: page deliberately corrupted to show a square
 *      firing twice + a 2-turn lock (simulated engine bug)    expected: rejected
 *   D  repeat of A (cache)                                    expected: cached verdict, ~0 ms
 * Only real Kane output is recorded; failures are reported as unverified.
 */
import { writeFile, mkdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
process.env.RULE_SABOTAGE_NO_LISTEN = '1';
const { server } = await import('../server/server.ts');
const { trials } = await import('../server/game.ts');
const { buildTrial, renderTrialPage, KANE_CONDITIONS } = await import('../server/trial.ts');
const { kaneJudge, kaneProbe, kaneConfig } = await import('../server/kane.ts');
const { init } = await import('../server/engine.ts');
const { normalizeEffect } = await import('../server/rules.ts');

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
  const s = init(2024);
  s.positions = { human: { x: 2, y: 3 }, ai: { x: 5, y: 3 } };
  s.shape = { kind: 'column', name: 'Column D', cells: ['3,0', '3,1', '3,2', '3,3', '3,4', '3,5', '3,6'] };
  const rule = { op: 'place' as const, text: 'Anyone stepping here gets pushed backward two spaces!', effect: normalizeEffect('push', 2), cells: ['3,3', '3,4'], interpretedBy: 'live-trial' };
  const runOne = async (label: string, expected: string, proposer: 'human' | 'ai', corrupt = false, n: number) => {
    const t = buildTrial(s, proposer, { ...rule, text: proposer === 'ai' ? 'Step here and you get pushed back 2 spaces. Nothing personal.' : rule.text }, n);
    if (corrupt) {
      t.triggers[0].secondVisitFired = true;
      t.rollout.maxConsecutiveTurnsLost.human = 2;
      t.signature = 'canary-' + t.signature;
    }
    const html = renderTrialPage(t);
    trials.set(t.trialId, { trial: t, html });
    const t0 = Date.now();
    const k = await kaneJudge({ trialId: t.trialId, signature: t.signature, url: `http://127.0.0.1:${port}/trial/${t.trialId}`, html, conditions: KANE_CONDITIONS });
    const row = { label, expected, trialId: t.trialId, scenarioIds: [...t.triggers.map(x => x.scenarioId), t.rollout.scenarioId], wallMs: Date.now() - t0, ...k };
    console.log(`${label}: ${k.status} (${k.elapsedMs} ms, exit ${k.exitCode}, cached ${k.cached}) ${k.reason}`);
    out.push(row);
  };
  await runOne('A human rule', 'approved', 'human', false, 9101);
  await runOne('B same rule from AI', 'approved', 'ai', false, 9102);
  await runOne('C canary corrupted page', 'rejected', 'human', true, 9103);
  await runOne('D repeat of A', 'approved (cached)', 'human', false, 9104);
} catch (e) {
  console.log('NOT RUN:', (e as Error).message);
  out.push({ label: 'NOT_RUN', reason: (e as Error).message, probe });
}
const balanceAfter = probe.installed ? balance() : null;
server.close();
await mkdir('evidence/kane', { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const report = { at: new Date().toISOString(), node: process.version, platform: process.platform, probe, mode: kaneConfig().mode, timeoutS: kaneConfig().timeoutS, conditions: KANE_CONDITIONS, balanceBefore, balanceAfter, runs: out };
await writeFile(`evidence/kane/live-${stamp}.json`, JSON.stringify(report, null, 2));
const md = [`# Live Kane referee run ${report.at}`, '', `kane-cli ${probe.version ?? 'n/a'} · mode ${report.mode} · ${process.platform}`, '',
  '| Run | Expected | Kane status | Kane time | Exit | Cached | Reason |', '|---|---|---|---|---|---|---|',
  ...out.map(r => `| ${r.label} | ${r.expected ?? ''} | ${r.status ?? 'NOT_RUN'} | ${r.elapsedMs ?? ''} ms | ${r.exitCode ?? ''} | ${r.cached ?? ''} | ${String(r.reason ?? '').replace(/\|/g, '/').slice(0, 200)} |`),
  '', `Credits before: ${balanceBefore ?? 'n/a'}`, '', `Credits after: ${balanceAfter ?? 'n/a'}`].join('\n');
await writeFile(`evidence/kane/live-${stamp}.md`, md);
console.log(md);
