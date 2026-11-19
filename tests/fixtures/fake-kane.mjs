#!/usr/bin/env node
// TEST DOUBLE for kane-cli. Used only by unit tests to exercise the adapter's plumbing
// (process spawn, NDJSON parsing, timeouts, caching). It is NOT Kane and proves nothing about Kane.
const args = process.argv.slice(2);
const mode = process.env.FAKE_KANE_MODE || 'approve';
if (args[0] === '--version') { console.log('0.0.0-test-double'); process.exit(0); }
if (args[0] === 'whoami') { console.log(mode === 'logged-out' ? '⚠ Not logged in' : 'Logged in as test-double'); process.exit(0); }
if (args[0] === 'balance') { console.log('test double: no credits'); process.exit(0); }
// Objective mode (Balance Designer V2 exploration): read the page, submit one scripted notebook note, end the run.
// The note is a FIXED script, not reasoning; V2 labels everything from this double as kane-test-double.
if (args[0] === 'run' && !args.includes('--analyzer-only') && args.includes('--url')) {
  if (process.env.FAKE_KANE_COUNT_FILE) (await import('node:fs')).appendFileSync(process.env.FAKE_KANE_COUNT_FILE, 'objective\n');
  const url = args[args.indexOf('--url') + 1];
  const objMode = process.env.FAKE_KANE_OBJECTIVE_MODE || 'note';
  console.log(JSON.stringify({ type: 'run_start' }));
  if (objMode === 'hang') { setTimeout(() => {}, 1e9); }
  else {
    let posted = 0;
    try {
      const html = await (await fetch(url)).text();
      const nonce = /name="nonce" value="([^"]+)"/.exec(html)?.[1] ?? '';
      const action = /<form method="post" action="([^"]+)"/.exec(html)?.[1];
      if (action && objMode !== 'no-notes') {
        const body = new URLSearchParams({ nonce: objMode === 'bad-nonce' ? 'forged' : nonce, defect: 'yes', explanation: 'TEST DOUBLE scripted note: the planner seems to ride its own shoves toward its goal.', component: 'planner-valuation', metric: 'ew_self_trigger_share', direction: 'decrease', alternative: 'TEST DOUBLE: maybe the board geometry.', counterexample: '', hypothesis: 'H2', verdict: 'supports' });
        const r = await fetch(new URL(action, url), { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: body.toString() });
        if (r.ok) posted++;
      }
    } catch (e) { console.log(JSON.stringify({ type: 'error', message: String(e) })); }
    if (objMode === 'garbage') { console.log('not json'); process.exit(1); }
    console.log(JSON.stringify({ type: 'run_end', status: 'passed', summary: `test double submitted ${posted} scripted note(s)`, credits_consumed: 0 }));
    process.exit(0);
  }
}
else if (args[0] === 'run') {
  if (process.env.FAKE_KANE_COUNT_FILE) (await import('node:fs')).appendFileSync(process.env.FAKE_KANE_COUNT_FILE, 'run\n');
  const n = args.filter(a => a === '--condition').length;
  const cdp = args[args.indexOf('--cdp-endpoint') + 1];
  (async () => {
    let pageSeen = false;
    try { const r = await fetch(cdp + '/json/list'); pageSeen = (await r.json()).some(p => /\/trial\/T\d+/.test(p.url)); } catch {}
    if (mode === 'hang') { setTimeout(() => {}, 1e9); return; }
    if (process.env.FAKE_KANE_DELAY_MS) await new Promise(r => setTimeout(r, Number(process.env.FAKE_KANE_DELAY_MS)));
    console.log(JSON.stringify({ type: 'run_start' }));
    if (mode === 'garbage') { console.log('not json'); process.exit(1); }
    const results = Array.from({ length: n }, (_, i) => mode === 'reject' && i === 2 ? false : true);
    console.log(JSON.stringify({ type: 'run_end', status: 'passed', condition_results: results, condition_reasons: results.map((r, i) => r ? `ok ${i}` : 'Human loses 2 turns in a row in T-S5'), page_seen: pageSeen }));
    process.exit(0);
  })();
}
