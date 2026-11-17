/**
 * Real-browser end-to-end test (Playwright + Chromium). Plays complete games through the UI.
 * Run: npm run test:browser   (optionally KANE_DOUBLE=1 to exercise the referee UI with the Kane TEST DOUBLE,
 *      and REFEREE_TIERS=on to check that simple rules are engine-approved and labelled as such)
 */
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { mkdirSync } from 'node:fs';
import assert from 'node:assert/strict';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const root = fileURLToPath(new URL('../../', import.meta.url));
const shots = process.env.SHOTS_DIR || `${root}evidence/browser`;
mkdirSync(shots, { recursive: true });
const port = 3200 + Math.floor(Math.random() * 500);
const useDouble = process.env.KANE_DOUBLE === '1';
const useTiers = process.env.REFEREE_TIERS === 'on';
const timings: string[] = [];
const env = { ...process.env, PORT: String(port), OPENROUTER_API_KEY: '', NVIDIA_API_KEY: '', KANE_REFEREE: useDouble ? 'on' : 'off', KANE_CLI: `${root}tests/fixtures/fake-kane.mjs`, KANE_CHROME: process.env.KANE_CHROME || '/opt/pw-browsers/chromium', KANE_EVIDENCE_DIR: '/tmp/rs-e2e-kane' };
const srv = spawn(process.execPath, ['--experimental-strip-types', '--no-warnings=ExperimentalWarning', 'server/server.ts'], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
await new Promise<void>((res, rej) => { srv.stdout.on('data', (d: Buffer) => { if (String(d).includes('Rule Sabotage on')) res(); }); setTimeout(() => rej(new Error('server did not start')), 15000); });

const results: string[] = [];
const ok = (name: string) => { results.push(`PASS ${name}`); console.log(`PASS ${name}`); };
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1360, height: 1000 } });
  const errors: string[] = [];
  page.on('pageerror', (e: Error) => { errors.push(String(e)); console.log('PAGEERR', e.stack); });
  page.on('console', (m: any) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(`http://127.0.0.1:${port}/`);
  await page.waitForFunction(() => (window as any).__ruleSabotage?.view);
  assert.equal(await page.locator('.cell').count(), 49);
  assert.match(await page.locator('#brain-chip').innerText(), /local planner/);
  await page.waitForFunction(() => !document.getElementById('referee-chip')!.textContent!.includes('…'), null, { timeout: 30000 });
  assert.match(await page.locator('#referee-chip').innerText(), useDouble ? /Kane 0\.0\.0-test-double/ : /engine only/);
  if (useTiers) assert.match(await page.locator('#referee-chip').innerText(), /\+ engine tiers/);
  ok('board renders 49 squares and honest mode labels');

  const getView = () => page.evaluate(() => structuredClone((window as any).__ruleSabotage.view));
  const idle = () => page.waitForFunction(() => { const r = (window as any).__ruleSabotage; return !r.busy && (r.view?.current === "human" || r.view?.winner); }, null, { timeout: 90000 }).catch(async e => { console.log("STUCK", JSON.stringify(await page.evaluate(() => { const r = (window as any).__ruleSabotage; return { busy: r.busy, cur: r.view?.current, phase: r.view?.phase, turn: r.view?.turn, banner: document.getElementById("banner")!.textContent }; })), errors); throw e; });
  await idle();

  // Rejected rule shows a helpful reason
  await page.fill('#rule-input', 'AI만 한 턴 쉰다');
  await page.click('#interpret-btn');
  await page.waitForSelector('.pv-head.reject');
  assert.match(await page.locator('#preview').innerText(), /(every|whoever|모든|누구)/i);
  ok('one-sided rule rejected with explanation (Korean input)');

  // Approximation needs explicit consent; then pick 3 free cells anywhere
  await page.fill('#rule-input', 'Anything entering here is shoved 5 squares north');
  await page.click('#interpret-btn');
  await page.waitForSelector('#pv-approx');
  const v0 = await getView();
  const mid = v0.eligible.filter((k: string) => { const x = Number(k.split(',')[0]); return x >= 2 && x <= 4; });
  const chosen = [mid[0], mid[Math.floor(mid.length / 2)], mid[mid.length - 1]];
  for (const k of chosen) await page.click(`[data-cell="${k}"]`);
  assert.equal(await page.locator('.cell.picked').count(), 3);
  assert.equal(await page.locator('#place-btn').isDisabled(), true, 'cannot place before accepting the approximation');
  await page.check('#pv-approx');
  const placeAt = Date.now();
  await page.click('#place-btn');
  await idle();
  await page.waitForSelector('.verdict');
  if (useDouble && process.env.FAKE_KANE_DELAY_MS) {
    assert.match(await page.locator('#referee').innerText(), /Kane is examining your rule/);
    assert.equal(Object.keys((await getView()).cells).filter(k => chosen.includes(k)).length, 0, 'not live while Kane reviews');
    ok('slow Kane: the rule shows as pending and is not live yet');
  }
  if (useDouble) await page.waitForFunction(() => /Kane approved your rule/.test(document.getElementById('referee')!.innerText), null, { timeout: 60000 });
  else await page.waitForFunction(() => /NOT Kane-verified/.test(document.getElementById('referee')!.innerText), null, { timeout: 60000 });
  timings.push(`approximated rule (always Kane-tier): click → visible final verdict ${Date.now() - placeAt} ms`);
  await idle();
  const refText = await page.locator('#referee').innerText();
  if (useDouble) assert.match(refText, /Kane approved your rule/); else assert.match(refText, /NOT Kane-verified/);
  assert.match(refText, /T\d{4}-S1/);
  const v1 = await getView();
  assert.deepEqual(chosen.filter(k => v1.cells[k]).sort(), [...chosen].sort(), 'all 3 non-adjacent cells are live');
  ok(`approximation required consent; 3 free cells placed through the referee (${useDouble ? 'Kane test double' : 'engine-only'})`);
  await page.screenshot({ path: `${shots}/after-placement.png` });

  // UI must match server state: effects and pieces
  const checkSync = async () => {
    const v = await getView();
    const ui = await page.$$eval('.cell', els => els.map(e => ({ k: (e as HTMLElement).dataset.cell!, trap: /trap-(human|ai)/.exec(e.className)?.[1] ?? null, h: e.querySelectorAll('.token.human').length, a: e.querySelectorAll('.token.ai').length })));
    for (const c of ui) {
      const rid = v.cells[c.k], rule = rid ? v.rules.find((r: any) => r.id === rid) : null;
      assert.equal(c.trap, rule ? rule.owner : null, `effect owner at ${c.k}`);
      const here = v.pieces.filter((q: any) => !q.scored && `${q.x},${q.y}` === c.k);
      assert.equal(c.h, here.some((q: any) => q.owner === 'human') ? 1 : 0, `human token at ${c.k}`);
      assert.equal(c.a, here.some((q: any) => q.owner === 'ai') ? 1 : 0, `ai token at ${c.k}`);
    }
  };
  await checkSync();
  ok('UI effects and pieces match server state');

  // Remove one of our own effects on a later turn, then play to the end by clicking pieces and squares.
  let guard = 0, removed = false, turns = 0;
  while (!(await getView()).winner && guard++ < 400) {
    await idle();
    let v = await getView();
    if (v.winner) break;
    if (v.phase === 'place' && !removed && v.turn > 2 && v.active.human > 0) {
      await page.locator('#human-rules .cellchip').first().click();
      await page.click('#place-btn');
      await idle();
      removed = true;
      assert.ok((await page.locator('#log').innerText()).includes('removed effects'));
      ok('own effect removed for free');
      v = await getView();
    }
    const startTurn = v.turn;
    while (true) {
      v = await getView();
      if (v.winner || v.current !== 'human' || v.turn !== startTurn || !v.legal.length) break;
      const pref = ['right', 'up', 'down', 'left'];
      const m = [...v.legal].sort((a: any, b: any) => pref.indexOf(a.dir) - pref.indexOf(b.dir) || b.from.localeCompare(a.from))[0];
      const [x, y] = m.from.split(',').map(Number), d = ({ up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] } as any)[m.dir];
      await page.click(`[data-cell="${m.from}"]`);
      await page.click(`[data-cell="${x + d[0]},${y + d[1]}"]`);
      await idle();
    }
    v = await getView();
    if (!v.winner && v.current === 'human' && v.turn === startTurn) { await page.click('#end-btn'); await idle(); }
    turns++;
    if (turns % 3 === 0) await checkSync();
  }
  const end = await getView();
  assert.ok(end.winner, 'game reached an end');
  await page.waitForSelector('#gameover:not([hidden])');
  await page.waitForTimeout(600);
  const title = await page.locator('#go-title').innerText();
  await page.screenshot({ path: `${shots}/game-over.png` });
  ok(`full game played to the end in the browser (${title}, ${end.turn} turns)`);
  assert.ok(await page.locator('#log > li').count() >= 2, 'turns logged');
  assert.ok(/Local planner/.test(await page.locator('#log').innerText()), 'AI decisions logged with their source');
  ok('turns logged, with the AI’s decision source');

  await page.keyboard.press('r');
  await page.waitForFunction(() => { const v = (window as any).__ruleSabotage.view; return v && !v.winner && v.turn <= 2; });
  assert.equal(await page.locator('#gameover').isHidden(), true);
  ok('rematch with R starts a fresh game');

  if (useTiers) {
    await idle();
    await page.fill('#rule-input', 'Whoever lands here is frozen for a turn');
    await page.click('#interpret-btn');
    await page.waitForSelector('.pv-head:not(.reject)');
    const vt = await getView();
    const far = vt.eligible.find((k: string) => { const [x, y] = k.split(',').map(Number); return x >= 2 && x <= 4 && !Object.keys(vt.cells).some(c => { const [cx, cy] = c.split(',').map(Number); return Math.abs(cx - x) + Math.abs(cy - y) <= 4; }); }) ?? vt.eligible.find((k: string) => k.startsWith('3,'));
    await page.click(`[data-cell="${far}"]`);
    const t0 = Date.now();
    await page.click('#place-btn');
    await page.waitForFunction(() => /Engine approved your rule \(tier [12], not reviewed by Kane\)/.test(document.getElementById('referee')!.innerText), null, { timeout: 30000 });
    timings.push(`simple rule with tiers on: click → visible engine verdict ${Date.now() - t0} ms`);
    const rt = await page.locator('#referee').innerText();
    assert.ok(!/Kane approved your rule/.test(rt), 'engine approval is never shown as Kane approval');
    assert.ok((await getView()).cells[far], 'live at once');
    ok('referee tiers: a simple rule is engine-approved at once and labelled “not reviewed by Kane”');
  }

  const phone = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  phone.on('pageerror', (e: Error) => errors.push(String(e)));
  await phone.goto(`http://127.0.0.1:${port}/`);
  await phone.waitForFunction(() => { const r = (window as any).__ruleSabotage; return r?.view && !r.busy && r.view.current === 'human'; }, null, { timeout: 60000 });
  const pv = await phone.evaluate(() => (window as any).__ruleSabotage.view);
  const pm = pv.legal.find((m: any) => m.dir === 'right');
  const [px, py] = pm.from.split(',').map(Number);
  await phone.click(`[data-cell="${pm.from}"]`);
  await phone.click(`[data-cell="${px + 1},${py}"]`);
  await phone.waitForFunction(() => (window as any).__ruleSabotage.view.pieces.some((q: any) => q.owner === 'human' && q.x === 1), null, { timeout: 30000 });
  await phone.screenshot({ path: `${shots}/phone.png`, fullPage: true });
  ok('phone-sized viewport is playable');
  assert.deepEqual(errors, [], 'no console/page errors');
  ok('no console or page errors');
} finally {
  await browser.close();
  srv.kill();
}
for (const t of timings) console.log(`TIMING ${t}`);
console.log(`\n${results.length} browser checks passed`);
