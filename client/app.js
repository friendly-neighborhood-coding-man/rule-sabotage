/* Rule Sabotage client: renders server state and animates the server's event log.
   The browser holds no authority: every rule, move and outcome comes from the server. */
(() => {
'use strict';
const $ = id => document.getElementById(id);
const SIZE = 7, COLS = 'ABCDEFG';
const cellName = k => { const [x, y] = k.split(',').map(Number); return COLS[x] + (y + 1); };
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const who = p => (p === 'human' ? 'You' : 'AI');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const ICON = { push: '⏪', skip: '💤', reverse: '🔄', teleport: '🌀', swap: '🔀', shield: '🛡️' };
const IDEAS = [
  'Anyone stepping here gets pushed back two spaces!',
  'Whoever lands here loses their next turn.',
  'Step here and your next move is reversed.',
  'Swap places with your rival!',
  '밟으면 한 칸 뒤로 밀려난다',
  '여기 밟으면 무작위 칸으로 순간이동',
];

let view = null, health = null, busy = false, sel = null, rejectInfo = null, removeSlot = null, pollTimer = null, animating = false;
let visual = null; // { pos:{human,ai}, traps: Map(cell -> {owner, icon}) } used during animation

async function api(path, body) {
  const res = await fetch(path, body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.reason || data.error || `HTTP ${res.status}`), { status: res.status });
  return data;
}

// ---------------- rendering ----------------
function buildBoard() {
  const board = $('board'); board.replaceChildren();
  $('col-labels').replaceChildren(...[...COLS].map(c => Object.assign(document.createElement('span'), { textContent: c })));
  $('row-labels').replaceChildren(...Array.from({ length: SIZE }, (_, i) => Object.assign(document.createElement('span'), { textContent: i + 1 })));
  for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) {
    const c = document.createElement('button');
    c.type = 'button'; c.className = 'cell'; c.dataset.cell = `${x},${y}`;
    if (x === 0) c.classList.add('home-human'); if (x === SIZE - 1) c.classList.add('home-ai');
    if (x === 6) c.classList.add('goal-human'); if (x === 0) c.classList.add('goal-ai');
    c.addEventListener('click', () => onCellClick(c.dataset.cell));
    board.appendChild(c);
  }
  for (const p of ['human', 'ai']) {
    const t = document.createElement('div'); t.className = `token ${p}`; t.id = `token-${p}`; t.textContent = p === 'human' ? 'YOU' : '🤖';
    board.appendChild(t);
  }
}
const cellEl = k => $('board').querySelector(`[data-cell="${k}"]`);

function trapsFromView(v) {
  const m = new Map();
  for (const p of ['human', 'ai']) for (const r of v.rules[p]) for (const c of r.cells) m.set(c, { owner: p, icon: r.icon, label: r.label, ruleId: r.id });
  return m;
}

function placeToken(p, pos, how) {
  const t = $(`token-${p}`), board = $('board');
  const cell = cellEl(`${pos.x},${pos.y}`); if (!cell) return;
  const other = p === 'human' ? visual?.pos.ai ?? view.positions.ai : visual?.pos.human ?? view.positions.human;
  const shared = other && other.x === pos.x && other.y === pos.y;
  const dx = shared ? (p === 'human' ? -8 : 8) : 0;
  t.classList.toggle('teleport', how === 'teleport');
  t.style.transform = `translate(${cell.offsetLeft + dx}px, ${cell.offsetTop}px)`;
  t.style.width = cell.offsetWidth + 'px'; t.style.height = cell.offsetHeight + 'px';
  void board;
}

