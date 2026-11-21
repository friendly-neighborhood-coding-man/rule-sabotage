#!/usr/bin/env node
// TEST DOUBLE for kane-cli, used only by tests/kane-single-call.test.ts to exercise the KS1 single-call runner's plumbing
// (version/balance parsing, CDP page check, run_end parsing, process-tree termination). It is NOT Kane and proves nothing about Kane.
import fs from 'node:fs';
const args = process.argv.slice(2), mode = process.env.KS1_MODE || 'approve';
if (process.env.KS1_PID_FILE) fs.writeFileSync(process.env.KS1_PID_FILE, String(process.pid));
if (args[0] === '--version') { console.log('\nUpdate available: 0.0.0 → 9.9.9 — test notice\n'); console.log(process.env.KS1_VERSION || '0.0.0-test-double'); process.exit(0); }
if (args[0] === 'balance') {
  const f = process.env.KS1_BALANCE_FILE;
  if (mode === 'balance-garbage') console.log('Credits left: lots (approx. 1 2 3)');
  else if (f && fs.existsSync(f)) console.log(`\nUpdate available: notice 1.2.3\n\nAvailable credits: ${fs.readFileSync(f, 'utf8').trim()}`);
  process.exit(0);
}
if (args[0] === 'run' && args.includes('--analyzer-only')) {
  if (process.env.KS1_COUNT_FILE) fs.appendFileSync(process.env.KS1_COUNT_FILE, 'run\n');
  const f = process.env.KS1_BALANCE_FILE;
  if (f && fs.existsSync(f)) fs.writeFileSync(f, String(Number(fs.readFileSync(f, 'utf8')) - Number(process.env.KS1_COST || 0)));
  const n = args.filter(a => a === '--condition').length, cdp = args[args.indexOf('--cdp-endpoint') + 1];
  let seen = false;
  try { seen = (await (await fetch(cdp + '/json/list')).json()).some(p => p.url.endsWith('/ks1-trial.html')); } catch {}
  console.log(JSON.stringify({ type: 'run_start', analyzer: true }));
  if (mode === 'hang') { setInterval(() => {}, 1e6); }
  else if (mode === 'garbage') { console.log('not json at all'); process.exit(3); }
  else if (mode === 'approve-exit1' || mode === 'approve-then-hang') {
    // a COMPLETE, all-true run_end ... followed by a failed process (exit 1) or a hang until the hard timeout
    console.log(JSON.stringify({ type: 'run_end', status: 'passed', page_seen: seen, condition_results: Array(n).fill(true), condition_reasons: Array(n).fill('test double'), credits_consumed: Number(process.env.KS1_COST || 0) }));
    if (mode === 'approve-exit1') process.exit(1); else setInterval(() => {}, 1e6);
  }
  else {
    const results = mode === 'incomplete' ? Array(Math.max(0, n - 1)).fill(true) : Array.from({ length: n }, (_, i) => (mode === 'reject' && i === 0 ? false : true));
    console.log(JSON.stringify({ type: 'run_end', status: 'passed', page_seen: seen, condition_results: results, condition_reasons: results.map(() => 'test double'), credits_consumed: Number(process.env.KS1_COST || 0) }));
    process.exit(0);
  }
}
else { console.log('test double: unsupported'); process.exit(1); }
