/* Rule Sabotage client. Renders server state; never decides game outcomes itself. */
(() => {
'use strict';
const $ = id => document.getElementById(id);
const SIZE = 7, COLS = 'ABCDEFG';
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const name = k => { const [x, y] = k.split(',').map(Number); return COLS[x] + (y + 1); };
const who = p => (p === 'human' ? 'You' : 'AI');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const IDEAS = ['Anything entering here is shoved 2 squares north', 'Step here and get pushed back 2', 'Frozen for a turn', 'Sent back to the start', 'Gives a shield against the next trap', '+1 extra move', '밟으면 남쪽으로 두 칸 밀려난다', '이 칸에 들어오면 한 턴 얼어붙는다'];

let view = null, busy = false, selected = null, pending = null, picked = new Set(), removing = new Set(), anim = null, lastAI = null;

async function api(path, body) {
  const r = await fetch(path, body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.reason || j.error || `HTTP ${r.status}`);
  return j;
}

// ---------- board ----------
function buildBoard() {
  $('col-labels').replaceChildren(...[...COLS].map(c => Object.assign(document.createElement('span'), { textContent: c })));
  $('row-labels').replaceChildren(...Array.from({ length: SIZE }, (_, i) => Object.assign(document.createElement('span'), { textContent: i + 1 })));
  const b = $('board');
  for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) {
    const c = document.createElement('button');
    c.type = 'button'; c.className = 'cell'; c.dataset.cell = `${x},${y}`;
    c.addEventListener('click', () => onCell(c.dataset.cell));
    b.appendChild(c);
  }
}
const ruleById = id => view.rules.find(r => r.id === id);
const myTurn = () => view && !busy && !view.winner && view.current === 'human';
const placing = () => myTurn() && view.phase === 'place';

function renderBoard() {
  if (!view) return;
  const pieces = anim ? anim.pieces : view.pieces, cells = anim ? anim.cells : view.cells;
  const eligible = new Set(placing() && pending ? view.eligible : []);
  const targets = new Set();
  if (myTurn() && selected) for (const m of view.legal) if (m.from === selected) targets.add(neighbour(m.from, m.dir));
  for (const c of $('board').querySelectorAll('.cell')) {
    const k = c.dataset.cell, [x] = k.split(',').map(Number);
    const rid = cells[k], rule = rid ? (anim ? anim.rules.get(rid) : ruleById(rid)) : null;
    c.className = 'cell' + (x === 6 ? ' goal-human' : x === 0 ? ' goal-ai' : '') + (rule ? ` trap-${rule.owner}` : '')
      + (eligible.has(k) ? ' pickable' : '') + (picked.has(k) ? ' picked' : '') + (removing.has(k) ? ' removing' : '')
      + (selected === k ? ' selected' : '') + (targets.has(k) ? ' target' : '') + (anim?.flash?.has(k) ? ' boom' : '');
    const here = pieces.filter(q => !q.scored && `${q.x},${q.y}` === k);
    let html = rule ? `<span class="ticon" title="${esc(rule.label)}">${esc(rule.icon)}</span>` : '';
    for (const owner of ['human', 'ai']) {
      const mine = here.filter(q => q.owner === owner);
      if (!mine.length) continue;
      const frozen = mine.filter(q => q.frozen).length, shield = mine.some(q => q.shield);
      html += `<span class="token ${owner}${frozen ? ' frozen' : ''}">${mine.length > 1 ? '×' + mine.length : ''}${shield ? '<i>🛡</i>' : ''}${frozen ? '<i>🧊</i>' : ''}</span>`;
    }
    c.innerHTML = html;
    const label = `${name(k)}${rule ? `, ${rule.owner === 'human' ? 'your' : 'AI'} effect ${rule.label}` : ''}${here.length ? `, ${here.map(q => q.owner === 'human' ? 'your piece' : 'AI piece').join(', ')}` : ''}`;
    c.setAttribute('aria-label', label);
  }
}
function neighbour(k, dir) { const [x, y] = k.split(',').map(Number); const d = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] }[dir]; return `${x + d[0]},${y + d[1]}`; }