function renderBoard() {
  const v = view, traps = visual ? visual.traps : trapsFromView(v);
  const shape = new Set(v.shape.cells), elig = new Set(v.eligible);
  for (const c of $('board').querySelectorAll('.cell')) {
    const k = c.dataset.cell, t = traps.get(k);
    c.className = 'cell' + (k.startsWith('0,') ? ' goal-ai' : '') + (k.startsWith('6,') ? ' goal-human' : '');
    if (shape.has(k) && !v.winner) c.classList.add('shape');
    if (elig.has(k) && sel && !busy) c.classList.add('pickable');
    if (sel?.cells.has(k)) c.classList.add('picked');
    if (t) c.classList.add('trap', `trap-${t.owner}`);
    c.innerHTML = t ? `<span class="ticon">${t.icon}</span>` : sel?.cells.has(k) ? `<span class="ticon ghost">${ICON[sel.effect.kind]}</span>` : '';
    c.title = `${cellName(k)}${t ? ` — ${who(t.owner)}r trap: ${t.label}` : ''}${elig.has(k) ? ' (trap allowed this round)' : ''}`;
    c.disabled = !(sel && elig.has(k) && !busy);
  }
  const pos = visual ? visual.pos : v.positions;
  placeToken('human', pos.human); placeToken('ai', pos.ai);
}

function slotCard(p, r, i) {
  const el = document.createElement('div');
  el.className = `slot ${p}` + (r ? ' filled' : '') + (p === 'human' && removeSlot === i ? ' removing' : '') + (p === 'human' && sel?.slot === i ? ' replacing' : '');
  if (!r) { el.innerHTML = `<div class="empty">Empty slot</div>`; return el; }
  const hits = `${r.hits.human ? `hit you ×${r.hits.human}` : ''}${r.hits.human && r.hits.ai ? ', ' : ''}${r.hits.ai ? `hit AI ×${r.hits.ai}` : ''}`;
  el.innerHTML = `<div class="slot-head"><span class="sicon">${r.icon}</span><b>${esc(r.label)}</b><small>${r.cells.length}/${r.placedCells} live</small></div>
    <q>${esc(r.text)}</q>
    <div class="slot-foot"><small>${r.cells.map(cellName).join(' ')}${hits ? ` · ${hits}` : ''}</small>${r.approxNote ? `<small class="approx">≈ ${esc(r.approxNote)}</small>` : ''}</div>`;
  if (p === 'human' && !busy && !view.winner) {
    const bar = document.createElement('div'); bar.className = 'slot-actions';
    const rm = document.createElement('button'); rm.type = 'button'; rm.textContent = removeSlot === i ? 'Keep' : 'Remove';
    rm.addEventListener('click', () => { removeSlot = removeSlot === i ? null : i; if (removeSlot !== null && sel) sel.slot = undefined; render(); });
    bar.appendChild(rm);
    if (sel && view.rules.human.length >= view.slots) {
      const rp = document.createElement('button'); rp.type = 'button'; rp.textContent = sel.slot === i ? 'Replacing ✓' : 'Replace with new trap';
      rp.addEventListener('click', () => { sel.slot = i; removeSlot = null; render(); });
      bar.appendChild(rp);
    }
    el.appendChild(bar);
  }
  return el;
}

function statusText(p) {
  const st = view.status[p], bits = [];
  if (st.skip) bits.push('💤 skips next turn');
  if (st.reverse) bits.push('🔄 next move reversed');
  if (st.shield) bits.push('🛡️ shielded');
  const left = Math.abs(view.goalX[p] - view.positions[p].x);
  return `${left} column${left === 1 ? '' : 's'} to go · sabotage hits ${view.sabotage[p]}${bits.length ? ' · ' + bits.join(' · ') : ''}`;
}

