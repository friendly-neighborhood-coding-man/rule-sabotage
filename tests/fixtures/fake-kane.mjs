#!/usr/bin/env node
// TEST DOUBLE for kane-cli. Used only by unit tests to exercise the adapter's plumbing
// (process spawn, NDJSON parsing, timeouts, caching). It is NOT Kane and proves nothing about Kane.
const args = process.argv.slice(2);
const mode = process.env.FAKE_KANE_MODE || 'approve';
if (args[0] === '--version') { console.log('0.0.0-test-double'); process.exit(0); }
if (args[0] === 'whoami') { console.log(mode === 'logged-out' ? '⚠ Not logged in' : 'Logged in as test-double'); process.exit(0); }
if (args[0] === 'run') {
  const n = args.filter(a => a === '--condition').length;
  const cdp = args[args.indexOf('--cdp-endpoint') + 1];
  (async () => {
    let pageSeen = false;
    try { const r = await fetch(cdp + '/json/list'); pageSeen = (await r.json()).some(p => /\/trial\/T\d+/.test(p.url)); } catch {}
    if (mode === 'hang') { setTimeout(() => {}, 1e9); return; }
    console.log(JSON.stringify({ type: 'run_start' }));
    if (mode === 'garbage') { console.log('not json'); process.exit(1); }
    const results = Array.from({ length: n }, (_, i) => mode === 'reject' && i === 2 ? false : true);
    console.log(JSON.stringify({ type: 'run_end', status: 'passed', condition_results: results, condition_reasons: results.map((r, i) => r ? `ok ${i}` : 'Human loses 2 turns in a row in T-S5'), page_seen: pageSeen }));
    process.exit(0);
  })();
}
