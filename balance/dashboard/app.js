// Operator dashboard: renders /api/status of the running balance loop. Read-only; never changes anything.
const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pct = x => (x == null ? '-' : `${Math.round(x * 100)}%`);
const kpi = (v, l) => `<div class="kpi"><b>${esc(v)}</b><span>${esc(l)}</span></div>`;
let lastLog = 0, frameUrl = '';

function render(st) {
  const cy = st.cycles[st.cycles.length - 1];
  $('mode').textContent = st.mode === 'run-kane' ? 'REAL KANE RUN' : 'DRY-RUN · Kane not invoked';
  $('mode').className = `badge ${st.mode === 'run-kane' ? 'kane' : 'dry'}`;
  $('meta').innerHTML = `run <code>${esc(st.runId)}</code> · commit <code>${esc(st.commit.slice(0, 10))}</code>${st.dirty ? ' (uncommitted)' : ''} · engine <code>${esc(st.engineHash)}</code> · weights <code>${esc(cy ? `${cy.baselineVersion}#${cy.baselineHash}` : '-')}</code> · training seeds ${esc(st.seeds.training.join(','))} · held-out ${esc(st.seeds.heldOut.join(','))} · kane-cli ${esc(st.kaneCli.version ?? (st.mode === 'dry-run' ? 'not used' : 'n/a'))} · started ${esc(st.startedAt)}${st.finishedAt ? ` · finished ${esc(st.finishedAt)}` : ''}`;
  $('rail').innerHTML = (cy?.stages ?? []).map((s, i) => `<div class="stage ${s.state}"><span class="st">${esc(s.state)}</span><div class="t">${i + 1}. ${esc(s.title)}</div><div class="s">${esc(s.summary || (s.state === 'running' && cy.progress ? `${cy.progress.label}: ${cy.progress.done}/${cy.progress.total} games` : ''))}</div>${s.state === 'running' && cy.progress ? `<div class="progress"><i style="width:${(100 * cy.progress.done / cy.progress.total).toFixed(0)}%"></i></div>` : ''}</div>`).join('') + (st.cycles.length > 1 ? `<div class="muted">cycle ${cy.n} of the run</div>` : '');
  $('checkpoint').className = st.checkpoint ? 'checkpoint' : 'checkpoint hidden';
  $('checkpoint').textContent = st.checkpoint ? `CHECKPOINT · ${st.checkpoint}` : '';
  if (!cy) return;
  const b = cy.baseline;
  $('baseline').innerHTML = b ? [kpi(`${b.games}`, 'baseline games'), kpi(`${b.wins.human}–${b.wins.ai}–${b.wins.draw}`, 'Human–AI–draw'), kpi(pct(b.firstPlayerWinRate), 'first-player wins'), kpi(b.turns.median, 'median turns'), kpi(b.diversity.effectEntropyNorm, 'effect entropy'), kpi(`${b.safety.illegal}/${b.safety.errors}/${b.safety.softlocks}`, 'illegal/errors/softlocks')].join('') : '<span class="muted">self-play running…</span>';
  $('anomalies').innerHTML = cy.anomalies.map(a => `<div class="an"><div class="h">${esc(a.id)} · ${esc(a.title)}${cy.selected.includes(a.id) ? '<span class="tag">sent to Kane</span>' : ''}${a.knob ? '' : '<span class="tag">rule-level</span>'}</div><div class="n">${esc(a.type)} · ${esc(a.metric)} = ${esc(a.value)} (threshold ${esc(a.threshold)}) · severity ${esc(a.severity)} · ${esc(a.samples)} samples${a.note ? ` · ${esc(a.note)}` : ''}</div></div>`).join('') || (b ? '<span class="muted">no anomaly crossed a threshold</span>' : '');
  $('kane').innerHTML = cy.kane.length ? cy.kane.map(k => {
    const f = k.finding, r = k.result;
    const running = k.state === 'running' && k.startedAt ? ` · ${Math.round((Date.now() - Date.parse(k.startedAt)) / 1000)} s elapsed` : '';
    const who = r ? (r.isTestDouble ? 'TEST DOUBLE (not Kane)' : `kane-cli ${r.version}`) : k.state === 'skipped' ? 'not invoked' : k.state;
    return `<div class="krow"><div><b>${esc(k.anomalyId)}</b> · ${esc(who)} · ${esc(k.state)}${running}${r ? ` · ${(r.elapsedMs / 1000).toFixed(1)} s · exit ${r.exitCode}` : ''} · <span class="verdict v-${f?.status ?? 'UNVERIFIED'}">${esc(f?.status ?? 'pending')}</span> <a href="${esc(k.url)}" target="_blank">evidence page</a></div>
      ${(f?.conditions ?? k.conditions).map(c => `<div class="cond"><span class="r ${c.kane === true ? 'T' : c.kane === false ? 'F' : 'Q'}">${c.kane === true ? 'TRUE' : c.kane === false ? 'FALSE' : '—'}</span><span>${esc(c.id)} <i>${esc(c.role)}</i>: ${esc(c.text)}${c.kaneReason ? `<span class="why">Kane: “${esc(c.kaneReason)}”</span>` : ''}</span></div>`).join('')}
      ${f ? `<div class="muted">${esc(f.reason)}</div>` : ''}
      ${k.liveLines?.length ? `<div class="live">${esc(k.liveLines.slice(-12).join('\n'))}</div>` : ''}</div>`;
  }).join('') : `<span class="muted">${cy.stages[2].state === 'pending' ? 'waiting for anomalies…' : esc(cy.stages[2].summary || 'no anomaly selected')}</span>`;
  const show = cy.kane.find(k => k.state === 'running') || cy.kane[0];
  const fr = $('frame');
  if (show && frameUrl !== show.url) { fr.src = show.url; frameUrl = show.url; }
  fr.className = show ? '' : 'hidden';
  $('candidates').innerHTML = cy.candidates.length ? `<table><tr><th>Candidate</th><th>Change</th><th>Reason</th><th>Basis</th></tr>${cy.candidates.map(c => `<tr><td><b>${esc(c.id)}</b></td><td>${c.changes.map(x => `<div class="chg">${esc(x.path)} <span class="old">${x.old}</span> → <span class="new">${x.proposed}</span></div>`).join('')}</td><td>${esc(c.changes[0]?.reason)}</td><td>${esc(c.eligibilityReason)}</td></tr>`).join('')}</table>` : `<span class="muted">${esc(cy.stages[3].summary || 'waiting…')}</span>`;
  const H = cy.heldOutBaseline;
  if (H) {
    const ids = cy.candidates.map(c => c.id).filter(id => cy.heldOut[id]);
    const row = (n, f) => `<tr><td>${n}</td><td>${f(H)}</td>${ids.map(id => `<td>${f(cy.heldOut[id])}</td>`).join('')}</tr>`;
    $('compare').innerHTML = `<table><tr><th>Held-out metric</th><th>Baseline</th>${ids.map(i => `<th>${i}</th>`).join('')}</tr>${row('First-player win rate', m => pct(m.firstPlayerWinRate))}${row('Human-side win rate', m => pct(m.humanSideWinRate))}${row('Median turns', m => m.turns.median)}${row('Draw rate', m => pct(m.drawRate))}${row('Effect entropy', m => m.diversity.effectEntropyNorm)}${row('Lead changes / game', m => m.counterplay.leadChangesPerGame)}${row('Illegal / errors / softlocks', m => `${m.safety.illegal}/${m.safety.errors}/${m.safety.softlocks}`)}</table>`
      + cy.comparisons.map(c => `<div style="margin-top:8px"><b>${esc(c.candidate)}</b> ${c.pass ? '<span class="verdict v-CONFIRMED">passes all gates</span>' : '<span class="verdict v-REFUTED">rejected</span>'}${c.gates.map(g => `<div class="gate ${g.pass ? 'ok' : 'bad'}">${esc(g.name)}: ${esc(g.detail)}</div>`).join('')}</div>`).join('');
  } else $('compare').innerHTML = `<span class="muted">${esc(cy.stages[4].summary || (cy.progress && cy.stages[4].state === 'running' ? `${cy.progress.label}: ${cy.progress.done}/${cy.progress.total}` : 'waiting…'))}</span>`;
  const d = cy.decision;
  $('decision').innerHTML = d ? `<div class="decision ${d.action}">${d.action === 'promote' ? `PROMOTED ${esc(d.candidate)}: ${esc(d.fromVersion)} → ${esc(d.toVersion)}` : `ROLLBACK · weights stay ${esc(d.fromVersion)}`}<ul>${d.reasons.map(r => `<li>${esc(r)}</li>`).join('')}</ul></div>` : '';
  $('history').innerHTML = `<table><tr><th>When</th><th>Event</th><th>Version</th><th>Changes</th></tr>${st.weightsHistory.map(h => `<tr><td>${esc(h.at.replace('T', ' ').slice(0, 19))}</td><td>${esc(h.type)}</td><td>${esc(h.version)} <span class="muted">#${esc(h.hash)}</span></td><td>${esc(h.changes)}</td></tr>`).join('')}</table>`;
  $('budgets').innerHTML = [kpi(`${st.budgets.kaneCallsUsed}/${st.budgets.kaneCallsMax}`, 'Kane calls'), kpi(st.budgets.creditsUsed ?? '-', `credits used (cap ${st.budgets.creditsMax})`), kpi(st.budgets.gamesPlayed, 'games played')].join('');
  if (st.log.length !== lastLog) { $('log').textContent = st.log.join('\n'); $('log').scrollTop = 1e9; lastLog = st.log.length; }
}
async function tick() {
  $('clock').textContent = new Date().toISOString().replace('T', ' ').slice(0, 19) + ' UTC';
  try { const r = await fetch('/api/status', { cache: 'no-store' }); if (r.ok) render(await r.json()); } catch { $('meta').textContent = 'loop process not reachable (finished?)'; }
}
tick(); setInterval(tick, 1000);

// ?follow=1 (used by the recorder): keep the panel of the active stage in view, so a fixed-size capture shows every step.
if (new URLSearchParams(location.search).get('follow') === '1') {
  const panelFor = { baseline: 'p-wrong', detect: 'p-wrong', kane: 'p-kane', propose: 'p-change', evaluate: 'p-improve', decide: 'p-improve', journal: 'p-improve' };
  let last = '';
  setInterval(async () => {
    try {
      const st = await (await fetch('/api/status', { cache: 'no-store' })).json();
      const cy = st.cycles[st.cycles.length - 1]; if (!cy) return;
      const active = cy.stages.find(s => s.state === 'running') || [...cy.stages].reverse().find(s => s.state !== 'pending');
      const id = active ? panelFor[active.key] : 'p-wrong';
      if (id !== last) { document.getElementById(id).scrollIntoView({ behavior: 'smooth', block: 'start' }); last = id; }
    } catch { /* loop finished */ }
  }, 1500);
}
