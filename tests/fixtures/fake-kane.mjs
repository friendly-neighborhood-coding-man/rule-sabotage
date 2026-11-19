#!/usr/bin/env node
// TEST DOUBLE for kane-cli. Used only by unit tests to exercise the adapter's plumbing
// (process spawn, NDJSON parsing, timeouts, caching). It is NOT Kane and proves nothing about Kane.
const args = process.argv.slice(2);
const mode = process.env.FAKE_KANE_MODE || 'approve';
// FAKE_KANE_VERSION exists ONLY so gate tests can exercise the real-run stop rules (credit gate, CAPABILITY_LIMITATION).
if (args[0] === '--version') { console.log(process.env.FAKE_KANE_VERSION || '0.0.0-test-double'); process.exit(0); }
if (args[0] === 'whoami') { console.log(mode === 'logged-out' ? '⚠ Not logged in' : 'Logged in as test-double'); process.exit(0); }
if (args[0] === 'balance') {
  const f = process.env.FAKE_KANE_BALANCE_FILE, fs = await import('node:fs');
  if (f && fs.existsSync(f)) console.log(`Available credits: ${fs.readFileSync(f, 'utf8').trim()}`); else console.log('test double: no credits');
  process.exit(0);
}
const spend = async () => { const f = process.env.FAKE_KANE_BALANCE_FILE, fs = await import('node:fs'); if (f && fs.existsSync(f)) fs.writeFileSync(f, String(Number(fs.readFileSync(f, 'utf8')) - Number(process.env.FAKE_KANE_COST || 0))); };
// Objective mode (Balance Designer V2 exploration): read the page, submit one scripted notebook note, end the run.
// The note is a FIXED script, not reasoning; V2 labels everything from this double as kane-test-double.
if (args[0] === 'run' && !args.includes('--analyzer-only') && args.includes('--url')) {
  if (process.env.FAKE_KANE_COUNT_FILE) (await import('node:fs')).appendFileSync(process.env.FAKE_KANE_COUNT_FILE, 'objective\n');
  const url = args[args.indexOf('--url') + 1];
  const objMode = process.env.FAKE_KANE_OBJECTIVE_MODE || 'note';
  await spend();
  console.log(JSON.stringify({ type: 'run_start' }));
  if (objMode === 'hang') { setTimeout(() => {}, 1e9); }
  else {
    let posted = 0;
    try {
      let html = await (await fetch(url)).text();
      // V3 dossier: the form lives on notebook.html. Fixed scripted entries (one hypothesis + one conclusion), not reasoning.
      if (process.env.FAKE_KANE_V3 === '1') {
        const nbUrl = new URL('notebook.html', url); const nb = await (await fetch(nbUrl)).text();
        const nonce = /name="nonce" value="([^"]+)"/.exec(nb)?.[1] ?? '';
        const action = new URL(/<form method="post" action="([^"]+)"/.exec(nb)?.[1] ?? '/notebook', nbUrl);
        const games = await (await fetch(new URL('games.html', url))).text(); const ids = [...games.matchAll(/replays\/([\w-]+)\.html/g)].map(m => m[1]);
        const entries = [
          { entry: 'hypothesis', title: 'TEST DOUBLE scripted hypothesis', cause: 'starting-rules', explanation: 'TEST DOUBLE scripted entry: the first mover completes a full turn before any opponent trap exists.', evidence: ids.slice(0, 2).join(' '), p1metric: 'abs_first_mover_edge', p1dir: 'decrease', p1size: '0.15', intervention: 'S3_FIRST_TURN_ACTIONS', value: '2', sideEffects: 'TEST DOUBLE', competing: 'TEST DOUBLE: planner foresight of teleports.', counterexample: ids[2] ?? '', acceptance: 'TEST DOUBLE', disproof: 'TEST DOUBLE' },
          { entry: 'conclusion', title: 'TEST DOUBLE conclusion', cause: 'no-defect', verdict: 'more-evidence-needed' },
        ];
        for (const e of entries) { const r = await fetch(action, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ nonce, ...e }).toString() }); if (r.ok) posted++; }
        html = '';
      }
      const nonce = /name="nonce" value="([^"]+)"/.exec(html)?.[1] ?? '';
      const action = /<form method="post" action="([^"]+)"/.exec(html)?.[1];
      if (action && objMode !== 'no-notes') {
        const body = new URLSearchParams({ nonce: objMode === 'bad-nonce' ? 'forged' : nonce, defect: 'yes', explanation: 'TEST DOUBLE scripted note: the planner seems to ride its own shoves toward its goal.', component: 'planner-valuation', metric: 'ew_self_trigger_share', direction: 'decrease', alternative: 'TEST DOUBLE: maybe the board geometry.', counterexample: '', hypothesis: 'H2', verdict: 'supports' });
        const r = await fetch(new URL(action, url), { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: body.toString() });
        if (r.ok) posted++;
      }
    } catch (e) { console.log(JSON.stringify({ type: 'error', message: String(e) })); }
    if (objMode === 'garbage') { console.log('not json'); process.exit(1); }
    console.log(JSON.stringify({ type: 'run_end', status: objMode === 'fail-run' ? 'failed' : 'passed', summary: `test double submitted ${posted} scripted note(s)`, credits_consumed: 0 }));
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