// ---------- side panels ----------
function renderSides() {
  for (const p of ['human', 'ai']) {
    const rules = view.rules.filter(r => r.owner === p && r.cells.length);
    $(`${p}-score`).textContent = `${view.scored[p]}/3 across`;
    $(`${p}-count`).textContent = `${view.active[p]} cell${view.active[p] === 1 ? '' : 's'}`;
    $(`${p}-rules`).replaceChildren(...(rules.length ? rules.map(r => {
      const d = document.createElement('div');
      d.className = `slot filled ${p}`;
      d.innerHTML = `<div class="slot-head"><span>${esc(r.icon)}</span><b>${esc(r.label)}</b><small>turn ${r.turn}</small></div><q>${esc(r.text)}</q>`
        + (r.approxNote ? `<small class="approx">≈ ${esc(r.approxNote)}</small>` : '') + `<div class="cells"></div>`;
      for (const k of r.cells) {
        const b = document.createElement(p === 'human' ? 'button' : 'span');
        b.className = 'cellchip' + (removing.has(k) ? ' on' : ''); b.textContent = name(k);
        if (p === 'human') { b.type = 'button'; b.disabled = !placing(); b.title = 'Mark for removal'; b.addEventListener('click', () => toggleRemove(k)); }
        d.querySelector('.cells').appendChild(b);
      }
      return d;
    }) : [Object.assign(document.createElement('div'), { className: 'slot empty', textContent: 'No effects on the board.' })]));
  }
  $('remove-hint').hidden = !placing() || !view.active.human;
}

function render() {
  if (!view) return;
  $('turn-chip').textContent = `Turn ${view.turn} / ${view.maxTurns}`;
  const ac = $('actions-chip');
  ac.textContent = view.winner ? 'Game over' : view.current === 'human' ? `Your turn · ${view.actionsLeft} action${view.actionsLeft === 1 ? '' : 's'} left` : 'AI’s turn';
  ac.className = 'chip ' + (view.current === 'human' ? 'pri-human' : 'pri-ai');
  $('phase-banner').textContent = view.winner ? 'Game over' : busy ? 'Working…' : view.current !== 'human' ? 'AI is playing' : view.phase === 'place' ? 'Place an effect (optional), then move' : 'Move your pieces';
  const canWrite = placing();
  $('rule-input').disabled = !canWrite; $('interpret-btn').disabled = !canWrite;
  for (const b of document.querySelectorAll('.idea')) b.disabled = !canWrite;
  const pb = $('place-btn');
  pb.hidden = !canWrite || (!pending && !removing.size);
  const needsConsent = pending?.approx && picked.size && !$('pv-approx')?.checked;
  pb.disabled = Boolean(needsConsent) || ((pending && !picked.size) && !removing.size);
  pb.textContent = pending && picked.size ? `Place on ${picked.size} cell${picked.size > 1 ? 's' : ''}${removing.size ? ` and remove ${removing.size}` : ''} → referee`
    : pending ? 'Pick cells on the board' : `Remove ${removing.size} effect cell${removing.size > 1 ? 's' : ''}`;
  $('end-btn').disabled = !myTurn();
  const stackHere = selected && view.pieces.filter(q => !q.scored && q.owner === 'human' && `${q.x},${q.y}` === selected).length > 1;
  $('single-mode').disabled = !stackHere;
  renderSides(); renderBoard(); renderPreviewPick();
}
function renderPreviewPick() {
  const n = $('preview').querySelector('.pick-count');
  if (n) n.textContent = `${picked.size} / ${view.maxCells} cells picked`;
}

