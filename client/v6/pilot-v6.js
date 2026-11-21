/* V6.2 pilot shell for the V6 / V6.1 page: consent, post-game questionnaire, match review, deletion.
   Gameplay rules are untouched; this only talks to /api/v6/consent|session|feedback|review|withdraw.
   Answers are exactly what the participant enters; unanswered questions stay empty. */
(() => {
'use strict';
const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
async function api(path, body) {
  const r = await fetch(path, body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.reason || j.error || `HTTP ${r.status}`);
  return j;
}
const LABELS = { enjoyment: 'How much did you enjoy this game?', challenge: 'How challenging was the opponent?', predictability: 'How predictable was the opponent?', strategicChoice: 'How much did your own choices matter?', playAgain: 'How much would you like to play again?' };
let info = null, asked = new Set();

async function start() {
  info = await api('/api/v6/consent');
  $('pv6-statement').textContent = info.statement;
  if (info.session) { $('pv6-consent').hidden = true; showRec(info.session.consented); }
}
function showRec(on) { $('pv6-rec').textContent = on ? '● recording (consented)' : 'not recording'; $('pv6-delete').hidden = !on; }
async function begin(consent) {
  try { const s = await api('/api/v6/session', { consent, participant: $('pv6-code').value }); $('pv6-consent').hidden = true; showRec(s.consented); }
  catch (e) { $('pv6-err').textContent = e.message; }
}
function questionnaire(gameId) {
  if (asked.has(gameId)) return; asked.add(gameId);
  const f = $('pv6-form');
  f.innerHTML = info.questionnaire.items.map(k => `<fieldset><legend>${esc(LABELS[k] || k)}</legend>${[1, 2, 3, 4, 5].map(n => `<label><input type="radio" name="${k}" value="${n}"> ${n}</label>`).join(' ')}</fieldset>`).join('')
    + `<fieldset><legend>Any of these? (optional)</legend>${info.questionnaire.tags.map(t => `<label><input type="checkbox" name="tag" value="${t}"> ${esc(t)}</label>`).join(' ')}</fieldset>`
    + '<label>Comment (optional)<textarea id="pv6-comment" maxlength="600" rows="3"></textarea></label>';
  $('pv6-fb').dataset.game = gameId; $('pv6-fb').hidden = false;
}
async function send(skipped) {
  const gameId = $('pv6-fb').dataset.game, f = $('pv6-form'), ratings = {};
  for (const k of info.questionnaire.items) { const v = f.querySelector(`input[name="${k}"]:checked`); ratings[k] = v ? Number(v.value) : null; }
  const tags = [...f.querySelectorAll('input[name="tag"]:checked')].map(x => x.value);
  try { await api('/api/v6/feedback', { gameId, skipped, ratings, tags, comment: $('pv6-comment')?.value || '' }); } catch (e) { if (!/Already/.test(e.message)) { alert(e.message); return; } }
  $('pv6-fb').hidden = true;
}
async function review() {
  const gameId = window.__ruleSabotage?.view?.gameId; if (!gameId) return;
  try {
    const r = await api(`/api/v6/review/${gameId}`);
    $('pv6-review-body').innerHTML = `<p><b>${esc(r.ruleset)}</b> · ${esc(r.opponent.version)} · seed ${r.seed} · first: ${esc(r.first)} · ${r.recorded ? 'recorded' : 'not recorded'}</p>`
      + `<p>Result: ${esc(r.result.winner ?? 'in progress')} ${esc(r.result.reason)} · ${r.result.turns} turns</p>`
      + `<p>Your effects: ${r.placements.human.placed} placed, ${r.placements.human.refusedByPlacementRule.length} refused by a placement rule, ${r.placements.human.notPlaced.length} not placed by the referee. Opponent: ${r.placements.ai.placed} placed, ${r.placements.ai.notPlaced.length} not placed.</p>`
      + `<p>Opponent thinking time: median ${r.ai.latencyMs.median ?? '–'} ms, max ${r.ai.latencyMs.max ?? '–'} ms. Turns it made no move: ${r.ai.zeroMoveTurns.length}.</p>`
      + `<ol>${r.turns.map(t => `<li>${t.p === 'human' ? 'You' : 'AI'} · turn ${t.turn}: ${esc(t.events.filter(e => !/^(turn|end)/.test(e)).join(', '))}</li>`).join('')}</ol>`;
    $('pv6-review').hidden = false;
  } catch (e) { alert(e.message); }
}
async function del() {
  if (!confirm('Delete everything recorded in this session (game records, answers and referee cases)? This cannot be undone.')) return;
  const r = await api('/api/v6/withdraw', {}); showRec(false); alert(`Deleted ${r.removedFiles} file(s). You can keep playing without recording.`);
}
function init() {
  $('pv6-agree').addEventListener('click', () => begin(true));
  $('pv6-decline').addEventListener('click', () => begin(false));
  $('pv6-send').addEventListener('click', () => send(false));
  $('pv6-skip').addEventListener('click', () => send(true));
  $('pv6-review-btn').addEventListener('click', review);
  $('pv6-review-close').addEventListener('click', () => { $('pv6-review').hidden = true; });
  $('pv6-delete').addEventListener('click', del);
  new MutationObserver(() => { const v = window.__ruleSabotage?.view; if (!$('gameover').hidden && v?.winner) questionnaire(v.gameId); }).observe($('gameover'), { attributes: true, attributeFilter: ['hidden'] });
  start().catch(e => { $('pv6-err').textContent = e.message; });
}
document.addEventListener('DOMContentLoaded', init);
})();