function render() {
  if (!view) return;
  $('round-chip').textContent = `Round ${Math.min(view.round, view.maxRounds)} / ${view.maxRounds}`;
  $('priority-chip').textContent = view.winner ? 'Game over' : view.priority === 'human' ? 'You move first this round' : 'AI moves first this round';
  $('priority-chip').className = 'chip ' + (view.priority === 'human' ? 'pri-human' : 'pri-ai');
  $('shape-name').textContent = view.winner ? 'Game over' : `${view.shape.name}${view.shape.mirrorOf ? ' (mirror of last round)' : ''}`;
  for (const p of ['human', 'ai']) {
    $(`${p}-slots`).replaceChildren(...Array.from({ length: view.slots }, (_, i) => slotCard(p, view.rules[p][i], i)));
    $(`${p}-slot-count`).textContent = `${view.rules[p].length}/${view.slots}`;
    $(`${p}-status`).textContent = statusText(p);
  }
  renderBoard();
  const frozen = view.status.human.skip;
  for (const b of document.querySelectorAll('.mv')) b.disabled = busy || !!view.winner || (frozen && b.dataset.move !== 'hold');
  $('rule-input').disabled = $('interpret-btn').disabled = busy || !!view.winner || frozen;
  $('ai-lock').textContent = view.winner ? '' : view.aiReady ? '🔒 AI has locked in its move (it can’t see yours)' : '🤔 AI is choosing (without seeing your move)…';
  $('ai-lock').className = 'ai-lock' + (view.aiReady ? ' ready' : '');
  if (frozen && !busy && !view.winner) $('ai-lock').textContent = '💤 You lose this turn. Press ● to continue.';
  renderPreview();
}

function renderPreview() {
  const box = $('preview');
  if (!sel && rejectInfo) { showPreviewReject(rejectInfo.reason, rejectInfo.source, rejectInfo.fallback); return; }
  if (!sel) { box.hidden = true; return; }
  box.hidden = false;
  const i = sel.interpretation;
  const src = i.source === 'openrouter' ? `Interpreted by OpenRouter (${esc(view.model || 'model')})` : i.source === 'offline-parser' ? 'Interpreted by the offline parser (OpenRouter not used)' : 'Input guard';
  const fullNote = view.rules.human.length >= view.slots ? (sel.slot === undefined ? '<div class="warn">All 3 slots are full. Pick a rule on the left to replace.</div>' : `<div class="ok">Will replace slot ${sel.slot + 1}.</div>`) : '';
  box.innerHTML = `<div class="pv-head"><span class="pv-icon">${ICON[i.effect.kind]}</span><div><b>${esc(sel.label)}</b><p>${esc(i.summary)}</p></div><button type="button" id="pv-clear" class="ghost">✕</button></div>
    ${i.status === 'approximate' ? `<label class="approx-box"><input type="checkbox" id="pv-approx" ${sel.approxOk ? 'checked' : ''}> <span>≈ Not exactly what you wrote: ${esc(i.note)} Use it anyway?</span></label>` : ''}
    <div class="pv-meta">Power: ${sel.cost} per square · budget ${sel.budget} → up to <b>${sel.max}</b> square${sel.max === 1 ? '' : 's'}. <b>${sel.cells.size}/${sel.max}</b> picked. Click highlighted squares on the board.</div>
    ${fullNote}<div class="pv-src">${src}${sel.fallback ? ` · ${esc(sel.fallback)}` : ''}</div>`;
  $('pv-clear').addEventListener('click', () => { sel = null; rejectInfo = null; render(); });
  $('pv-approx')?.addEventListener('change', e => { sel.approxOk = e.target.checked; });
}

// ---------------- interaction ----------------
function onCellClick(k) {
  if (!sel || busy) return;
  if (sel.cells.has(k)) sel.cells.delete(k);
  else if (sel.cells.size < sel.max) sel.cells.add(k);
  else { flashMsg(`Max ${sel.max} square${sel.max === 1 ? '' : 's'} for this trap.`); return; }
  render();
}

async function interpret() {
  const text = $('rule-input').value.trim();
  if (!text || busy) return;
  $('interpret-btn').disabled = true; $('interpret-btn').textContent = 'Reading…';
  try {
    const r = await api(`/api/game/${view.gameId}/preview`, { text });
    if (r.interpretation.status === 'reject') {
      sel = null; rejectInfo = { reason: r.interpretation.reason, source: r.interpretation.source, fallback: r.fallback }; render();
    } else {
      sel = { token: r.token, interpretation: r.interpretation, effect: r.interpretation.effect, label: r.label, cost: r.costPerSquare, max: r.maxSquares, budget: r.budget, cells: new Set(), slot: undefined, approxOk: false, fallback: r.fallback };
      removeSlot = null; rejectInfo = null; render();
    }
  } catch (e) { flashMsg(e.message); }
  finally { $('interpret-btn').textContent = 'Interpret'; render(); }
}
function showPreviewReject(reason, source, fallback) {
  const box = $('preview'); box.hidden = false;
  box.innerHTML = `<div class="pv-head reject"><span class="pv-icon">🚫</span><div><b>Can’t use that rule</b><p>${esc(reason)}</p></div></div><div class="pv-src">${source === 'openrouter' ? 'OpenRouter interpreter' : source === 'input-guard' ? 'Engine safety rules' : 'Offline parser'}${fallback ? ` · ${esc(fallback)}` : ''}</div>`;
}

