/* Rule Sabotage PLAYTEST shell. Consent, opponent choice, restart, match review and the post-game questionnaire.
   The game itself is the unchanged production client (app.js), loaded after the start screen. */
(() => {
'use strict';
const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const sec = ms => (ms == null ? '—' : `${(ms / 1000).toFixed(1)} s`);
async function api(path, body) {
  const r = await fetch(path, body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.reason || j.error || `HTTP ${r.status}`);
  return j;
}
const show = id => { $(id).hidden = false; }, hide = id => { $(id).hidden = true; };

let info = null, session = null, appLoaded = false, handledEnd = null, live = null, lastGameId = null;
const opp = id => info?.opponents.find(o => o.id === id);
const game = () => window.__ruleSabotage?.view ?? null;
const appBusy = () => !!window.__ruleSabotage?.busy;

// ---------- start screen ----------
async function boot() {
  info = await api('/api/playtest/info');
  $('pt-consent-text').innerHTML = `<p>${esc(info.consent.statement)}</p>` + (info.integrity.matches ? '' : `<p class="pt-err">Warning: the opponent code differs from the frozen V5.3 version (${esc(info.integrity.mismatched.join(', '))}). Every game is labelled MODIFIED.</p>`);
  $('pt-agree').addEventListener('click', () => startSession(true));
  $('pt-decline').addEventListener('click', () => startSession(false));
  $('pt-go').addEventListener('click', chooseAndStart);
  $('pt-select-cancel').addEventListener('click', () => hide('pt-select'));
  $('pt-restart').addEventListener('click', restart);
  $('pt-switch').addEventListener('click', () => openSelect(true));
  $('pt-review-btn').addEventListener('click', () => openReview(game()?.gameId));
  $('pt-review-close').addEventListener('click', () => hide('pt-review'));
  $('pt-fb-review').addEventListener('click', () => openReview(handledEnd));
  $('pt-fb-send').addEventListener('click', () => sendFeedback(false));
  $('pt-fb-skip').addEventListener('click', () => sendFeedback(true));
  $('pt-endsession').addEventListener('click', endSession);
  $('pt-withdraw').addEventListener('click', withdraw);
  $('pt-restart-session').addEventListener('click', () => location.reload());
  $('pt-next-go').addEventListener('click', () => { hide('pt-next'); startGame(); });
  // The playtest flow decides when the next game starts: the production R shortcut is disabled here.
  document.addEventListener('keydown', e => { if (e.key === 'r' || e.key === 'R') { if (!(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement)) e.stopImmediatePropagation(); } }, true);
  renderOpps();
  setInterval(tick, 400);
}
async function startSession(consent) {
  const mode = document.querySelector('input[name="pt-mode"]:checked').value;
  try {
    session = await api('/api/playtest/session', { consent, participant: $('pt-code').value, mode });
  } catch (e) { $('pt-start-err').textContent = e.message; return; }
  hide('pt-start');
  $('pt-rec').innerHTML = session.consented ? '<span class="pt-on">● recording (with consent)</span>' : '<span class="pt-off">○ not recording</span>';
  $('pt-switch').hidden = session.mode !== 'free';
  if (session.mode === 'pilot') showNext(); else openSelect(false);
}

// ---------- opponents ----------
function renderOpps() {
  $('pt-opps').innerHTML = info.opponents.map(o => `
    <label class="pt-opp ${o.slow ? 'slow' : ''}">
      <input type="radio" name="pt-opp" value="${esc(o.id)}">
      <b>${esc(o.label)}</b> <span class="pt-tag">EXPERIMENTAL</span>${o.slow ? ' <span class="pt-tag slow">MAY BE SLOW</span>' : ''}
      <small>${esc(o.version)} · code ${esc(o.implementation.all)}${o.implementation.matchesFrozenV53 ? ' (= frozen V5.3)' : ' MODIFIED'}</small>
      <p>${esc(o.description)}</p><p class="pt-sub">${esc(o.latencyNote)}</p>
    </label>`).join('');
  $('pt-opps').addEventListener('change', () => { $('pt-go').disabled = !document.querySelector('input[name="pt-opp"]:checked'); });
}
function openSelect(cancellable) { $('pt-select-cancel').hidden = !cancellable; show('pt-select'); }
async function chooseAndStart() {
  const o = document.querySelector('input[name="pt-opp"]:checked')?.value, first = document.querySelector('input[name="pt-first"]:checked').value;
  const g = game();
  if (g && !g.winner && appLoaded && !confirm('Changing the opponent ends the current game (it is kept as unfinished). Continue?')) return;
  session = await api('/api/playtest/select', { opponent: o, first });
  hide('pt-select');
  startGame();
}
function showNext() {
  const n = session.next;
  if (n.error) return finishSession(n.error);
  const p = session.plan;
  $('pt-next-title').textContent = p ? `Game ${p.done + 1} of ${p.slots.length}` : 'Next game';
  $('pt-next-body').innerHTML = `<p>Opponent: <b>${esc(n.opponent.label)}</b> <span class="pt-tag">EXPERIMENTAL</span>${n.opponent.slow ? ' <span class="pt-tag slow">MAY BE SLOW</span>' : ''}</p>
    <p class="pt-sub">${esc(n.opponent.version)} · code ${esc(n.opponent.implementation.all)}</p><p>${esc(n.opponent.description)}</p>
    <p>${n.first === 'human' ? 'You move first.' : n.first === 'ai' ? 'The opponent moves first.' : 'A coin flip decides who moves first.'}</p>`;
  show('pt-next');
}

// ---------- games ----------
function startGame() {
  handledEnd = null;
  if (!appLoaded) {
    appLoaded = true;
    const s = document.createElement('script');
    s.src = 'app.js';
    // app.js starts on DOMContentLoaded, which has already fired: replay it once for the newly loaded client.
    s.onload = () => document.dispatchEvent(new Event('DOMContentLoaded'));
    document.body.appendChild(s);
  } else $('rematch-btn').click();
}
function restart() {
  const g = game();
  if (!g || appBusy()) return;
  if (!g.winner && !confirm('Restart? The current game is kept as unfinished and a new one starts with the same opponent.')) return;
  startGame();
}
async function refreshSession() { try { session = await api('/api/playtest/session'); } catch { /* ignore */ } }

async function tick() {
  const g = game();
  $('pt-restart').disabled = !g || appBusy();
  $('pt-review-btn').disabled = !g;
  if (!g) return;
  if (g.gameId !== lastGameId) { lastGameId = g.gameId; await refreshSession(); }
  try { live = await api('/api/playtest/live'); } catch { live = null; }
  const o = opp(live?.opponent ?? session?.current?.opponent);
  if (o) {
    $('pt-opp').innerHTML = `Opponent: <b>${esc(o.label)}</b> <small>${esc(o.version)} · ${esc(o.implementation.all)}</small> <span class="pt-tag">EXPERIMENTAL</span>${o.slow ? ' <span class="pt-tag slow">MAY BE SLOW</span>' : ''}`;
    const chip = $('brain-chip'), want = `AI brain: ${o.label} (experimental playtest opponent)`;
    if (chip.textContent !== want) { chip.textContent = want; chip.className = 'chip mode off'; }
    // app.js labels every non-LLM decision "Local planner"; in the playtest that is always the named experimental opponent.
    for (const el of document.querySelectorAll('#ai-record b, #log .ai-record')) {
      if (el.firstChild?.nodeType === 3 && el.firstChild.nodeValue.startsWith('Local planner')) el.firstChild.nodeValue = o.label + el.firstChild.nodeValue.slice('Local planner'.length);
    }
    $('pt-oppcard').innerHTML = `<b>${esc(o.label)}</b> <small>${esc(o.version)}</small><br><small>Last answer ${sec(live?.lastMs)} · slowest this game ${sec(live?.maxMs)}${live?.budgetHits ? ` · work budget reached ${live.budgetHits}×` : ''}</small>`;
  }
  $('pt-latency').innerHTML = live?.thinkingMs != null ? `<span class="pt-think">${esc(o?.label ?? 'Opponent')} is thinking… ${sec(live.thinkingMs)}</span>` : live?.lastMs != null ? `last answer ${sec(live.lastMs)}` : '';
  if (g.winner && handledEnd !== g.gameId && !appBusy()) { handledEnd = g.gameId; setTimeout(() => gameEnded(g), 900); }
}

// ---------- end of a game ----------
const ITEMS = [
  ['enjoyment', 'How much did you enjoy this game?'],
  ['challenge', 'How challenging was the opponent?'],
  ['predictability', 'How predictable was the opponent? (5 = very predictable)'],
  ['strategicChoice', 'How much did you feel you had real choices to make?'],
  ['playAgain', 'How much would you like to play again?'],
];
const TAGS = [['repetitive', 'It felt repetitive'], ['unfair', 'It felt unfair'], ['confusing', 'Something was confusing'], ['satisfying', 'It felt satisfying']];
function gameEnded(g) {
  hide('gameover');
  const res = g.winner === 'human' ? 'You won.' : g.winner === 'ai' ? 'The opponent won.' : 'Draw.';
  $('pt-fb-sub').textContent = `${res} ${g.winReason || ''} (${g.turn} turns)`;
  $('pt-fb-form').innerHTML = ITEMS.map(([k, q]) => `<fieldset class="pt-likert"><legend>${esc(q)}</legend>${[1, 2, 3, 4, 5].map(v => `<label><input type="radio" name="${k}" value="${v}">${v}</label>`).join('')}</fieldset>`).join('')
    + `<fieldset class="pt-tags"><legend>Tick any that apply</legend>${TAGS.map(([k, t]) => `<label><input type="checkbox" name="tag" value="${k}"> ${esc(t)}</label>`).join('')}</fieldset>`
    + '<label class="pt-row">Anything that felt repetitive, unfair, confusing or satisfying? <small>(optional; no names please)</small><textarea id="pt-comment" maxlength="600" rows="3"></textarea></label>';
  if (!session.consented) { $('pt-fb-form').innerHTML = '<p class="pt-sub">You chose not to record, so there are no questions. You can still review the match.</p>'; $('pt-fb-send').hidden = true; $('pt-fb-skip').textContent = 'Continue'; }
  else { $('pt-fb-send').hidden = false; $('pt-fb-skip').textContent = 'Skip questions'; }
  show('pt-feedback');
}
async function sendFeedback(skipped) {
  const gameId = handledEnd;
  if (session.consented) {
    const f = $('pt-fb-form'), ratings = {};
    for (const [k] of ITEMS) { const v = f.querySelector(`input[name="${k}"]:checked`); ratings[k] = v ? Number(v.value) : null; }
    const tags = [...f.querySelectorAll('input[name="tag"]:checked')].map(x => x.value);
    try { await api('/api/playtest/feedback', { gameId, skipped, ratings, tags, comment: $('pt-comment')?.value || '' }); } catch (e) { if (!/Already/.test(e.message)) { alert(e.message); return; } }
  }
  hide('pt-feedback');
  await refreshSession();
  if (session.mode === 'pilot') showNext();
  else { $('pt-next-title').textContent = 'Play again?'; $('pt-next-body').innerHTML = `<p>Same opponent: <b>${esc(opp(session.free.opponent)?.label)}</b>. Use “Change opponent” in the top bar to pick another one.</p>`; show('pt-next'); }
}

// ---------- match review ----------
async function openReview(gameId) {
  if (!gameId) return;
  let r;
  try { r = await api(`/api/playtest/review/${gameId}`); } catch (e) { alert(e.message); return; }
  const who = p => (p === 'human' ? 'You' : esc(r.opponent.label));
  const rows = r.turns.map(t => {
    const bits = [];
    if (t.placement) bits.push(`effect “${esc(t.placement.text)}” → ${esc(t.placement.effect)} on ${esc(t.placement.cells.join(' '))} <i>(${esc(t.placement.verdict)}${t.placement.tier ? `, tier ${t.placement.tier}` : ''}${t.placement.placed.length ? '' : ', not placed'})</i>`);
    if (t.removed.length) bits.push(`removed ${esc(t.removed.join(' '))}`);
    if (t.moves.length) bits.push(`moves ${t.moves.map(m => `${esc(m.from)} ${esc(m.dir)}`).join(', ')}`);
    for (const x of t.triggers) bits.push(`<span class="pt-trig">${x.mover === 'human' ? 'you' : 'AI'} hit ${x.self ? 'own' : x.owner === 'human' ? 'your' : 'AI'} “${esc(x.label)}” on ${esc(x.cell)}${x.chain > 1 ? ' (chain)' : ''}</span>`);
    for (const c of t.captures) bits.push(`<span class="pt-trig">${c.by === 'human' ? 'you' : 'AI'} captured on ${esc(c.cell)}</span>`);
    if (t.ai) bits.push(`<small>answered in ${sec(t.ai.wallMs)}${t.ai.meta?.budgetHit ? ' · work budget reached' : ''}${t.ai.placementBlocked ? ` · effect not placed (${esc(t.ai.placementBlocked)})` : ''}</small>`);
    return `<tr class="${t.p}"><td>${t.turn}</td><td>${who(t.p)}</td><td>${bits.join('<br>') || '<i>passed</i>'}</td><td>${t.scoredAfter.human}–${t.scoredAfter.ai}</td></tr>`;
  }).join('');
  const L = r.aiLatencyMs, R = r.result;
  $('pt-review-body').innerHTML = `
    <p><b>${esc(r.opponent.label)}</b> · ${esc(r.opponent.version)} · code ${esc(r.opponent.implementation.all)} · seed ${r.seed} · ${r.first === 'human' ? 'you' : 'the opponent'} moved first</p>
    <p>${R.abandoned ? 'Unfinished (restarted or ended)' : R.winner === 'human' ? 'You won' : R.winner === 'ai' ? 'The opponent won' : R.winner === 'draw' ? 'Draw' : 'In progress'} · ${R.turns} turns${R.turnLimit ? ' · ended by the turn limit' : ''} · lead changes ${r.reversals.leadChanges} · effects triggered ${r.interactions.triggers} (${r.interactions.selfTriggers} by their own owner)</p>
    <p>Opponent answer time: median ${sec(L.median)}, slowest ${sec(L.max)}${L.budgetHits ? `, work budget reached ${L.budgetHits}×` : ''} · ${r.recorded ? 'recorded with consent' : 'not recorded (kept in memory only)'}</p>
    <table class="pt-table"><thead><tr><th>Turn</th><th>Who</th><th>What happened</th><th>Across</th></tr></thead><tbody>${rows}</tbody></table>`;
  show('pt-review');
}

// ---------- session end ----------
async function endSession() {
  if (appBusy()) return alert('Wait until the opponent has finished its turn.');
  if (!session) return;
  if (!confirm('End the session? An unfinished game is kept as unfinished.')) return;
  await api('/api/playtest/end', {}).catch(() => {});
  finishSession('Thank you for playing.');
}
function finishSession(msg) {
  ['pt-next', 'pt-feedback', 'pt-select', 'gameover'].forEach(hide);
  $('pt-done-body').innerHTML = `<p>${esc(msg)}</p><p class="pt-sub">${session?.consented ? 'Your games and answers were recorded on this computer only. You can delete them now.' : 'Nothing was recorded.'}</p>`;
  $('pt-withdraw').hidden = !session?.consented;
  show('pt-done');
}
async function withdraw() {
  if (!confirm('Delete every game record and answer from this session? This cannot be undone.')) return;
  const r = await api('/api/playtest/withdraw', {});
  session.consented = false;
  $('pt-done-body').innerHTML = `<p>Deleted (${r.removedFiles} file${r.removedFiles === 1 ? '' : 's'}). Nothing from this session is kept.</p>`;
  $('pt-withdraw').hidden = true; $('pt-rec').innerHTML = '<span class="pt-off">○ not recording</span>';
}

boot().catch(e => { $('pt-start-err').textContent = 'Could not reach the playtest server: ' + e.message; });
})();
