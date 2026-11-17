/**
 * Real-browser end-to-end test (Playwright + Chromium). Plays complete games through the UI.
 * Run: npm run test:browser   (optionally KANE_DOUBLE=1 to exercise the referee UI with the Kane TEST DOUBLE)
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
const env = { ...process.env, PORT: String(port), OPENROUTER_API_KEY: '', KANE_REFEREE: useDouble ? 'on' : 'off', KANE_CLI: `${root}tests/fixtures/fake-kane.mjs`, KANE_CHROME: process.env.KANE_CHROME || '/opt/pw-browsers/chromium', KANE_EVIDENCE_DIR: '/tmp/rs-e2e-kane' };
const srv = spawn(process.execPath, ['--experimental-strip-types', '--no-warnings=ExperimentalWarning', 'server/server.ts'], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
await new Promise<void>((res, rej) => { srv.stdout.on('data', (d: Buffer) => { if (String(d).includes('Rule Sabotage on')) res(); }); setTimeout(() => rej(new Error('server did not start')), 15000); });

const results: string[] = [];
const ok = (name: string) => { results.push(`PASS ${name}`); console.log(`PASS ${name}`); };
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1360, height: 1000 } });
  const errors: string[] = [];
  page.on('pageerror', (e: Error) => errors.push(String(e)));
  page.on('console', (m: any) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(`http://127.0.0.1:${port}/`);
  await page.waitForFunction(() => (window as any).__ruleSabotage?.view);
  assert.equal(await page.locator('.cell').count(), 49);
  assert.match(await page.locator('#brain-chip').innerText(), /local planner/);
  assert.match(await page.locator('#referee-chip').innerText(), useDouble ? /Kane CLI 0\.0\.0-test-double/ : /engine only/);
  ok('board renders 49 squares and honest mode labels');

  const getView = () => page.evaluate(() => structuredClone((window as any).__ruleSabotage.view));
  const idle = () => page.waitForFunction(() => !(window as any).__ruleSabotage.busy && !document.querySelector('.mv[data-move="hold"]')?.hasAttribute('disabled') || !!(window as any).__ruleSabotage.view?.winner, null, { timeout: 60000 });

  // Rejected rule shows a helpful reason
  await page.fill('#rule-input', 'AI만 한 턴 쉰다');
  await page.click('#interpret-btn');
  await page.waitForSelector('.pv-head.reject');
  assert.match(await page.locator('#preview').innerText(), /whoever steps on it/i);
  ok('one-sided rule rejected with explanation (Korean input)');

  // Approximation needs explicit consent
  await page.fill('#rule-input', 'Anyone stepping here gets pushed back 5 squares');
  await page.click('#interpret-btn');
  await page.waitForSelector('#pv-approx');
  const v0 = await getView();
  await page.click(`[data-cell="${v0.eligible[0]}"]`);
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(300);
  assert.equal((await getView()).round, 1, 'turn not committed without consent');
  await page.check('#pv-approx');
  await page.click('.mv.right');
  await idle();
  const v1 = await getView();
  assert.equal(v1.round, 2);
  assert.ok(await page.locator('.verdict').count() >= 1, 'referee verdict shown');
  if (useDouble) assert.match(await page.locator('#referee').innerText(), /approved by Kane/);
  else assert.match(await page.locator('#referee').innerText(), /NOT Kane-verified/);
  ok(`approximation required consent; rule went through the referee panel (${useDouble ? 'Kane test double' : 'engine-only'})`);
  await page.screenshot({ path: `${shots}/after-round-1.png` });

  // UI must match server state: traps and tokens
  const checkSync = async () => {
    const v = await getView();
    const trapCells = new Set<string>([...v.rules.human, ...v.rules.ai].flatMap((r: any) => r.cells));
    const uiTraps = new Set<string>(await page.$$eval('.cell.trap', els => els.map(e => (e as HTMLElement).dataset.cell!)));
    assert.deepEqual([...uiTraps].sort(), [...trapCells].sort(), 'trap squares in UI == server');
    for (const p of ['human', 'ai']) {
      const at = await page.evaluate((p: string) => {
        const t = document.getElementById(`token-${p}`)!.getBoundingClientRect();
        const cx = t.left + t.width / 2, cy = t.top + t.height / 2;
        const c = [...document.querySelectorAll('.cell')].find(el => { const r = el.getBoundingClientRect(); return cx >= r.left - 9 && cx <= r.right + 9 && cy >= r.top && cy <= r.bottom; }) as HTMLElement;
        return c?.dataset.cell;
      }, p);
      assert.equal(at, `${v.positions[p].x},${v.positions[p].y}`, `${p} token where the server says`);
    }
  };
  await checkSync();
  ok('UI traps and tokens match server state');

  // Play to the end: alternate trap-laying with moving toward the goal.
  let guard = 0;
  while (!(await getView()).winner && guard++ < 25) {
    const v = await getView();
    if (!v.status.human.skip && guard % 2 === 0 && v.eligible.length && v.rules.human.length < v.slots) {
      await page.fill('#rule-input', guard % 4 === 0 ? '밟으면 다음 턴을 쉰다' : 'Swap places with your rival!');
      await page.click('#interpret-btn');
      await page.waitForSelector('.pv-meta');
      await page.click(`[data-cell="${v.eligible[v.eligible.length - 1]}"]`);
    }
    const order = v.status.human.skip ? ['hold'] : v.status.human.reverse ? ['left', 'up', 'down', 'right'] : ['right', 'up', 'down', 'left'];
    for (const m of order) {
      if (await page.locator(`.mv[data-move="${m}"]`).isDisabled()) continue;
      const before = (await getView()).round;
      await page.click(`.mv[data-move="${m}"]`);
      await page.waitForTimeout(200);
      await idle();
      if ((await getView()).round !== before || (await getView()).winner) break;
    }
    await checkSync();
  }
  const end = await getView();
  assert.ok(end.winner, 'game reached an end');
  await page.waitForSelector('#gameover:not([hidden])');
  await page.waitForTimeout(600);
  const title = await page.locator('#go-title').innerText();
  await page.screenshot({ path: `${shots}/game-over.png` });
  ok(`full game played to the end in the browser (${title}, ${end.round - 1} rounds)`);
  const logRounds = await page.locator('#log > li').count();
  assert.equal(logRounds, end.round - 1, 'every round logged');
  assert.ok(await page.locator('.ai-record').first().innerText().then((t: string) => /recorded decision/.test(t)));
  ok('every round has a log entry with the AI’s recorded pre-reveal decision');

  await page.keyboard.press('r');
  await page.waitForFunction(() => (window as any).__ruleSabotage.view.round === 1 && !(window as any).__ruleSabotage.view.winner);
  assert.equal(await page.locator('#gameover').isHidden(), true);
  ok('rematch with R starts a fresh game');

  const phone = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  phone.on('pageerror', (e: Error) => errors.push(String(e)));
  await phone.goto(`http://127.0.0.1:${port}/`);
  await phone.waitForFunction(() => (window as any).__ruleSabotage?.view);
  await phone.click('.mv.right');
  await phone.waitForFunction(() => (window as any).__ruleSabotage.view.round === 2, null, { timeout: 30000 });
  await phone.screenshot({ path: `${shots}/phone.png`, fullPage: true });
  ok('phone-sized viewport is playable');
  assert.deepEqual(errors, [], 'no console/page errors');
  ok('no console or page errors');
} finally {
  await browser.close();
  srv.kill();
}
console.log(`\n${results.length} browser checks passed`);