async function commit(move) {
  if (busy || !view || view.winner) return;
  let rule = { op: 'none' };
  if (removeSlot !== null) rule = { op: 'remove', slot: removeSlot };
  else if (sel) {
    if (sel.cells.size === 0) { flashMsg('Pick at least one highlighted square for your trap, or clear it with ✕.'); return; }
    if (sel.interpretation.status === 'approximate' && !sel.approxOk) { flashMsg('Tick the box to accept the approximation, or rewrite the rule.'); return; }
    if (view.rules.human.length >= view.slots && sel.slot === undefined) { flashMsg('All slots are full: choose a rule to replace.'); return; }
    rule = { op: 'place', token: sel.token, cells: [...sel.cells], ...(sel.slot !== undefined ? { slot: sel.slot } : {}) };
  }
  busy = true; render();
  const ref = $('referee'); ref.hidden = false;
  ref.innerHTML = `<div class="ref-title">${rule.op === 'place' ? '⚖️ Your rule goes to the referee…' : '⏳ Resolving the round…'}</div><ul id="ref-lines"></ul>`;
  const seen = new Set();
  const poll = setInterval(async () => {
    try {
      const pr = await api(`/api/game/${view.gameId}/progress`);
      for (const line of pr.progress) { const key = line.at + line.text; if (seen.has(key)) continue; seen.add(key); const li = document.createElement('li'); li.textContent = line.text; if (/Kane is examining/.test(line.text)) li.className = 'kane-working'; $('ref-lines')?.appendChild(li); }
    } catch { /* ignore */ }
  }, 500);
  try {
    const r = await api(`/api/game/${view.gameId}/turn`, { move, rule });
    clearInterval(poll);
    sel = null; removeSlot = null; rejectInfo = null; $('rule-input').value = '';
    await showVerdicts(r.result.verdicts);
    await animate(r.result, r.view);
    view = r.view; visual = null; busy = false; render();
    logRound(r.result);
    if (view.winner) showGameOver(r.result);
  } catch (e) {
    clearInterval(poll); busy = false; ref.hidden = true; render(); flashMsg(e.message);
  }
}

async function showVerdicts(verdicts) {
  const ref = $('referee');
  if (!verdicts.length) { ref.hidden = true; return; }
  const html = verdicts.map(v => {
    const k = v.kane;
    const icon = v.final === 'approved' ? '✅' : v.final === 'rejected' ? '❌' : '⚠️';
    const head = v.final === 'approved' ? `Rule approved by Kane.${v.player === 'human' ? ' Proceed at your own risk.' : ''}`
      : v.final === 'rejected' ? 'Rule rejected.' : v.activated ? 'Not Kane-verified (engine checks only). Rule is live.' : 'Not verified, so the rule did NOT go live.';
    const detail = k ? `Kane ${esc(k.version || '')} · ${k.cached ? 'cached verdict from an identical trial' : `${(k.elapsedMs / 1000).toFixed(1)}s`} · ${k.conditionResults.filter(x => x === true).length}/${k.conditionResults.length || 7} conditions true` : 'Kane did not run';
    return `<div class="verdict ${v.final}"><div class="v-head">${icon} <b>${v.player === 'human' ? 'Your' : 'AI’s'} rule “${esc(v.ruleText)}”</b> (${esc(v.label)} on ${v.cells.join(' ')})</div>
      <div>${head} ${esc(v.message)}</div>
      <div class="v-meta">${v.trial.scenarioIds.length} what-if scenarios (${v.trial.scenarioIds[0]}…) · ${detail} · <a href="/trial/${v.trial.trialId}" target="_blank" rel="noopener">see trial ${v.trial.trialId}</a></div></div>`;
  }).join('');
  ref.hidden = false; ref.innerHTML = `<div class="ref-title">⚖️ Referee</div>${html}`;
  await sleep(1400);
}