// ---------- placement ----------
async function interpret() {
  if (!placing()) return;
  const text = $('rule-input').value.trim();
  if (!text) return;
  const pv = $('preview');
  pv.hidden = false; pv.innerHTML = '<span class="muted">Interpreting…</span>';
  try {
    const r = await api(`/api/game/${view.gameId}/preview`, { text });
    const i = r.interpretation;
    const src = i.source === 'openrouter' ? `Interpreted by ${view.provider || 'the model'} · ${view.model} (${r.ms} ms)` : i.source === 'input-guard' ? 'Blocked by the input guard' : 'Interpreted by the offline parser' + (r.fallback ? ` (${r.fallback})` : '');
    if (i.status === 'reject') {
      pending = null; picked.clear();
      pv.innerHTML = `<div class="pv-head reject"><span class="pv-icon">⛔</span><div><b>Not allowed</b><p>${esc(i.reason)}</p></div></div><div class="pv-src">${esc(src)}</div>`;
    } else {
      pending = { token: r.token, label: r.label, approx: i.status === 'approximate' };
      pv.innerHTML = `<div class="pv-head"><span class="pv-icon">✅</span><div><b>${esc(r.label)}</b><p>${esc(i.summary)}</p></div></div>`
        + (i.status === 'approximate' ? `<label class="approx-box"><input type="checkbox" id="pv-approx"> <span>≈ Approximated: ${esc(i.note)} Tick to accept the approximation.</span></label>` : '')
        + `<div class="pv-meta">Now click up to <b>${view.maxCells}</b> highlighted cells. <span class="pick-count"></span></div><div class="pv-src">${esc(src)}</div>`;
    }
  } catch (e) { pv.innerHTML = `<span class="warn">${esc(e.message)}</span>`; }
  $('pv-approx')?.addEventListener('change', render);
  render();
}
function toggleRemove(k) { if (!placing()) return; removing.has(k) ? removing.delete(k) : removing.add(k); picked.delete(k); render(); }

async function place() {
  if (!placing()) return;
  const body = { remove: [...removing] };
  if (pending && picked.size) { body.token = pending.token; body.cells = [...picked]; }
  await withBusy(async () => {
    showReferee(true, pending && picked.size ? 'Kane is examining your rule…' : 'Removing…');
    const r = await api(`/api/game/${view.gameId}/place`, body);
    view = r.view; pending = null; picked.clear(); removing.clear();
    $('preview').hidden = true; $('rule-input').value = '';
    showVerdicts(r.verdicts);
    logTurn('You', r.events, r.verdicts);
    await playEvents(r.events);
  });
}

// ---------- moving ----------
function onCell(k) {
  if (!myTurn()) return;
  if (placing() && pending && view.eligible.includes(k)) {
    if (picked.has(k)) picked.delete(k); else if (picked.size < view.maxCells) picked.add(k);
    return render();
  }
  if (view.legal.some(m => m.from === k)) { selected = selected === k ? null : k; return render(); }
  if (selected) {
    const m = view.legal.find(m => m.from === selected && neighbour(m.from, m.dir) === k);
    if (m) move(m.dir);
  }
}
async function move(dir) {
  if (!myTurn() || !selected) return;
  const mode = $('single-mode').checked ? 'single' : 'stack';
  const m = view.legal.find(x => x.from === selected && x.dir === dir && x.mode === mode) || view.legal.find(x => x.from === selected && x.dir === dir);
  if (!m) return flash('That move is not possible.');
  await withBusy(async () => {
    const r = await api(`/api/game/${view.gameId}/move`, m);
    const before = view;
    await playEvents(r.events, before);
    view = r.view;
    logTurn('You', r.events);
    react(r.reactions);
    const dest = r.events.find(e => e.t === 'move')?.to;
    selected = dest && view.legal.some(x => x.from === dest) ? dest : null;
  });
  if (view.winner) return gameOver();
  if (myTurn() && (view.actionsLeft <= 0 || !view.legal.length)) { await sleep(350); endTurn(); }
}
async function endTurn() {
  if (!myTurn()) return;
  selected = null; pending = null; picked.clear(); removing.clear(); $('preview').hidden = true;
  await withBusy(async () => {
    $('ai-lock').textContent = 'AI is planning its turn…';
    const r = await api(`/api/game/${view.gameId}/end`, {});
    await applyAI(r.ai, r.view);
  });
  if (view.winner) gameOver();
}
async function applyAI(ai, finalView) {
  if (!ai) { view = finalView; return; }
  lastAI = ai;
  const d = ai.decision;
  if (d.taunt) say(d.taunt, 'Said before its move');
  showVerdicts(ai.verdicts);
  const before = view;
  view = { ...finalView, pieces: before?.pieces ?? finalView.pieces };
  await playEvents(ai.events, before);
  view = finalView;
  logTurn('AI', ai.events.concat(ai.endEvents || []), ai.verdicts, d);
  react(ai.reactions);
  $('ai-record').innerHTML = `<b>${d.source === 'openrouter' ? `${esc(d.provider || 'LLM')} (${esc(d.model)})` : 'Local planner'}</b> chose: ${esc(d.plan.chosen)}<br><small>${esc(d.rationale)}${d.fallbackReason ? ` · fallback: ${esc(d.fallbackReason)}` : ''}</small>`;
  $('ai-lock').textContent = '';
}

