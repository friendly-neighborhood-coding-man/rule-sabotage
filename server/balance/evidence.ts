/**
 * Evidence pages Kane inspects, the conditions it judges, and how its per-condition answers
 * become a finding. The page shows RAW rows and a real-engine replay; it does not state the
 * optimizer's conclusion. Kane is asked about concrete row-level facts, including a negated
 * control statement, so a "yes to everything" answer is detected as inconsistent (UNVERIFIED).
 */
import { cellName, SIZE, key } from '../engine.ts';
import type { Anomaly } from './anomaly.ts';
import { ownAnswer } from './anomaly.ts';
import type { Captured, BoardSnap } from './selfplay.ts';
import type { KaneVerifyResult } from '../kane.ts';

export type Finding = {
  anomalyId: string; fingerprint: string;
  /** CONFIRMED / REFUTED only from a complete run of the real kane-cli. Everything else is UNVERIFIED. */
  status: 'CONFIRMED' | 'REFUTED' | 'UNVERIFIED';
  verifier: 'kane-cli' | 'kane-test-double' | 'none';
  reason: string; conditions: { id: string; text: string; role: string; kane: boolean | null; kaneReason: string | null; expectedIfHypothesis: boolean }[];
  ownAnswer: boolean | null; kaneAgreesWithOwnData: boolean | null;
};

const esc = (s: unknown) => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

function grid(b: BoardSnap, highlight: string, title: string, id: string) {
  const at = (x: number, y: number) => b.pieces.filter(q => !q.scored && q.x === x && q.y === y).map(q => `${q.owner === 'human' ? 'Human' : 'AI'} ${q.id}${q.frozen ? ' (frozen)' : ''}`).join(', ');
  const eff = new Map(b.cells.map(c => [c.cell, c]));
  let rows = `<tr><th></th>${'ABCDEFG'.split('').map(c => `<th>${c}</th>`).join('')}</tr>`;
  for (let y = 0; y < SIZE; y++) {
    rows += `<tr><th>${y + 1}</th>`;
    for (let x = 0; x < SIZE; x++) {
      const k = key(x, y), e = eff.get(k), p = at(x, y);
      rows += `<td data-square="${cellName(k)}"${k === highlight ? ' class="hl"' : ''}>${p ? `<b>${esc(p)}</b>` : ''}${e ? `<br><small>${esc(e.label)}</small>` : ''}</td>`;
    }
    rows += '</tr>';
  }
  return `<table class="board" id="${id}"><caption>${esc(title)}</caption>${rows}</table>`;
}

export function conditionsFor(a: Anomaly, replay: Captured | null): Finding['conditions'] {
  const c = a.check!;
  const n = c.rows.length;
  const more = c.direction === 'above' ? 'more than' : 'fewer than', notMore = c.direction === 'above' ? 'at most' : 'at least';
  const out: Finding['conditions'] = [
    { id: 'K1', role: 'integrity', text: `The table titled 'Evidence rows' has exactly ${n} data rows below its header row.`, kane: null, kaneReason: null, expectedIfHypothesis: true },
    { id: 'K2', role: 'hypothesis', text: `In the 'Evidence rows' table, ${more} ${c.fractionText} of the data rows are rows where ${c.predicateText}.`, kane: null, kaneReason: null, expectedIfHypothesis: true },
    { id: 'K3', role: 'negated control', text: `In the 'Evidence rows' table, ${notMore} ${c.fractionText} of the data rows are rows where ${c.predicateText}.`, kane: null, kaneReason: null, expectedIfHypothesis: false },
  ];
  if (replay) out.push({ id: 'K4', role: 'replay consistency', text: `In the 'Replay R1' section, the 'After' board shows a ${replay.mover === 'human' ? 'Human' : 'AI'} piece on the square named in the 'Ended on' line of that section.`, kane: null, kaneReason: null, expectedIfHypothesis: true });
  return out;
}

export function replayEndSquare(r: Captured): string {
  const f = r.events.filter(e => e.t === 'forced').pop();
  if (f && f.t === 'forced') return f.to.split('|').map(cellName).join(' and ');
  const mv = r.events.find(e => e.t === 'move');
  return mv && mv.t === 'move' ? cellName(mv.to) : cellName(r.cell);
}