function floatText(k, text, cls) {
  const c = cellEl(k); if (!c) return;
  const f = document.createElement('div'); f.className = `float ${cls || ''}`; f.textContent = text;
  f.style.transform = `translate(${c.offsetLeft}px, ${c.offsetTop}px)`; f.style.width = c.offsetWidth + 'px';
  $('board').appendChild(f); setTimeout(() => f.remove(), 1500);
}
function banner(text, cls) {
  const b = $('banner'); b.textContent = text; b.className = `banner ${cls || ''}`; b.hidden = false;
  clearTimeout(banner.t); banner.t = setTimeout(() => { b.hidden = true; }, 1700);
}
const posKey = p => `${p.x},${p.y}`;

async function animate(result, next) {
  visual = { pos: structuredClone(view.positions), traps: trapsFromView(view) };
  const ruleMeta = new Map();
  for (const p of ['human', 'ai']) for (const r of [...view.rules[p], ...next.rules[p]]) ruleMeta.set(r.id, r);
  if (result.ai.taunt) speech(result.ai.taunt, 'said before the reveal');
  for (const e of result.events) {
    switch (e.t) {
      case 'sitout': floatText(posKey(visual.pos[e.p]), '💤 skipped', 'bad'); await sleep(600); break;
      case 'remove': for (const [k, t] of visual.traps) if (t.ruleId === e.ruleId) visual.traps.delete(k); renderBoard(); await sleep(300); break;
      case 'clash': for (const k of e.cells) floatText(k, '💥 CLASH', 'clash'); banner('💥 Trap clash! Both claimed the same square.', 'clash'); await sleep(700); break;
      case 'fizzle': break;
      case 'overwrite': break;
      case 'place': {
        const meta = ruleMeta.get(e.ruleId);
        for (const k of e.cells) { visual.traps.set(k, { owner: e.p, icon: meta?.icon || '⚠', label: e.label, ruleId: e.ruleId }); }
        renderBoard();
        for (const k of e.cells) cellEl(k)?.classList.add('just-placed');
        await sleep(550); break;
      }
      case 'move': {
        if (e.dir === 'hold') { await sleep(150); break; }
        visual.pos[e.p] = e.to; renderBoard();
        if (e.reversed) floatText(posKey(e.to), '🔄 reversed!', 'bad');
        await sleep(330); break;
      }
      case 'trigger': {
        const c = cellEl(e.cell); c?.classList.add('boom');
        visual.traps.delete(e.cell); renderBoard(); cellEl(e.cell)?.classList.add('boom');
        const selfHarm = e.self && e.kind !== 'shield';
        floatText(e.cell, `${e.label}!`, selfHarm ? 'self' : e.kind === 'shield' ? 'good' : 'bad');
        if (selfHarm) banner(`SELF-SABOTAGE! ${who(e.p)} stepped on ${e.p === 'human' ? 'your' : 'its'} own trap.`, 'self');
        else if (e.chain > 1) banner(`CHAIN REACTION ×${e.chain}!`, 'clash');
        await sleep(selfHarm ? 1100 : 650); break;
      }
      case 'shielded': floatText(e.cell, '🛡️ blocked', 'good'); visual.traps.delete(e.cell); renderBoard(); await sleep(500); break;
      case 'displace': visual.pos[e.p] = e.to; renderBoard(); placeToken(e.p, e.to, e.how); await sleep(e.how === 'teleport' ? 600 : 420); break;
      case 'status': floatText(posKey(visual.pos[e.p]), e.resisted ? 'resisted (just recovered)' : e.status === 'skip' ? '💤 loses next turn' : e.status === 'reverse' ? '🔄 next move reversed' : '🛡️ shield', e.status === 'shield' ? 'good' : 'bad'); await sleep(450); break;
      case 'win': break;
    }
  }
  const reaction = result.reactions?.[0];
  if (reaction) speech(reaction.text, 'commentary after the round');
}

