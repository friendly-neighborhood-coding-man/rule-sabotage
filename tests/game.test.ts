/**
 * Game-session, AI-information, provider-failure and referee-plumbing tests.
 * OpenRouter is MOCKED here (setFetch) and Kane is a TEST DOUBLE (tests/fixtures/fake-kane.mjs).
 * These prove our own code paths only; they say nothing about real model or real Kane behaviour.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const FAKE_KANE = fileURLToPath(new URL('./fixtures/fake-kane.mjs', import.meta.url));
const tmp = mkdtempSync(join(tmpdir(), 'rs-test-'));
process.env.RULE_SABOTAGE_NO_LISTEN = '1';
process.env.KANE_EVIDENCE_DIR = join(tmp, 'kane');
process.env.OPENROUTER_LOG = join(tmp, 'or.ndjson');
process.env.KANE_REFEREE = 'off';
delete process.env.OPENROUTER_API_KEY;

const { newGame, playTurn, preview, interpretRule, view } = await import('../server/game.ts');
const { setFetch } = await import('../server/openrouter.ts');
const { planAI } = await import('../server/ai.ts');
const { init, resolveRound } = await import('../server/engine.ts');
const { parseKaneOutput, kaneJudge } = await import('../server/kane.ts');
const { server } = await import('../server/server.ts');
const { buildTrial, renderTrialPage, KANE_CONDITIONS } = await import('../server/trial.ts');
const { normalizeEffect } = await import('../server/rules.ts');

const mockFetch = (handler: (body: any) => { status?: number; json?: unknown; text?: string; headers?: Record<string, string> } | 'hang') =>
  setFetch((async (_url: unknown, init?: { body?: string; signal?: AbortSignal }) => {
    const body = JSON.parse(String(init?.body ?? '{}'));
    const r = handler(body);
    if (r === 'hang') return new Promise((_, rej) => init?.signal?.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' }))));
    return new Response(r.text ?? JSON.stringify(r.json ?? {}), { status: r.status ?? 200, headers: r.headers });
  }) as typeof fetch);
const reply = (obj: unknown) => ({ json: { model: 'mock/model', choices: [{ message: { content: JSON.stringify(obj) } }] } });

test('a complete game can be played to the end through the session API, then rematched', async () => {
  const g = newGame(4242);
  let rounds = 0;
  while (!g.state.winner && rounds < 25) {
    const v = view(g);
    let rule: any = { op: 'none' };
    if (rounds % 3 === 0 && v.eligible.length) {
      const p = await preview(g, 'Anyone stepping here gets pushed back one square');
      rule = { op: 'place', token: p.token, cells: v.eligible.slice(0, 1), ...(v.rules.human.length >= v.slots ? { slot: 0 } : {}) };
    }
    const move = v.status.human.skip ? 'hold' : 'right';
    try { await playTurn(g, { move, rule }); } catch { await playTurn(g, { move: 'up', rule: { op: 'none' } }); }
    rounds++;
  }
  assert.ok(g.state.winner, 'game finished');
  await assert.rejects(playTurn(g, { move: 'right', rule: { op: 'none' } }), /over/);
  const g2 = newGame();
  assert.equal(g2.state.round, 1);
  assert.equal(g2.state.winner, null);
});

test('the AI never receives the human’s action: its decision is fixed before the human moves', async () => {
  const a = newGame(31337), b = newGame(31337);
  const da = await a.aiDecision, db = await b.aiDecision;
  assert.deepEqual(da.action, db.action, 'same public state -> same AI decision');
  const ra = await playTurn(a, { move: 'right', rule: { op: 'none' } });
  const rb = await playTurn(b, { move: 'down', rule: { op: 'none' } });
  assert.equal(ra.result.ai.action, rb.result.ai.action, 'AI action identical no matter what the human did');
  assert.equal(ra.result.ai.decidedAt, da.decidedAt);
});

test('AI takes a winning move when one exists and uses traps to ambush', () => {
  const s = init(5);
  s.positions = { human: { x: 2, y: 3 }, ai: { x: 1, y: 3 } };
  s.firstPriority = 'ai';
  const plan = planAI(s, { temperature: 0 });
  assert.equal(plan.chosen.action.move, 'left');
  const t = init(8);
  t.positions = { human: { x: 2, y: 3 }, ai: { x: 5, y: 3 } };
  t.shape = { kind: 'column', name: 'C', cells: ['3,0', '3,1', '3,2', '3,3', '3,4', '3,5', '3,6'] };
  const p2 = planAI(t, { temperature: 0 });
  assert.equal(p2.chosen.action.rule.op, 'place', 'AI sets a trap in the human’s path');
  assert.ok(p2.chosen.action.rule.op === 'place' && p2.chosen.action.rule.cells.includes('3,3'));
});

test('AI is not a fixed script: decisions vary across games', () => {
  const firsts = new Set<string>();
  for (let seed = 1; seed <= 12; seed++) { const s = init(seed); firsts.add(JSON.stringify(planAI(s).chosen.action)); }
  assert.ok(firsts.size >= 3, `only ${firsts.size} distinct openings`);
});

test('OpenRouter (mocked): valid reply is used and labelled as OpenRouter', async () => {
  process.env.OPENROUTER_API_KEY = 'test-key-not-real';
  mockFetch(() => reply({ status: 'ok', kind: 'skip', amount: 1, note: '' }));
  const r = await interpretRule('mock check: whoever lands here naps');
  assert.equal(r.interpretation.source, 'openrouter');
  assert.equal(r.fallback, null);
  delete process.env.OPENROUTER_API_KEY;
});

test('OpenRouter (mocked) failures fall back to the labelled offline parser', async () => {
  process.env.OPENROUTER_API_KEY = 'test-key-not-real';
  const cases: [string, Parameters<typeof mockFetch>[0], RegExp][] = [
    ['rate limit 1', () => ({ status: 429, headers: { 'retry-after': '1' }, text: 'slow down' }), /rate_limited/],
    ['bad json 1', () => ({ json: { choices: [{ message: { content: 'sure! push 2' } }] } }), /invalid_json|rate_limited/],
    ['server error 1', () => ({ status: 500, text: 'boom' }), /http_error|rate_limited/],
    ['wrong shape 1', () => reply({ status: 'ok', kind: 'nuke', amount: 1, note: '' }), /invalid model output|rate_limited/],
  ];
  for (const [label, h, re] of cases) {
    mockFetch(h);
    const r = await interpretRule(`Pushed back two squares (${label})`);
    assert.equal(r.interpretation.source, 'offline-parser', label);
    assert.match(String(r.fallback), re, label);
    await new Promise(res => setTimeout(res, label.startsWith('rate') ? 1100 : 0));
  }
  delete process.env.OPENROUTER_API_KEY;
});

test('OpenRouter (mocked): structured-output rejection retries once with plain JSON', async () => {
  process.env.OPENROUTER_API_KEY = 'test-key-not-real';
  let calls = 0;
  mockFetch(body => { calls++; return body.response_format ? { status: 400, text: 'response_format json_schema not supported' } : reply({ status: 'ok', kind: 'reverse', amount: 1, note: '' }); });
  const r = await interpretRule('mock: controls go backwards next time');
  assert.equal(calls, 2);
  assert.equal(r.interpretation.status, 'ok');
  delete process.env.OPENROUTER_API_KEY;
});

test('OpenRouter (mocked) opponent: unknown option ids are refused and the local planner takes over', async () => {
  process.env.OPENROUTER_API_KEY = 'test-key-not-real';
  mockFetch(body => body.messages[0].content.includes('You are the AI player') ? reply({ choice: 'c999', ruleText: '', taunt: 'hi', rationale: 'x' }) : reply({ status: 'ok', kind: 'push', amount: 1, note: '' }));
  const g = newGame(99);
  const d = await g.aiDecision;
  assert.equal(d.source, 'local-planner');
  assert.match(String(d.fallbackReason), /unknown option/);
  delete process.env.OPENROUTER_API_KEY;
});

test('Kane output parser only accepts a complete run_end verdict', () => {
  const ok = '{"type":"run_start"}\n{"type":"run_end","status":"passed","condition_results":[true,true],"condition_reasons":["a","b"]}';
  assert.equal(parseKaneOutput(ok, 2, 'analyzer').verdict, 'approved');
  assert.equal(parseKaneOutput(ok.replace('[true,true]', '[true,false]'), 2, 'analyzer').verdict, 'rejected');
  assert.equal(parseKaneOutput(ok.replace('[true,true]', '[true,null]'), 2, 'analyzer').verdict, null, 'timed-out condition = no verdict');
  assert.equal(parseKaneOutput(ok, 3, 'analyzer').verdict, null, 'wrong count = no verdict');
  assert.equal(parseKaneOutput('garbage', 2, 'analyzer').verdict, null);
});

test('referee plumbing with a Kane TEST DOUBLE: approve, reject, timeout=unverified, cache', async () => {
  await new Promise<void>(r => server.listen(0, '127.0.0.1', () => r()));
  const port = (server.address() as { port: number }).port;
  process.env.PORT = String(port);
  process.env.KANE_REFEREE = 'on';
  process.env.KANE_CLI = FAKE_KANE;
  process.env.KANE_CHROME = '/opt/pw-browsers/chromium';
  try {
    const s = init(3); s.positions = { human: { x: 2, y: 3 }, ai: { x: 5, y: 3 } };
    s.shape = { kind: 'column', name: 'D', cells: ['3,2', '3,3', '3,4'] };
    const rule = { op: 'place' as const, text: 'pushed back one', effect: normalizeEffect('push', 1), cells: ['3,3'], interpretedBy: 'test' };
    const trial = buildTrial(s, 'human', rule, 9001);
    assert.ok(trial.engineChecks.every(c => c.pass), JSON.stringify(trial.engineChecks));
    assert.equal(trial.triggers.filter(t => t.fired).length, 2, 'both players trigger it in the sandbox');
    const html = renderTrialPage(trial);
    const { trials } = await import('../server/game.ts');
    trials.set(trial.trialId, { trial, html });
    const url = `http://127.0.0.1:${port}/trial/${trial.trialId}`;
    process.env.FAKE_KANE_MODE = 'approve';
    const a = await kaneJudge({ trialId: trial.trialId, signature: 'sig-a', url, html, conditions: KANE_CONDITIONS });
    assert.equal(a.status, 'approved', a.reason);
    assert.equal(a.conditionResults.length, KANE_CONDITIONS.length);
    const cached = await kaneJudge({ trialId: trial.trialId, signature: 'sig-a', url, html, conditions: KANE_CONDITIONS });
    assert.equal(cached.cached, true);
    process.env.FAKE_KANE_MODE = 'reject';
    const r = await kaneJudge({ trialId: trial.trialId, signature: 'sig-r', url, html, conditions: KANE_CONDITIONS });
    assert.equal(r.status, 'rejected');
    process.env.FAKE_KANE_MODE = 'garbage';
    const u = await kaneJudge({ trialId: trial.trialId, signature: 'sig-g', url, html, conditions: KANE_CONDITIONS });
    assert.equal(u.status, 'unverified');
    process.env.KANE_CLI = '/nonexistent/kane-cli';
    const { kaneProbe } = await import('../server/kane.ts');
    void kaneProbe;
  } finally {
    process.env.KANE_REFEREE = 'off';
    delete process.env.FAKE_KANE_MODE;
    await new Promise(r => server.close(() => r(null)));
  }
});

test('unverified rules do not go live in Kane mode (Kane missing)', async () => {
  process.env.KANE_REFEREE = 'on';
  process.env.KANE_CLI = '/nonexistent/kane-cli-' + Date.now();
  const g = newGame(1234);
  assert.equal(g.refereeMode, 'kane');
  const v = view(g);
  const p = await preview(g, 'Whoever lands here loses their next turn');
  const res = await playTurn(g, { move: 'right', rule: { op: 'place', token: p.token!, cells: v.eligible.slice(0, 1) } });
  const mine = res.result.verdicts.find(x => x.player === 'human')!;
  assert.equal(mine.final, 'unverified');
  assert.equal(mine.activated, false);
  assert.equal(g.state.rules.human.length, 0, 'rule not activated');
  assert.ok(res.result.events.every(e => e.t !== 'place' || e.p !== 'human'));
  process.env.KANE_REFEREE = 'off';
  void resolveRound;
});
