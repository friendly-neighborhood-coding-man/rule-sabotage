/**
 * Zero-credit browser preflight of the V2 Kane exploration notebook (no kane-cli, no Kane credits).
 * A real Chromium (Playwright) opens the real exploration page built from the hash-verified V1 evidence, served by
 * the same notebook session code the cycle uses, and:
 *   1. fills in and submits the form through the UI           → the note must be VALID and stored verbatim;
 *   2. submits again with the hidden nonce tampered            → must be REJECTED (wrong nonce);
 *   3. submits after the call window closed                    → must be REJECTED (outside the window).
 * The whole session is video-recorded (unedited) with screenshots; a manifest with sha256 is written.
 *   npm run balance:v2:preflight
 */
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { mkdirSync, readFileSync, readdirSync, writeFileSync, renameSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { openSession, acceptNote } from '../server/balance/v2/kane2.ts';
import { explorationPage } from '../server/balance/v2/pages.ts';
import type { GameRec } from '../server/balance/selfplay.ts';

const ROOT = resolve(fileURLToPath(new URL('../', import.meta.url)));
const { chromium } = createRequire(import.meta.url)('playwright');
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19) + 'Z';
const out = join(ROOT, 'evidence/balance/v2-preflight', stamp);
mkdirSync(out, { recursive: true });
const v1 = join(ROOT, 'evidence/balance/runs/2026-11-18T14-21-47Z-kane/cycle-1/baseline-training-games.ndjson');
const games = readFileSync(v1, 'utf8').split(/\r?\n/).filter(Boolean).map(l => JSON.parse(l) as GameRec);
const session = openSession(out, 'PF1', 'exploration', 5);
const html = explorationPage({ v1RunId: '2026-11-18T14-21-47Z-kane', v1Hash: createHash('sha256').update(readFileSync(v1)).digest('hex'), games, traces: [], replay: games[0], valuation: [], effectTable: [] }, session.nonce, '/v2/notes/PF1');
const srv = createServer((req, res) => {
  if (req.method === 'POST' && req.url === '/v2/notes/PF1') { let b = ''; req.on('data', d => { b += d; }); req.on('end', () => { const n = acceptNote(session, b); res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(`<p id="result">Recorded note ${n.noteId}. ${n.problems.length ? `Not accepted: ${n.problems.join('; ')}.` : 'Thank you.'}</p>`); }); return; }
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'" }); res.end(html);
});
await new Promise<void>(r => srv.listen(0, '127.0.0.1', () => r()));
const url = `http://127.0.0.1:${(srv.address() as { port: number }).port}/v2/explore`;
const results: { step: string; pass: boolean; detail: string }[] = [];
const check = (step: string, pass: boolean, detail: string) => { results.push({ step, pass, detail }); console.log(`${pass ? 'PASS' : 'FAIL'} ${step}: ${detail}`); };

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, recordVideo: { dir: out, size: { width: 1280, height: 900 } } });
const page = await ctx.newPage();
const fill = async (text: string) => {
  await page.goto(url);
  await page.locator('#notebook').scrollIntoViewIfNeeded();
  await page.selectOption('#defect', 'yes');
  await page.fill('#explanation', text);
  await page.selectOption('#component', 'placement-search');
  await page.selectOption('#metric', 'ew_self_trigger_share');
  await page.selectOption('#direction', 'decrease');
  await page.fill('#alternative', 'PREFLIGHT: an alternative explanation typed by the preflight script, not by Kane.');
};
try {
  session.open = true; session.startedAt = new Date().toISOString();
  await fill('PREFLIGHT (scripted, not Kane): the planner seems to choose shove cells on its own route.');
  await page.screenshot({ path: join(out, '1-filled.png'), fullPage: false });
  await page.click('button[type=submit]');
  await page.waitForSelector('#result');
  await page.screenshot({ path: join(out, '2-submitted.png') });
  const n1 = session.notes[0];
  check('UI submission of a well-formed note is valid and stored verbatim', !!n1 && !n1.problems.length && readFileSync(session.file, 'utf8').includes(`"noteId":"${n1.noteId}"`) && n1.fields.component === 'placement-search', n1 ? `${n1.noteId}: ${n1.problems.join('; ') || 'valid'}` : 'no note');
  await fill('PREFLIGHT: same note with a tampered nonce.');
  await page.evaluate(() => { (document.querySelector('input[name=nonce]') as HTMLInputElement).value = 'forged-nonce'; });
  await page.click('button[type=submit]'); await page.waitForSelector('#result');
  await page.screenshot({ path: join(out, '3-forged-nonce.png') });
  const n2 = session.notes[1];
  check('a tampered nonce is rejected', !!n2 && n2.problems.includes('wrong or missing nonce'), n2 ? n2.problems.join('; ') : 'no note');
  session.open = false; session.closedAt = new Date().toISOString();
  await fill('PREFLIGHT: a note after the call window closed.');
  await page.click('button[type=submit]'); await page.waitForSelector('#result');
  await page.screenshot({ path: join(out, '4-after-window.png') });
  const n3 = session.notes[2];
  check('a note outside the call window is rejected', !!n3 && n3.problems.some(p => /outside the Kane call window/.test(p)), n3 ? n3.problems.join('; ') : 'no note');
  check('the page shows no hypothesis and no holdout seed', !/hypothes/i.test(html.replace(/Investigation notebook[\s\S]*/, '')) && !/\b71[01]\d\b/.test(html), 'checked page text');
} finally { await ctx.close(); await browser.close(); srv.close(); }
const vid = readdirSync(out).find(f => f.endsWith('.webm'));
if (vid) renameSync(join(out, vid), join(out, 'preflight-raw.webm'));
check('the browser session was recorded (unedited video)', readdirSync(out).includes('preflight-raw.webm'), 'preflight-raw.webm');
const files = readdirSync(out).filter(f => f !== 'manifest.json').map(f => { const b = readFileSync(join(out, f)); return { path: f, bytes: b.length, sha256: createHash('sha256').update(b).digest('hex') }; });
writeFileSync(join(out, 'manifest.json'), JSON.stringify({ at: new Date().toISOString(), note: 'Zero-credit preflight: no kane-cli was run; every note was typed by this script.', results, files }, null, 2));
const pass = results.every(r => r.pass);
console.log(`${results.filter(r => r.pass).length}/${results.length} preflight checks passed · ${out}`);
process.exit(pass ? 0 : 1);