// ---------- animation: replay engine events on a local copy ----------
async function playEvents(events, before = view) {
  if (!events?.length || !before) return;
  anim = { pieces: structuredClone(before.pieces), cells: { ...before.cells }, rules: new Map(before.rules.map(r => [r.id, r])), flash: new Set() };
  const byId = id => anim.pieces.find(q => q.id === id);
  for (const e of events) {
    let wait = 0;
    if (e.t === 'place') { anim.rules.set(e.ruleId, { id: e.ruleId, owner: e.p, label: e.label, icon: e.icon }); for (const k of e.cells) anim.cells[k] = e.ruleId; anim.flash = new Set(e.cells); wait = 450; }
    else if (e.t === 'remove') { for (const k of e.cells) delete anim.cells[k]; wait = 200; }
    else if (e.t === 'move') { const [x, y] = e.to.split(',').map(Number); for (const id of e.pieces) Object.assign(byId(id), { x, y }); wait = 260; }
    else if (e.t === 'trigger') { delete anim.cells[e.cell]; anim.flash = new Set([e.cell]); floatText(e.cell, `${e.label}${e.self ? ' (own!)' : ''}`, e.self ? 'self' : 'bad'); if (e.self && e.kind !== 'shield' && e.kind !== 'haste') banner(`${who(e.p)} stepped on ${e.p === 'human' ? 'your' : 'its'} own effect!`, 'self'); wait = 520; }
    else if (e.t === 'shielded') { delete anim.cells[e.cell]; floatText(e.cell, 'Shielded', 'good'); wait = 350; }
    else if (e.t === 'forced') { const dest = e.to.split('|'); e.pieces.forEach((id, i) => { const [x, y] = (dest[i] || dest[0]).split(',').map(Number); Object.assign(byId(id), { x, y }); }); wait = 380; }
    else if (e.t === 'status') { for (const id of e.pieces) { const q = byId(id); if (e.status === 'freeze') q.frozen = 1; else q.shield = true; } wait = 200; }
    else if (e.t === 'capture') { for (const id of e.pieces) { const q = byId(id); Object.assign(q, { x: q.home.x, y: q.home.y, frozen: 0, shield: false }); } floatText(e.cell, 'Captured!', 'clash'); wait = 420; }
    else if (e.t === 'score') { for (const id of e.pieces) byId(id).scored = true; floatText(e.cell, `Across! (${e.total}/3)`, 'good'); wait = 380; }
    if (wait) { renderBoard(); await sleep(wait); anim.flash = new Set(); }
  }
  anim = null; renderBoard();
}
function floatText(k, text, cls) {
  const cell = $('board').querySelector(`[data-cell="${k}"]`); if (!cell) return;
  const f = document.createElement('div'); f.className = `float ${cls}`; f.textContent = text;
  const b = $('board').getBoundingClientRect(), c = cell.getBoundingClientRect();
  f.style.left = `${c.left - b.left + c.width / 2}px`; f.style.top = `${c.top - b.top}px`;
  $('board').appendChild(f); setTimeout(() => f.remove(), 1500);
}
function banner(text, cls = '') { const b = $('banner'); b.className = 'banner ' + cls; b.textContent = text; b.hidden = false; clearTimeout(banner.t); banner.t = setTimeout(() => { b.hidden = true; }, 1600); }
const flash = t => banner(t, 'msg');
function say(text, note) { const s = $('speech'); s.hidden = false; s.innerHTML = `<div class="bubble">${esc(text)}</div><small>${esc(note)}</small>`; }
function react(list) { if (list?.length) say(list[0].text, 'Reaction after the fact, not the AI’s reasoning'); }

