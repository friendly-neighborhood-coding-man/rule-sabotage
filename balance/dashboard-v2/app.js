// Balance Designer V2 dashboard: renders /api/status. Read-only. Every panel names its source.
const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const tag = (v, cls = v) => `<span class="tag ${esc(cls)}">${esc(v)}</span>`;
const f = (x, d = 3) => (x === null || x === undefined ? '—' : Number(x).toFixed(d));
const follow = new URLSearchParams(location.search).has('follow');
const ORIGIN = { kane: 'Kane (real kane-cli)', 'kane-test-double': 'Kane TEST DOUBLE — not Kane', operator: 'operator spec', claude: 'Claude', deterministic: 'deterministic system' };
const PANEL = { observe: 's-observe', explore: 's-explore', register: 's-register', experiment: 's-experiment', evaluate: 's-register', challenge: 's-challenge', correct: 's-correct', reobserve: 's-adequacy', adequacy: 's-adequacy', decide: 's-decide' };
let lastActive = '';

function render(st) {
  $('meta').innerHTML = esc(`${new Date().toISOString().slice(11, 19)} UTC · run ${st.runId} · ${st.mode.toUpperCase()} · commit ${st.commit.slice(0, 10)}${st.dirty ? ' (dirty)' : ''} · engine ${st.engineHash} · weights ${st.weights} · games ${st.budgets.gamesPlayed}/${st.budgets.gamesMax} · Kane calls ${st.budgets.kaneCallsUsed}/${st.budgets.kaneCallsMax} · credits ${st.budgets.creditsUsed ?? 0}/${st.budgets.creditsMax} (ceiling checked between calls) · dev seeds ${st.seeds.development[0]}–${st.seeds.development.at(-1)} · holdout ${Array.isArray(st.seeds.holdout) ? `${st.seeds.holdout[0]}–${st.seeds.holdout.at(-1)} (unsealed)` : 'SEALED'}`);
  const banner = [];
  if (st.mode === 'dry-run') banner.push('<span class="b NOT_RUN">DRY-RUN: kane-cli not invoked, no finding attributed to Kane</span>');
  if (st.kaneCli?.isTestDouble) banner.push('<span class="b origin-kane-test-double">KANE TEST DOUBLE: its output is labelled and is never evidence</span>');
  if (st.checkpoint) banner.push(`<span class="b ${/FAILED/.test(st.checkpoint) ? 'FAIL' : 'PARTIAL'}">${esc(st.checkpoint.split('\n')[0])}</span>`);
  if (st.progress) banner.push(`<span class="muted">${esc(st.progress.label)}: ${st.progress.done}/${st.progress.total} games</span>`);
  $('banner').innerHTML = banner.join('');
  $('rail').innerHTML = st.stages.map(s => `<div class="${s.state}" title="${esc(s.summary)}">${esc(s.title)}</div>`).join('');

  const o = st.observation;
  $('observe').innerHTML = !o ? '<p class="muted">pending</p>' : `<p>${esc(o.v1Detail)} ${o.v1Verified ? tag('OK') : tag('FAIL')}</p>
  <table><tr><th>Teleport triggers by installer’s own pieces</th><th>Teleport squares gained by activator</th><th>Own-teleport chosen-step gain</th><th>Non-installer gain</th><th>East/west shove triggers by installer’s own pieces</th><th>Win rate of Teleport users <span class="muted">(descriptive, selection-biased)</span></th></tr>
  <tr><td class="big">${f(o.metrics.tp_self_share, 2)}</td><td class="big">${f(o.metrics.tp_benefit, 2)}</td><td class="big">${f(o.metrics.tp_self_benefit, 2)}</td><td class="big">${f(o.metrics.tp_opp_benefit, 2)}</td><td class="big">${f(o.metrics.ew_self_trigger_share, 2)}</td><td>${f(o.metrics.conditional_win_tp, 2)}</td></tr></table>
  <details><summary>Per effect</summary><table><tr><th>Effect</th><th>Placed by Human</th><th>Placed by AI</th><th>Triggers</th><th>By installer</th><th>By other</th><th>Gain (installer)</th><th>Gain (other)</th></tr>${o.effectTable.map(r => `<tr>${r.map(c => `<td>${esc(c ?? '—')}</td>`).join('')}</tr>`).join('')}</table></details>`;

  const kx = st.kane.find(k => k.role === 'exploration');
  const ex = st.exploration;
  $('explore').innerHTML = `${ex ? `<p>${tag(ex.capability)} kane-cli execution: ${tag(ex.execution ?? "—", ex.execution === "COMPLETE" ? "OK" : "UNVERIFIED")} ${esc(ex.detail)}</p>` : '<p class="muted">pending</p>'}
  ${kx ? `<p>Call ${esc(kx.callId)}: ${esc(kx.state)} ${kx.note ? `· ${esc(kx.note)}` : ''} · page <a href="/v2/explore" target="_blank">/v2/explore</a> (raw data only, no hypotheses shown)</p>${kx.objective ? `<details><summary>Exact objective sent to kane-cli</summary><p>${esc(kx.objective)}</p></details>` : ''}${kx.liveLines.length ? `<div class="live">${kx.liveLines.map(esc).join('\n')}</div>` : ''}` : ''}
  ${(ex?.notes ?? []).map(n => `<div class="note"><b>${esc(n.noteId)}</b> ${n.problems.length ? tag('REJECTED', 'FAIL') + ' ' + esc(n.problems.join('; ')) : tag(st.kaneCli?.isTestDouble ? 'TEST DOUBLE NOTE' : 'KANE NOTE', st.kaneCli?.isTestDouble ? 'origin-kane-test-double' : 'origin-kane')} · defect: ${esc(n.fields.defect)} · component: ${esc(n.fields.component)} · expects ${esc(n.fields.metric)} to ${esc(n.fields.direction)}<br>“${esc(n.fields.explanation)}”<br><span class="muted">alternative: ${esc(n.fields.alternative)}</span></div>`).join('')}`;

  $('hyps').innerHTML = !st.hypotheses.length ? '<p class="muted">pending</p>' : `<table><tr><th>Id</th><th>Origin</th><th>Hypothesis and mechanism</th><th>Pre-registered predictions</th><th>Outcome</th><th>Kane</th></tr>${st.hypotheses.map(h => `<tr><td><b>${esc(h.id)}</b><br><span class="muted">#${h.journalSeq} ${esc(h.hash)}</span></td><td>${tag(ORIGIN[h.origin] ?? h.origin, 'origin-' + h.origin)}</td><td><b>${esc(h.title)}</b><br><span class="muted">${esc(h.mechanism).slice(0, 300)}</span></td><td>${h.predictions.map(p => `<div>${esc(p.id)} [${esc(p.role)}] ${esc(p.experiment)}/${esc(p.design)}: ${esc(p.metric)} ${esc(p.direction)} ≥ ${p.minEffect}${(() => { const r = h.evaluation?.predictions.find(x => x.id === p.id); return r ? ` → <b>${esc(r.status)}</b> <span class="muted">${esc(r.reason)}</span>` : ''; })()}</div>`).join('')}</td><td>${h.evaluation ? tag(h.evaluation.outcome) : '—'}</td><td>${h.evaluation ? tag(h.evaluation.kane.corroboration) + `<br><span class="muted">${esc(h.evaluation.kane.detail)}</span>` : '—'}</td></tr>`).join('')}</table><p class="muted">SUPPORTED = the pre-registered predictions held on these development seeds; it is not proof.</p>`;

  $('exps').innerHTML = !st.experiments.length ? '<p class="muted">pending</p>' : `<table><tr><th>Condition</th><th>Single factor changed</th><th>Seeds</th><th>Games</th><th>Did it change the intended behaviour?</th><th>Teleport self-trigger</th><th>E/W shove self-trigger</th><th>Own-teleport gain</th><th>Safety</th></tr>${st.experiments.map(e => `<tr><td><b>${esc(e.key)}</b></td><td>${esc(e.description)}<br><span class="muted">component ${esc(e.component)} ${e.diff.length ? `· ${esc(e.diff.join(', '))}` : ''}</span></td><td>${esc(e.seedSet)}</td><td>${e.games}</td><td>${tag(e.manipulation.ok ? 'OK' : 'FAIL')} <span class="muted">${esc(e.manipulation.detail)}</span></td><td>${f(e.summary.tp_self_share, 2)}</td><td>${f(e.summary.ew_self_trigger_share, 2)}</td><td>${f(e.summary.tp_self_benefit, 2)}</td><td>${e.summary.safety_events}</td></tr>`).join('')}</table>`;

  const kc = st.kane.filter(k => k.role !== 'exploration');
  $('challenge').innerHTML = !kc.length ? '<p class="muted">pending</p>' : kc.map(k => `<p><b>${esc(k.callId)}</b> ${esc(k.role)}: ${esc(k.state)} ${k.note ? `· ${esc(k.note)}` : ''} ${k.analyzer ? `· ${k.analyzer.isTestDouble ? tag('TEST DOUBLE', 'origin-kane-test-double') : esc('kane-cli ' + k.analyzer.version)} ${esc(k.analyzer.status)}` : ''} · page <a href="${esc(new URL(k.url).pathname)}" target="_blank">${esc(new URL(k.url).pathname)}</a></p>
  ${k.conditions?.length ? `<table><tr><th>Condition sent to Kane (verbatim)</th><th>Our computation</th><th>Kane</th></tr>${k.conditions.map((c, i) => { const r = k.analyzer?.conditionResults?.[i]; return `<tr><td>${esc(c.text)}</td><td>${c.ours}</td><td>${r === undefined || r === null ? '—' : r}${k.analyzer?.conditionReasons?.[i] ? `<br><span class="muted">${esc(k.analyzer.conditionReasons[i])}</span>` : ''}</td></tr>`; }).join('')}</table>` : ''}${k.liveLines.length ? `<div class="live">${k.liveLines.map(esc).join('\n')}</div>` : ''}`).join('');

  $('corr').innerHTML = !st.corrections.length ? '<p class="muted">pending</p>' : `<table><tr><th>Id</th><th>Category / policy</th><th>Change</th><th>Basis</th><th>Targets</th></tr>${st.corrections.map(c => `<tr><td><b>${esc(c.id)}</b></td><td>${esc(c.category)}<br><span class="muted">${esc(c.policy)}</span></td><td>${esc(c.description)}<br><span class="muted">${esc(c.rationale)}</span></td><td>${esc(c.basis.join(', '))} ${tag(c.origin, 'origin-' + c.origin)}</td><td>${c.targets.map(t => `${esc(t.metric)} ${esc(t.direction)} ≥ ${t.minEffect}`).join('<br>') || '—'}</td></tr>`).join('')}</table>`;

  $('adequacy').innerHTML = !st.reviews.length ? '<p class="muted">pending</p>' : st.reviews.map(r => `<h3>${esc(r.correction)}</h3><div class="two"><div><p>A · Implementation correctness ${tag(r.implementationCorrectness)}</p>${r.implementation.map(c => `<div>${c.pass === null ? '○' : c.pass ? '✔' : '✘'} ${esc(c.q)} <span class="muted">${esc(c.detail)}</span></div>`).join('')}</div>
  <div><p>B · Balance adequacy ${tag(r.balanceAdequacy)} <span class="muted">provisional before Kane:</span> ${tag(r.provisionalAdequacy)}</p>${r.adequacy.map(c => `<div>${c.pass === null ? '○' : c.pass ? '✔' : '✘'} ${esc(c.q)} <span class="muted">${esc(c.detail)}</span></div>`).join('')}</div></div>
  <p>${esc(r.why)}</p>${r.unresolved.length ? `<p><b>Unresolved:</b> ${esc(r.unresolved.join('; '))}</p>` : ''}${r.nextExperiment ? `<p><b>Next discriminating experiment:</b> ${esc(r.nextExperiment)}</p>` : ''}`).join('');

  $('decide').innerHTML = !st.decision ? '<p class="muted">pending</p>' : `<p class="big">${esc(st.decision.overall)}</p>${st.decision.items.map(i => `<div>${esc(i.correction)} (${esc(i.category)}): <b>${esc(i.action)}</b> <span class="muted">${esc(i.why)}</span></div>`).join('')}`;
  $('log').textContent = st.log.slice(-80).join('\n');

  const running = st.stages.find(s => s.state === 'running') ?? [...st.stages].reverse().find(s => s.state !== 'pending');
  document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
  if (running) { const el = $(PANEL[running.key]); el?.classList.add('active'); if (follow && running.key !== lastActive && el) { el.scrollIntoView({ behavior: 'smooth', block: 'start' }); lastActive = running.key; } }
}
async function tick() { try { render(await (await fetch('/api/status')).json()); } catch { /* server gone */ } setTimeout(tick, 1000); }
tick();