function speech(text, tag) {
  const s = $('speech'); s.hidden = false;
  s.innerHTML = `<div class="bubble">${esc(text)}</div><small>${esc(tag)}</small>`;
}

function describeEvent(e) {
  switch (e.t) {
    case 'sitout': return `${who(e.p)} sat out (lost turn).`;
    case 'remove': return `${who(e.p)} removed “${e.text}”.`;
    case 'place': return `${who(e.p)} placed “${e.text}” (${e.label}) on ${e.cells.map(cellName).join(' ')}${e.replaced ? ', replacing an old rule' : ''}.`;
    case 'overwrite': return `${who(e.p)} built over ${e.victimOwner === e.p ? 'their own' : who(e.victimOwner) + '’s'} trap on ${e.cells.map(cellName).join(' ')}.`;
    case 'clash': return `Clash on ${e.cells.map(cellName).join(' ')}: both claimed it, nobody gets it.`;
    case 'fizzle': return `${who(e.p)}’s trap fizzled (all its squares clashed).`;
    case 'move': return e.dir === 'hold' ? `${who(e.p)} stayed put.` : `${who(e.p)} moved ${cellName(posKey(e.from))} → ${cellName(posKey(e.to))}${e.reversed ? ' (reversed!)' : ''}.`;
    case 'trigger': return `${who(e.p)} stepped on ${e.self ? (e.p === 'human' ? 'YOUR OWN' : 'ITS OWN') : (e.owner === 'human' ? 'your' : 'the AI’s')} trap at ${cellName(e.cell)}: “${e.text}” → ${e.label}${e.chain > 1 ? ` (chain ×${e.chain})` : ''}.`;
    case 'shielded': return `${who(e.p)}’s shield blocked a trap at ${cellName(e.cell)}.`;
    case 'displace': return e.from.x === e.to.x && e.from.y === e.to.y ? `${who(e.p)} couldn’t be moved (${e.how} blocked).` : `${who(e.p)} ${e.how === 'push' ? 'was pushed' : e.how === 'teleport' ? 'teleported' : 'swapped'} ${cellName(posKey(e.from))} → ${cellName(posKey(e.to))}.`;
    case 'status': return e.resisted ? `${who(e.p)} resisted the skip (just recovered from one).` : `${who(e.p)}: ${e.status === 'skip' ? 'loses next turn' : e.status === 'reverse' ? 'next move reversed' : 'gained a shield'}.`;
    case 'chain-limit': return 'Chain stopped at the 3-trap limit.';
    case 'win': return e.winner === 'draw' ? `Draw. ${e.reason}` : `${who(e.winner)} won! ${e.reason}`;
  }
  return '';
}

function logRound(result) {
  const li = document.createElement('li');
  const ai = result.ai;
  const aiLine = `<div class="ai-record"><b>AI’s recorded decision</b> (locked in ${new Date(ai.decidedAt).toLocaleTimeString()}, before your move was revealed; ${ai.source === 'openrouter' ? `chosen by ${esc(ai.model)}` : 'local planner'}${ai.fallbackReason ? ` · fallback: ${esc(ai.fallbackReason)}` : ''}): ${esc(ai.action)}. <i>${esc(ai.rationale)}</i> <small>(simulated ${ai.plan.candidates} options × ${ai.plan.scenarios} replies in ${ai.plan.ms} ms)</small></div>`;
  li.innerHTML = `<b>Round ${result.round}</b><ul>${result.events.map(e => `<li>${esc(describeEvent(e))}</li>`).join('')}</ul>${aiLine}`;
  $('log').prepend(li);
}

