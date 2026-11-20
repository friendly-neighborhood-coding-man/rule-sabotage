/**
 * Game-session, AI, provider-failure and referee-plumbing tests.
 * OpenRouter is MOCKED here (setFetch) and Kane is a TEST DOUBLE (tests/fixtures/fake-kane.mjs).
 * These prove our own code paths only; they say nothing about real model or real Kane behaviour.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const FAKE_KANE = fileURLToPath(new URL('./fixtures/fake-kane.mjs', import.meta.url));
const tmp = mkdtempSync(join(tmpdir(), 'rs-test-'));
process.env.RULE_SABOTAGE_NO_LISTEN = '1';
process.env.KANE_EVIDENCE_DIR = join(tmp, 'kane');
process.env.OPENROUTER_LOG = join(tmp, 'or.ndjson');
process.env.KANE_REFEREE = 'off';
delete process.env.OPENROUTER_API_KEY;
delete process.env.NVIDIA_API_KEY;
delete process.env.GROQ_API_KEY;
delete process.env.LLM_PROVIDER;

const { newGame, startGame, preview, placeHuman, moveHuman, endHumanTurn, interpretRule, view, decideAI } = await import('../server/game.ts');
const { setFetch } = await import('../server/openrouter.ts');
const { planTurn } = await import('../server/ai.ts');
const { init, applyPlacement, key } = await import('../server/engine.ts');
const { parseKaneOutput, kaneJudge } = await import('../server/kane.ts');
const { server } = await import('../server/server.ts');
const { buildTrial, renderTrialPage, KANE_CONDITIONS } = await import('../server/trial.ts');
const { makeEffect } = await import('../server/rules.ts');

const mockFetch = (handler: (body: any, url?: string) => { status?: number; json?: unknown; text?: string; headers?: Record<string, string> } | 'hang') =>
  setFetch((async (_url: unknown, init?: { body?: string; signal?: AbortSignal }) => {
    const body = JSON.parse(String(init?.body ?? '{}'));
    const r = handler(body, String(_url));
    if (r === 'hang') return new Promise((_, rej) => init?.signal?.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' }))));
    return new Response(r.text ?? JSON.stringify(r.json ?? {}), { status: r.status ?? 200, headers: r.headers });
  }) as typeof fetch);
const reply = (obj: unknown) => ({ json: { model: 'mock/model', choices: [{ message: { content: JSON.stringify(obj) } }] } });

test('a complete game can be played to the end through the session API', async () => {
  const { g } = await startGame(4242);
  let turns = 0;
  while (!g.state.winner && turns++ < 80) {
    if (g.state.current !== 'human') throw new Error('should be the human’s turn here');
    if (turns % 3 === 1) {
      const p = await preview(g, 'Anything entering here is shoved 1 square south');
      const cells = view(g).eligible.filter((k: string) => k.startsWith('3,')).slice(0, 3);
      if (p.token && cells.length) await placeHuman(g, { token: p.token, cells });
    }
    for (let i = 0; i < 6 && !g.state.winner && g.state.current === 'human'; i++) {
      const legal = view(g).legal;
      if (!legal.length) break;
      moveHuman(g, legal.find((m: any) => m.dir === 'right') ?? legal[0]);
    }
    if (!g.state.winner && g.state.current === 'human') await endHumanTurn(g);
  }
  assert.ok(g.state.winner, 'game finished');
  assert.throws(() => moveHuman(g, { from: '0,1', dir: 'right', mode: 'stack' }), /over/);
});

test('the AI plans only from the public board at the start of its own turn', () => {
  const s = init(31337); s.current = 'ai'; s.phase = 'place';
  const a = planTurn(structuredClone(s), { temperature: 0 }), b = planTurn(structuredClone(s), { temperature: 0 });
  assert.equal(a.chosen.summary, b.chosen.summary, 'same public state -> same plan');
});

test('AI takes a winning sequence when one exists, and sets effects in the human’s path', () => {
  const s = init(5); s.current = 'ai'; s.phase = 'place'; s.actionsLeft = 3;
  for (const [id, y] of [['a1', 1], ['a2', 3], ['a3', 5]] as const) Object.assign(s.pieces.find(q => q.id === id)!, { x: 1, y });
  const plan = planTurn(s, { temperature: 0 });
  assert.equal(plan.chosen.moves.length, 3);
  assert.ok(plan.chosen.moves.every(m => m.dir === 'left'));
  const t = init(8); t.current = 'ai'; t.phase = 'place';
  for (const [id, x] of [['h1', 4], ['h2', 4], ['h3', 4]] as const) Object.assign(t.pieces.find(q => q.id === id)!, { x });
  const p2 = planTurn(t, { temperature: 0 });
  assert.ok(p2.ranked.some(c => c.placement), 'placement candidates were considered');
});

test('AI is not a fixed script: openings vary across games', () => {
  const firsts = new Set<string>();
  for (let seed = 1; seed <= 12; seed++) { const s = init(seed); s.current = 'ai'; firsts.add(planTurn(s).chosen.summary); }
  assert.ok(firsts.size >= 3, `only ${firsts.size} distinct openings`);
});

test('an AI rule goes through the same interpreter and referee as a human rule', async () => {
  const { g } = await startGame(9);
  if (g.state.current === 'human') await endHumanTurn(g);
  const last = g.history.filter(h => h.p === 'ai').pop()!;
  for (const v of last.verdicts) { assert.equal(v.player, 'ai'); assert.ok(v.trial.scenarioIds.length >= 1); assert.ok(v.final === 'engine-approved' ? v.activated && v.decidedBy === 'engine' : v.final === 'unverified' && !v.activated, `engine-only mode: tier 1/2 engine-approved and live, tier 3 unverified and NOT live (${v.final}, activated ${v.activated})`); }
  if (last.verdicts.length) { assert.ok(last.ai?.ruleTextSource, 'AI rule text was checked against the planned effect'); assert.equal(last.verdicts[0].ruleText, last.ai!.ruleText); }
});

test('trial: symmetric outcome for a human and an AI piece, no re-fire, no softlock', () => {
  const s = init(3); s.current = 'human'; s.phase = 'place';
  const t = buildTrial(s, 'human', { text: 'shoved 2 north', effect: makeEffect('shove', 'north', 2), cells: ['3,3', '2,5', '5,0'], interpretedBy: 'test' }, 9100);
  assert.equal(t.symmetry.length, 3);
  for (const r of t.symmetry) { assert.ok(r.identical, JSON.stringify(r)); assert.ok(r.human.fired && r.ai.fired); assert.ok(!r.secondVisitFired.human && !r.secondVisitFired.ai); }
  assert.ok(t.engineChecks.every(c => c.pass), JSON.stringify(t.engineChecks));
  assert.equal(t.scenarioIds.length, 4);
  // Same placement proposed by the AI: identical checks (equal scrutiny).
  const s2 = structuredClone(s); s2.current = 'ai';
  const t2 = buildTrial(s2, 'ai', { text: 'shoved 2 north', effect: makeEffect('shove', 'north', 2), cells: ['3,3', '2,5', '5,0'], interpretedBy: 'test' }, 9101);
  assert.deepEqual(t2.engineChecks.map(c => c.pass), t.engineChecks.map(c => c.pass));
  const html = renderTrialPage(t);
  assert.ok(!/<script/i.test(html));
  assert.match(html, /T9100-S1/);
});

test('trial: an illegal placement fails the engine check (no overwriting the opponent)', () => {
  const s = init(3); s.current = 'ai'; s.phase = 'place';
  applyPlacement(s, 'ai', { text: 'x', effect: makeEffect('freeze'), cells: ['3,3'], interpretedBy: 'test' });
  s.current = 'human'; s.phase = 'place';
  const t = buildTrial(s, 'human', { text: 'y', effect: makeEffect('haste'), cells: ['3,3'], interpretedBy: 'test' }, 9102);
  assert.equal(t.engineChecks.find(c => c.id === 'E1')!.pass, false);
  void key;
});

test('OpenRouter (mocked): valid reply is used and labelled as OpenRouter', async () => {
  process.env.OPENROUTER_API_KEY = 'test-key-not-real';
  mockFetch(() => reply({ status: 'ok', kind: 'freeze', dir: 'none', amount: 1, note: '' }));
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
    ['empty 1', () => ({ json: { model: 'some/thinking-model', choices: [{ message: { content: '' }, finish_reason: 'length' }] } }), /empty model reply \(model some\/thinking-model, finish_reason length\)/],
    ['server error 1', () => ({ status: 500, text: 'boom' }), /http_error|rate_limited/],
    ['wrong shape 1', () => reply({ status: 'ok', kind: 'nuke', dir: 'none', amount: 1, note: '' }), /invalid model output|rate_limited/],
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

test('OpenRouter (mocked): structured-output rejection or an empty reply retries once with plain JSON; reasoning is kept short', async () => {
  process.env.OPENROUTER_API_KEY = 'test-key-not-real';
  let calls = 0, sawReasoning = false;
  mockFetch(body => { calls++; sawReasoning ||= body.reasoning?.effort === 'low'; return body.response_format ? { status: 400, text: 'response_format json_schema not supported' } : reply({ status: 'ok', kind: 'shield', dir: 'none', amount: 1, note: '' }); });
  const r = await interpretRule('mock: you get a bubble shield');
  assert.equal(calls, 2); assert.ok(sawReasoning);
  assert.equal(r.interpretation.status, 'ok');
  calls = 0;
  mockFetch(body => { calls++; return body.response_format ? { json: { choices: [{ message: { content: '' }, finish_reason: 'length' }] } } : reply({ status: 'ok', kind: 'teleport', dir: 'none', amount: 1, note: '' }); });
  const r2 = await interpretRule('mock: warp somewhere');
  assert.equal(calls, 2);
  assert.equal(r2.interpretation.source, 'openrouter');
  delete process.env.OPENROUTER_API_KEY;
});

test('NVIDIA provider (mocked): OpenAI-compatible endpoint, labelled, no OpenRouter-only parameters, key never in the body', async () => {
  process.env.NVIDIA_API_KEY = 'nv-test-key-not-real';
  process.env.NVIDIA_BASE_URL = 'https://integrate.api.nvidia.com/v1';
  let url = '', body: any = null;
  mockFetch((b, u) => { url = u!; body = b; return reply({ status: 'ok', kind: 'haste', dir: 'none', amount: 1, note: '' }); });
  const { providerLabel, modelName } = await import('../server/openrouter.ts');
  assert.equal(providerLabel(), 'NVIDIA');
  assert.equal(modelName(), 'nvidia/nemotron-3.5-bolt-e4b');
  const r = await interpretRule('mock nvidia: one more move');
  assert.equal(url, 'https://integrate.api.nvidia.com/v1/chat/completions');
  assert.equal(body.reasoning, undefined);
  assert.ok(!JSON.stringify(body).includes('nv-test-key'));
  assert.equal(r.interpretation.source, 'openrouter');
  process.env.NVIDIA_BASE_URL = 'http://insecure.example/v1';
  assert.equal(providerLabel(), 'none', 'non-https base URL is refused');
  delete process.env.NVIDIA_API_KEY; delete process.env.NVIDIA_BASE_URL;
});

test('Default provider order follows the benchmark: NVIDIA, then Groq, then OpenRouter; LLM_PROVIDER overrides', async () => {
  const { providerLabel } = await import('../server/openrouter.ts');
  process.env.OPENROUTER_API_KEY = 'or-x'; process.env.GROQ_API_KEY = 'gq-x'; process.env.NVIDIA_API_KEY = 'nv-x';
  assert.equal(providerLabel(), 'NVIDIA');
  delete process.env.NVIDIA_API_KEY; assert.equal(providerLabel(), 'Groq');
  delete process.env.GROQ_API_KEY; assert.equal(providerLabel(), 'OpenRouter');
  process.env.NVIDIA_API_KEY = 'nv-x'; process.env.LLM_PROVIDER = 'openrouter'; assert.equal(providerLabel(), 'OpenRouter');
  delete process.env.OPENROUTER_API_KEY; delete process.env.NVIDIA_API_KEY; delete process.env.LLM_PROVIDER;
});

test('Groq provider (mocked): strict JSON schema adapted, reasoning kept out of content, opponent choice limited to real options', async () => {
  process.env.GROQ_API_KEY = 'gq-test-key-not-real';
  process.env.LLM_PROVIDER = 'groq';
  process.env.GROQ_MODEL = 'openai/gpt-oss-20b';
  const bodies: any[] = []; let url = '';
  mockFetch((b, u) => {
    url = u!; bodies.push(b);
    if (b.messages[0].content.includes('You are the AI player')) return reply({ choice: b.response_format.json_schema.schema.properties.choice.enum[0], ruleText: '', taunt: 't', rationale: 'r' });
    return reply({ status: 'ok', kind: 'shove', dir: 'west', amount: 2, note: '' });
  });
  const { providerLabel } = await import('../server/openrouter.ts');
  assert.equal(providerLabel(), 'Groq');
  const r = await interpretRule('mock groq: blown west 2 squares');
  assert.equal(url, 'https://api.groq.com/openai/v1/chat/completions');
  const b = bodies[0];
  assert.equal(b.reasoning_effort, 'low'); assert.equal(b.include_reasoning, false); assert.equal(b.reasoning, undefined);
  const sch = b.response_format.json_schema;
  assert.equal(sch.strict, true);
  assert.equal(sch.schema.additionalProperties, false);
  assert.deepEqual([...sch.schema.required].sort(), Object.keys(sch.schema.properties).sort());
  assert.equal(sch.schema.properties.amount.enum, undefined, 'integer enum removed for Groq strict mode');
  assert.ok(!JSON.stringify(bodies).includes('gq-test-key'));
  assert.equal(r.interpretation.status, 'ok');
  if (r.interpretation.status === 'ok') assert.deepEqual(r.interpretation.effect, { kind: 'shove', dir: 'west', amount: 2 });
  const s = init(42); s.current = 'ai';
  const d = await decideAI(s);
  assert.equal(d.decision.source, 'openrouter'); assert.equal(d.decision.provider, 'Groq');
  const opp = bodies.find(x => x.messages[0].content.includes('You are the AI player'));
  assert.ok(opp.response_format.json_schema.schema.properties.choice.enum.length >= 1, 'choice is an enum of real option ids');
  delete process.env.GROQ_API_KEY; delete process.env.LLM_PROVIDER; delete process.env.GROQ_MODEL;
});

test('OpenRouter (mocked) opponent: unknown option ids are refused and the local planner takes over', async () => {
  process.env.OPENROUTER_API_KEY = 'test-key-not-real';
  mockFetch(() => reply({ choice: 'p999', ruleText: '', taunt: 'hi', rationale: 'x' }));
  const s = init(99); s.current = 'ai';
  const d = await decideAI(s);
  assert.equal(d.decision.source, 'local-planner');
  assert.match(String(d.decision.fallbackReason), /unknown option/);
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

test('a missing browser binary gives an unverified verdict instead of crashing', async () => {
  process.env.KANE_REFEREE = 'on';
  process.env.KANE_CLI = FAKE_KANE;
  process.env.KANE_CHROME = join(tmp, 'no-such-browser');
  process.env.FAKE_KANE_MODE = 'approve';
  try {
    const r = await kaneJudge({ trialId: 'T9200', signature: 'sig-nobrowser', url: 'http://127.0.0.1:1/trial/T9200', html: '<p>x</p>', conditions: KANE_CONDITIONS });
    assert.equal(r.status, 'unverified');
    assert.match(r.reason, /could not start/);
  } finally { process.env.KANE_REFEREE = 'off'; delete process.env.KANE_CHROME; delete process.env.FAKE_KANE_MODE; }
});

const chrome = process.env.KANE_CHROME_TEST || ['/opt/pw-browsers/chromium', 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', '/usr/bin/chromium'].find(p => existsSync(p));
test('referee plumbing with a Kane TEST DOUBLE: approve, reject, garbage=unverified, cache', { skip: chrome ? false : 'no Chrome/Edge binary found for the trial page' }, async () => {
  await new Promise<void>(r => server.listen(0, '127.0.0.1', () => r()));
  const port = (server.address() as { port: number }).port;
  process.env.PORT = String(port);
  process.env.KANE_REFEREE = 'on';
  process.env.KANE_CLI = FAKE_KANE;
  process.env.KANE_CHROME = chrome!;
  try {
    const s = init(3); s.current = 'human'; s.phase = 'place';
    const trial = buildTrial(s, 'human', { text: 'pushed back one', effect: makeEffect('shove', 'back', 1), cells: ['3,3'], interpretedBy: 'test' }, 9001);
    assert.ok(trial.engineChecks.every(c => c.pass), JSON.stringify(trial.engineChecks));
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
  } finally {
    process.env.KANE_REFEREE = 'off';
    delete process.env.FAKE_KANE_MODE; delete process.env.KANE_CHROME;
    await new Promise(r => server.close(() => r(null)));
  }
});

test('slow Kane (test double): the rule is pending, play continues, and it goes live only after approval', { skip: chrome ? false : 'no Chrome/Edge binary found for the trial page' }, async () => {
  await new Promise<void>(r => server.listen(0, '127.0.0.1', () => r()));
  process.env.PORT = String((server.address() as { port: number }).port);
  process.env.KANE_REFEREE = 'on'; process.env.KANE_CLI = FAKE_KANE; process.env.KANE_CHROME = chrome!;
  process.env.FAKE_KANE_MODE = 'approve'; process.env.FAKE_KANE_DELAY_MS = '2500';
  try {
    const g = newGame(777);
    g.state.current = 'human'; g.state.phase = 'place';
    const p = await preview(g, 'Anything entering here is shoved one square south');
    const cells = ['3,0', '3,2', '3,4'];
    const res = await placeHuman(g, { token: p.token!, cells });
    assert.equal(res.verdicts[0].final, 'pending');
    assert.equal(Object.keys(g.state.cells).length, 0, 'not live while Kane is reviewing');
    moveHuman(g, view(g).legal[0]); // the game goes on
    const t0 = Date.now();
    while (g.reviews[0].verdict.final === 'pending' && Date.now() - t0 < 20000) await new Promise(r => setTimeout(r, 200));
    const v = g.reviews[0].verdict;
    assert.equal(v.final, 'approved', v.message);
    assert.ok(v.activated);
    assert.deepEqual(Object.keys(g.state.cells).sort(), [...cells].filter(k => !g.state.pieces.some(q => !q.scored && `${q.x},${q.y}` === k)).sort());
    assert.ok(view(g).reviews.some((r: any) => r.reviewId === v.reviewId && r.events.some((e: any) => e.t === 'place')));
  } finally {
    process.env.KANE_REFEREE = 'off'; delete process.env.FAKE_KANE_MODE; delete process.env.FAKE_KANE_DELAY_MS; delete process.env.KANE_CHROME;
    await new Promise(r => server.close(() => r(null)));
  }
});

test('unverified rules do not go live in Kane mode (Kane missing)', async () => {
  process.env.KANE_REFEREE = 'on';
  process.env.KANE_CLI = join(tmp, 'no-such-kane-cli');
  try {
    const g = newGame(1234);
    g.state.current = 'human'; g.state.phase = 'place';
    assert.equal(g.refereeMode, 'kane');
    const p = await preview(g, 'Whoever lands here is frozen for a turn');
    const cells = view(g).eligible.slice(10, 13);
    const res = await placeHuman(g, { token: p.token!, cells });
    assert.equal(res.verdicts[0].final, 'unverified');
    assert.equal(res.verdicts[0].activated, false);
    assert.equal(Object.keys(g.state.cells).length, 0, 'rule not activated');
    assert.ok(res.events.every(e => e.t !== 'place'));
  } finally { process.env.KANE_REFEREE = 'off'; }
});