// ---------- referee ----------
const announced = new Set();
let progressTimer = null;
function showReferee(working, text) {
  const r = $('referee'); r.hidden = false;
  r.innerHTML = `<div class="ref-title">Referee</div><div class="kane-working">${esc(text)}</div><ul id="ref-progress"></ul>`;
  clearInterval(progressTimer);
  if (working) progressTimer = setInterval(pollProgress, 600);
}
async function pollProgress() {
  if (!view || !busy) return clearInterval(progressTimer);
  try { const p = await api(`/api/game/${view.gameId}/progress`); const ul = $('ref-progress'); if (ul) ul.innerHTML = p.progress.map(x => `<li>${esc(x.text)}</li>`).join(''); } catch { /* ignore */ }
}
function showVerdicts(vs) {
  clearInterval(progressTimer);
  markAnnounced(vs);
  if (!vs?.length) { if (!$('referee').querySelector('.verdict')) $('referee').hidden = true; return; }
  const r = $('referee'); r.hidden = false;
  r.innerHTML = '<div class="ref-title">Referee</div>' + vs.map(v => {
    const k = v.kane;
    const title = v.final === 'pending' ? `🔎 Kane is examining ${v.player === 'human' ? 'your' : 'the AI’s'} rule… keep playing` : v.final === 'approved' ? `✅ Kane approved ${v.player === 'human' ? 'your' : 'the AI’s'} rule` : v.final === 'engine-approved' ? `✔ Engine approved ${v.player === 'human' ? 'your' : 'the AI’s'} rule (tier ${v.tier?.tier ?? '?'}, not reviewed by Kane)` : v.final === 'rejected' ? `⛔ ${k ? 'Kane' : 'The engine'} rejected ${v.player === 'human' ? 'your' : 'the AI’s'} rule` : `⚠ ${v.player === 'human' ? 'Your' : 'The AI’s'} rule is NOT Kane-verified`;
    const meta = [`“${esc(v.ruleText)}” → ${esc(v.label)} on ${v.cells.join(' ')}`, `<a href="/trial/${v.trial.trialId}" target="_blank" rel="noopener">trial ${v.trial.trialId}</a> · scenarios ${v.trial.scenarioIds.join(', ')}`];
    if (k) meta.push(`Kane ${esc(k.version || '')} · ${k.cached ? 'cached verdict' : `${(k.elapsedMs / 1000).toFixed(1)} s`}${k.conditionResults?.length ? ` · ${k.conditionResults.filter(c => c === true).length}/${k.conditionResults.length} conditions true` : ''}`);
    if (v.timing?.submitToVerdictMs != null) meta.push(`Decided by ${v.decidedBy === 'kane' ? 'Kane' : v.decidedBy === 'engine' ? `the engine (tier ${v.tier?.tier})` : 'engine checks only'} ${(v.timing.submitToVerdictMs / 1000).toFixed(1)} s after it was submitted`);
    meta.push(v.final === 'pending' ? `Proposed on turn ${v.proposedTurn}. It goes live only if Kane approves it.` : v.activated ? `Status: live on ${v.placedCells.join(' ')}${v.resolvedTurn !== v.proposedTurn ? ` (approved on turn ${v.resolvedTurn})` : ''}` : 'Status: not placed');
    return `<div class="verdict ${v.final}"><b>${title}</b><div>${esc(v.message)}</div><div class="v-meta">${meta.join('<br>')}</div></div>`;
  }).join('');
}

