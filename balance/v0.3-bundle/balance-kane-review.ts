/**
 * Optional REAL Kane audit of one completed engine-backed self-play report.
 * Copy this to <repo>/scripts/balance-kane-review.ts.
 * Default: REPORT ONLY. Explicit --run-kane required to spend credits.
 * This checks visible evidence conditions, NOT a numeric weight-training objective.
 * Run: node --experimental-strip-types scripts/balance-kane-review.ts evidence/balance/<run-id> [--run-kane]
 */
import { readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { kaneJudge } from '../server/kane.ts';

type Summary = {
  status: string; experiment: string; gamesPerArm: number; ban8: boolean;
  weightsSHA256: string; summary: Array<{
    arm: string; n: number; humanWins: number; aiWins: number; draws: number;
    firstPlayerWinRate: number; meanTurns: number; meanTriggers: number;
    meanSelfTriggers: number; meanChainCaps: number;
  }>;
};

const dir = process.argv[2];
const runKane = process.argv.includes('--run-kane');
if (!dir) throw new Error('Usage: balance-kane-review.ts evidence/balance/<run-id> [--run-kane]');
const report = JSON.parse(readFileSync(join(dir, 'summary.json'), 'utf8')) as Summary;
if (report.status !== 'ENGINE_SELFPLAY_NO_KANE' || !Array.isArray(report.summary) || report.summary.length !== 3) {
  throw new Error('Expected a completed engine-backed three-arm summary');
}
const names = new Set(report.summary.map(x => x.arm));
for (const arm of ['baseline-v-baseline', 'candidate-human', 'candidate-ai']) if (!names.has(arm)) throw new Error(`Missing arm: ${arm}`);
const rowBase = report.summary.find(x => x.arm === 'baseline-v-baseline')!;
const enough = report.summary.every(r => r.n >= 100);
const sha = createHash('sha256').update(JSON.stringify(report)).digest('hex');
const esc = (s: unknown) => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const pct = (n: number, d: number) => `${(n / Math.max(d, 1) * 100).toFixed(1)}%`;
const dataRows = report.summary.map(r => `<tr><td>${esc(r.arm)}</td><td>${r.n}</td><td>${r.humanWins}</td><td>${r.aiWins}</td><td>${r.draws}</td><td>${esc(pct(r.humanWins,r.n))}</td><td>${esc(pct(r.aiWins,r.n))}</td><td>${esc(r.firstPlayerWinRate)}</td><td>${esc(r.meanTurns)}</td><td>${esc(r.meanTriggers)}</td><td>${esc(r.meanSelfTriggers)}</td><td>${esc(r.meanChainCaps)}</td></tr>`).join('');
const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Rule Sabotage — Balance Audit</title><style>body{font:15px/1.5 system-ui;margin:26px;color:#111}table{border-collapse:collapse}th,td{border:1px solid #888;padding:5px}th{background:#eee}</style></head><body><h1>Rule Sabotage — Real Engine Self-Play Audit</h1><p>Experiment ${esc(report.experiment)}. Full evidence SHA256: ${esc(sha)}. Weight SHA256: ${esc(report.weightsSHA256)}.</p><p>Experiment status: ${esc(report.status)}. Seeds per arm: ${report.gamesPerArm}. Candidate-vs-baseline from both sides. Eight-neighbor experimental candidate filter: ${report.ban8}.</p><p>Pre-review sample gate: <b>${enough ? 'met (100 seeds per arm)' : 'NOT MET'}</b>. This is not a claim of statistical power.</p><table><tr><th>Arm</th><th>n</th><th>Human wins</th><th>AI wins</th><th>draws</th><th>Human win rate</th><th>AI win rate</th><th>First-side win rate</th><th>Avg turns</th><th>Avg triggers</th><th>Avg self-triggers</th><th>Avg chain cap</th></tr>${dataRows}</table><p>Predeclared conservative sanity gate: baseline self-play must have 35–65% wins for either side and 35–65% first-player wins. If this gate fails, stop score promotion; this is an arbitrary cautionary threshold, NOT a proven fairness rule.</p><p>Remember: Kane verifies page conditions, while causality and numeric calibration require paired held-out evaluation.</p></body></html>`;
writeFileSync(join(dir, 'balance-review.html'), html);
const ledger = join(dir, 'kane-ledger.jsonl');
if (!runKane) {
  console.log(JSON.stringify({ status: 'REPORT_GENERATED_NO_KANE', report: join(dir,'balance-review.html'), sampleGate: enough }, null, 2));
  process.exit(0);
}
if (!enough) throw new Error('Refusing live Kane request: need at least 100 paired seeds per arm');

const conditions = [
  'The Balance Audit page identifies three distinct arms: baseline-v-baseline, candidate-human and candidate-ai, and the n for EACH arm is at least 100.',
  "In baseline-v-baseline the Human win rate and AI win rate shown are EACH between 35.0% and 65.0% inclusive. Reject if either percentage falls outside that interval.",
  'The baseline-v-baseline first-side win rate shown on the page is between 0.35 and 0.65 inclusive. Reject if it falls outside that interval.',
  'The page lists first-side win rate, mean turns, mean triggers, mean self-triggers, and mean chain cap for all three arms; no column is missing or unreadable.',
];
const server = createServer((req, res) => {
  if (req.url === '/balance-review') { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }); res.end(html); }
  else { res.writeHead(404); res.end('not found'); }
});
await new Promise<void>((resolve,reject) => { server.once('error', reject); server.listen(0,'127.0.0.1',resolve); });
const a = server.address();
if (!a || typeof a === 'string') throw new Error('Failed to bind loopback report server');
const url = `http://127.0.0.1:${a.port}/balance-review`;
let verdict: Awaited<ReturnType<typeof kaneJudge>> | null = null;
try {
  verdict = await kaneJudge({
    trialId: `BA${sha.slice(0,10)}`, signature: sha.slice(0,16), url, html, conditions,
  });
  appendFileSync(ledger, JSON.stringify({
    eventType:'REAL_KANE_BROWSER_AUDIT', experiment:report.experiment,
    at:new Date().toISOString(), kaneExecuted: Boolean(verdict.version && verdict.timings && typeof verdict.timings.cliMs === 'number'),
    kaneCliVersion: verdict.version, status: verdict.status.toUpperCase(),
    auditedConditions: conditions,
    results: verdict.conditionResults, reasons: verdict.conditionReasons,
    evidencePath: verdict.evidencePath, elapsedMs: verdict.elapsedMs,
    cacheKey: verdict.cacheKey ?? null, reportSHA256: sha,
    scorePatch: null, approvedForPromotion: false,
  })+'\n');
  console.log(JSON.stringify({ status: verdict.status, evidencePath: verdict.evidencePath, conditionResults: verdict.conditionResults, approvedForPromotion: false }, null, 2));
} finally { await new Promise<void>((resolve) => server.close(() => resolve())); }