export function renderEvidencePage(o: { a: Anomaly; replay: Captured | null; commit: string; weights: string; cycle: number; generatedAt: string; reproduce: string }): string {
  const c = o.a.check!;
  const rows = c.rows.map((r, i) => `<tr data-row="${i + 1}">${r.map(v => `<td>${esc(v)}</td>`).join('')}</tr>`).join('');
  const rp = o.replay;
  const replay = rp ? `<h2 id="replay">Replay R1</h2>
<p>Real engine replay of the first evidence row (seed ${esc(c.replay![0].seed)}, turn ${rp.turn}). The ${rp.mover === 'human' ? 'Human' : 'AI'} side moved <strong>${esc(rp.move.replace(/^(\d,\d)/, m => cellName(m)))}</strong> and entered <strong>${cellName(rp.cell)}</strong>.</p>
<p id="ended-on">Ended on: <strong>${esc(replayEndSquare(rp))}</strong></p>
<div class="boards">${grid(rp.before, rp.cell, 'Before', 'board-before')}${grid(rp.after, rp.cell, 'After', 'board-after')}</div>
<p>Engine events for that move: ${esc(rp.events.map(e => e.t + ('cell' in e && e.cell ? ` ${cellName(e.cell as string)}` : '') + ('to' in e && typeof e.to === 'string' && !e.to.includes('|') ? `→${cellName(e.to)}` : '')).join(', '))}</p>` : '';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Balance evidence ${esc(o.a.id)}</title>
<style>body{font:15px/1.5 system-ui,sans-serif;margin:24px;max-width:1100px;color:#111}table{border-collapse:collapse;margin:8px 0 18px}td,th{border:1px solid #999;padding:4px 8px;text-align:left}th{background:#eee}.board td{width:86px;height:44px;vertical-align:top;font-size:12px}.board .hl{outline:3px solid #c60}.boards{display:flex;gap:24px;flex-wrap:wrap}caption{font-weight:600;text-align:left}</style></head><body>
<h1>Rule Sabotage balance evidence <span id="evidence-id">${esc(o.a.id)}</span></h1>
<p>Recorded from AI-vs-AI self-play with the real game engine. Both sides used the same planner and the same frozen balance weights <code>${esc(o.weights)}</code>. Code commit <code>${esc(o.commit)}</code>. Cycle ${o.cycle}. Generated ${esc(o.generatedAt)}.</p>
<p>Rows are a fixed systematic sample (every k-th row, in game and turn order) of ${o.a.samples} recorded ${c.table === 'triggers' ? 'effect triggers' : 'player-games'}. Distances are squares between the piece's column and its goal column (Human pieces head for column G, AI pieces for column A).</p>
<h2>Evidence rows</h2>
<table id="evidence-rows"><caption>Evidence rows</caption><tr>${c.columns.map(h => `<th>${esc(h)}</th>`).join('')}</tr>${rows}</table>
${replay}
<h2>Reproduce</h2><pre id="reproduce">${esc(o.reproduce)}</pre>
</body></html>`;
}

/** Kane's per-condition answers -> finding. Never upgrades an incomplete or test-double run. */
export function findingFrom(a: Anomaly, conds: Finding['conditions'], k: KaneVerifyResult | null): Finding {
  const own = a.check ? ownAnswer(a.check) : null;
  const f: Finding = { anomalyId: a.id, fingerprint: a.fingerprint, status: 'UNVERIFIED', verifier: 'none', reason: '', conditions: conds.map(c => ({ ...c })), ownAnswer: own, kaneAgreesWithOwnData: null };
  if (!k) { f.reason = 'Kane was not run (dry-run or budget). No verification exists.'; return f; }
  f.verifier = k.isTestDouble ? 'kane-test-double' : 'kane-cli';
  f.conditions.forEach((c, i) => { c.kane = k.conditionResults[i] ?? null; c.kaneReason = k.conditionReasons[i] ?? null; });
  if (k.status !== 'complete') { f.reason = `Kane result ${k.status}: ${k.detail}`; return f; }
  const by = (id: string) => f.conditions.find(c => c.id === id)?.kane;
  const integrity = by('K1') === true && (by('K4') ?? true) === true;
  if (by('K2') === true && by('K3') === false) f.kaneAgreesWithOwnData = own === true;
  else if (by('K2') === false && by('K3') === true) f.kaneAgreesWithOwnData = own === false;
  if (!integrity) { f.reason = `Kane did not confirm the page integrity/replay conditions (K1=${by('K1')}, K4=${by('K4') ?? 'n/a'}).`; return f; }
  if (by('K2') === true && by('K3') === false) { f.status = 'CONFIRMED'; f.reason = 'Kane: the hypothesis statement is true and its negated control is false.'; }
  else if (by('K2') === false && by('K3') === true) { f.status = 'REFUTED'; f.reason = 'Kane: the hypothesis statement is false and its negated control is true.'; }
  else { f.reason = `Kane answered the statement and its negation inconsistently (K2=${by('K2')}, K3=${by('K3')}).`; return f; }
  if (f.verifier === 'kane-test-double') { f.reason = `TEST DOUBLE, NOT KANE: ${f.reason}`; f.status = 'UNVERIFIED'; }
  return f;
}