function showGameOver(result) {
  const w = view.winner;
  $('go-icon').textContent = w === 'human' ? '🏆' : w === 'ai' ? '🤖' : '🤝';
  $('go-title').textContent = w === 'human' ? 'YOU WIN!' : w === 'ai' ? 'THE AI WINS' : 'DRAW';
  $('go-reason').textContent = view.winReason;
  const ach = [...(view.achievements.human || []).map(a => ({ ...a, p: 'You' })), ...(view.achievements.ai || []).map(a => ({ ...a, p: 'AI' }))];
  $('go-ach').innerHTML = ach.length ? ach.map(a => `<div class="ach"><b>🏅 ${esc(a.title)}</b> <small>${a.p} · round ${a.round}</small><p>${esc(a.detail)}</p></div>`).join('') : '<p class="muted">No achievements this time.</p>';
  $('go-stats').textContent = `Rounds: ${result.round} · Sabotage hits: you ${view.sabotage.human}, AI ${view.sabotage.ai}`;
  $('gameover').hidden = false;
  $('rematch-btn').focus();
}

function flashMsg(text) { banner(text, 'msg'); }

async function newGame() {
  $('gameover').hidden = true; $('log').replaceChildren(); $('speech').hidden = true; $('referee').hidden = true;
  sel = null; removeSlot = null; rejectInfo = null; busy = false; visual = null;
  view = await api('/api/game', {});
  render();
}

async function refreshLock() {
  if (!view || busy || view.aiReady || view.winner) return;
  try { const pr = await api(`/api/game/${view.gameId}/progress`); if (pr.aiReady && !busy) { view.aiReady = true; render(); } } catch { /* ignore */ }
}

async function loadHealth() {
  try {
    health = await api('/api/health');
    const o = health.openrouter, k = health.referee;
    $('brain-chip').textContent = o.configured ? `AI brain: OpenRouter · ${o.model}` : 'AI brain: local planner (OpenRouter off)';
    $('brain-chip').className = 'chip mode ' + (o.configured ? 'on' : 'off');
    $('referee-chip').textContent = k.mode === 'engine-only' ? 'Referee: engine only (Kane off)' : k.kane.installed && k.kane.loggedIn ? `Referee: Kane CLI ${k.kane.version}` : `Referee: Kane unavailable (${k.kane.detail})`;
    $('referee-chip').className = 'chip mode ' + (k.mode === 'kane' && k.kane.installed && k.kane.loggedIn ? 'on' : 'off');
    $('referee-chip').title = k.mode === 'kane' ? `Every new rule is simulated, then judged by kane-cli (${k.kaneMode} mode, timeout ${k.timeoutS}s). ${k.allowUnverified ? 'Unverified rules still go live (labelled).' : 'Unverified rules do not go live.'}` : 'Kane referee switched off: rules only pass engine checks.';
  } catch { /* ignore */ }
}

function init() {
  buildBoard();
  $('ideas').replaceChildren(...IDEAS.map(t => { const b = document.createElement('button'); b.type = 'button'; b.className = 'idea'; b.textContent = t; b.addEventListener('click', () => { $('rule-input').value = t; interpret(); }); return b; }));
  $('interpret-btn').addEventListener('click', interpret);
  $('rule-input').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); interpret(); } });
  for (const b of document.querySelectorAll('.mv')) b.addEventListener('click', () => commit(b.dataset.move));
  $('rematch-btn').addEventListener('click', newGame);
  $('help-btn').addEventListener('click', () => { $('help').hidden = !$('help').hidden; });
  document.addEventListener('keydown', e => {
    if (e.target instanceof HTMLInputElement) return;
    const map = { ArrowUp: 'up', w: 'up', ArrowDown: 'down', s: 'down', ArrowLeft: 'left', a: 'left', ArrowRight: 'right', d: 'right', ' ': 'hold' };
    if (map[e.key]) { e.preventDefault(); commit(map[e.key]); }
    if ((e.key === 'r' || e.key === 'R') && view?.winner) newGame();
  });
  window.addEventListener('resize', () => renderBoard());
  setInterval(refreshLock, 700);
  loadHealth();
  newGame().catch(e => flashMsg('Could not start: ' + e.message));
  window.__ruleSabotage = { get view() { return view; }, get busy() { return busy; } };
}
document.addEventListener('DOMContentLoaded', init);
})();