// ---------- background Kane reviews ----------
function markAnnounced(vs) { for (const v of vs || []) if (v.final !== 'pending') announced.add(v.reviewId); }
async function pollReviews() {
  if (!view || busy || !view.reviews) return;
  let fresh = view;
  if (view.reviews.some(r => r.final === 'pending')) {
    try { fresh = await api(`/api/game/${view.gameId}`); } catch { return; }
    if (busy || !view || fresh.gameId !== view.gameId) return;
  }
  const done = fresh.reviews.filter(r => r.final !== 'pending' && !announced.has(r.reviewId));
  if (!done.length) { if (fresh !== view) view = { ...view, reviews: fresh.reviews }; return; }
  busy = true;
  try {
    markAnnounced(done);
    showVerdicts(done);
    const before = view;
    for (const r of done) { await playEvents(r.events, before); logTurn(r.player === 'human' ? 'You' : 'AI', r.events, [r]); }
    if (done.some(r => r.final === 'approved')) banner(done.length > 1 ? 'Kane verdicts are in' : `Kane ${done[0].final} ${done[0].player === 'human' ? 'your' : 'the AI’s'} rule`, 'msg');
    view = fresh;
  } finally { busy = false; render(); }
}

// ---------- log ----------
function eventText(e) {
  switch (e.t) {
    case 'remove': return `removed effects on ${e.cells.map(name).join(' ')}`;
    case 'place': return `placed ${e.icon} “${e.label}” on ${e.cells.map(name).join(' ')}${e.replaced.length ? ` (replacing ${e.replaced.map(name).join(' ')})` : ''}`;
    case 'move': return `moved ${e.pieces.length > 1 ? `a stack of ${e.pieces.length}` : 'a piece'} ${name(e.from)} → ${name(e.to)}`;
    case 'trigger': return `${e.pieces.length > 1 ? 'pieces' : 'piece'} entered ${e.owner === e.p ? 'its own' : e.owner === 'human' ? 'your' : 'the AI’s'} “${e.label}” at ${name(e.cell)}${e.chain > 1 ? ` (chain ×${e.chain})` : ''}`;
    case 'shielded': return `shield absorbed the effect at ${name(e.cell)}`;
    case 'forced': return e.how === 'home' ? 'sent back to the start' : `${e.how === 'teleport' ? 'teleported' : 'shoved'} ${name(e.from)} → ${name(e.to)}`;
    case 'status': return e.status === 'freeze' ? 'frozen for a turn' : 'gained a shield';
    case 'haste': return `+1 action ${e.now ? 'right now' : 'next turn'}`;
    case 'capture': return `captured ${e.pieces.length} piece${e.pieces.length > 1 ? 's' : ''} at ${name(e.cell)}`;
    case 'stack': return `stacked ${e.pieces.length} pieces at ${name(e.cell)}`;
    case 'score': return `got a piece across (${e.total}/3)`;
    case 'chain-limit': return `chain reaction stopped at ${name(e.cell)} (limit)`;
    case 'win': return e.reason;
    default: return '';
  }
}
function logTurn(by, events, verdicts = [], decision = null) {
  const lines = events.map(eventText).filter(Boolean);
  for (const v of verdicts) {
    if (v.final === 'pending') lines.unshift(`rule “${v.ruleText}” sent to Kane for review (${v.cells.join(' ')})`);
    else if (!v.activated) lines.unshift(`rule “${v.ruleText}” was not placed (${v.final})`);
  }
  if (!lines.length) return;
  const li = document.createElement('li');
  li.innerHTML = `<b class="${by === 'You' ? 'h' : 'a'}">${by}</b> · turn ${view.turn}<ul>${lines.map(l => `<li>${esc(l)}</li>`).join('')}</ul>` + (decision ? `<div class="ai-record">${esc(decision.source === 'openrouter' ? (decision.provider || 'LLM') : 'Local planner')}: ${esc(decision.rationale)}</div>` : '');
  $('log').prepend(li);
}

// ---------- game ----------
async function withBusy(fn) {
  if (busy) return; busy = true; render();
  try { await fn(); } catch (e) { flash(e.message); try { view = await api(`/api/game/${view.gameId}`); } catch { /* ignore */ } } finally { busy = false; render(); }
}
async function newGame() {
  $('gameover').hidden = true; $('log').replaceChildren(); $('referee').hidden = true; $('speech').hidden = true; $('ai-record').textContent = '';
  selected = null; pending = null; picked.clear(); removing.clear(); $('preview').hidden = true; $('rule-input').value = '';
  busy = true; $('phase-banner').textContent = 'Flipping a coin…';
  try {
    const r = await api('/api/game', {});
    const { ai, ...v } = r;
    view = v;
    flash(v.firstPlayer === 'human' ? 'Coin flip: you go first.' : 'Coin flip: the AI goes first.');
    if (ai) { const start = structuredClone(v); start.pieces = start.pieces.map(q => ({ ...q, x: q.home.x, y: q.home.y })); start.cells = {}; view = start; await applyAI(ai, v); }
  } finally { busy = false; render(); }
}
function gameOver() {
  const w = view.winner;
  $('go-icon').textContent = w === 'human' ? '🏆' : w === 'ai' ? '🤖' : '🤝';
  $('go-title').textContent = w === 'human' ? 'You win!' : w === 'ai' ? 'The AI wins' : 'Draw';
  $('go-reason').textContent = view.winReason;
  const ach = view.achievements;
  $('go-ach').innerHTML = ['human', 'ai'].flatMap(p => ach[p].map(a => `<div class="ach"><b>${esc(a.title)}</b> <small>${p === 'human' ? 'you' : 'AI'}</small><p>${esc(a.detail)}</p></div>`)).join('') || '<p class="muted">No achievements this time.</p>';
  $('go-stats').textContent = `Turns: ${view.turn}. Across: you ${view.scored.human}, AI ${view.scored.ai}.`;
  setTimeout(() => { $('gameover').hidden = false; }, 500);
}
async function loadHealth() {
  try {
    const h = await api('/api/health');
    const b = $('brain-chip'), r = $('referee-chip');
    b.textContent = h.openrouter.configured ? `AI brain: ${h.openrouter.provider} (${h.openrouter.model})` : 'AI brain: local planner (no LLM key)';
    b.classList.add(h.openrouter.configured ? 'on' : 'off');
    const k = h.referee.kane;
    r.textContent = (h.referee.mode === 'kane' ? (k.installed && k.loggedIn !== false ? `Referee: Kane ${k.version || ''}` : 'Referee: Kane (unavailable, rules stay unverified)') : 'Referee: engine only (NOT Kane-verified)') + (h.referee.tiers ? ' + engine tiers' : '');
    r.classList.add(h.referee.mode === 'kane' && k.installed && k.loggedIn !== false ? 'on' : 'off');
    r.title = k.detail || '';
  } catch { /* ignore */ }
}

function init() {
  buildBoard();
  $('ideas').replaceChildren(...IDEAS.map(t => { const b = document.createElement('button'); b.type = 'button'; b.className = 'idea'; b.textContent = t; b.addEventListener('click', () => { $('rule-input').value = t; interpret(); }); return b; }));
  $('interpret-btn').addEventListener('click', interpret);
  $('rule-input').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); interpret(); } });
  $('place-btn').addEventListener('click', place);
  $('end-btn').addEventListener('click', endTurn);
  $('single-mode').addEventListener('change', render);
  $('rematch-btn').addEventListener('click', newGame);
  $('help-btn').addEventListener('click', () => { $('help').hidden = !$('help').hidden; });
  document.addEventListener('keydown', e => {
    if (e.target instanceof HTMLInputElement && e.target.type === 'text') return;
    const map = { ArrowUp: 'up', w: 'up', ArrowDown: 'down', s: 'down', ArrowLeft: 'left', a: 'left', ArrowRight: 'right', d: 'right' };
    if (map[e.key] && selected) { e.preventDefault(); move(map[e.key]); }
    if (e.key === 'e' || e.key === 'E') endTurn();
    if ((e.key === 'r' || e.key === 'R') && view?.winner) newGame();
  });
  loadHealth();
  setInterval(pollReviews, 2000);
  newGame().catch(e => flash('Could not start: ' + e.message));
  window.__ruleSabotage = { get view() { return view; }, get busy() { return busy; } };
}
document.addEventListener('DOMContentLoaded', init);
})();
