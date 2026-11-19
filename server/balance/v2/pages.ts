/**
 * Balance Designer V2: browser-readable pages for Kane (static HTML, no scripts) and the condition builders.
 *  - exploration page: raw observations, trigger/placement histories, planner choices with rejected
 *    alternatives, V0.3 valuation vs measured consequences, a replay timeline, and the notebook form.
 *    It deliberately shows NO hypothesis, so Kane is not anchored on ours. Holdout seeds never appear.
 *  - challenge page: per hypothesis, the mechanism, control vs intervention, raw samples from both,
 *    per-seed values, an example and a counterexample game, and the cases it fails to explain.
 *  - correction page: the same for each correction on the holdout seeds (post-correction re-observation).
 */
import { type GameRec, type PlanTrace } from '../selfplay.ts';
import { cellName } from '../../engine.ts';
import { selfBoost, METRICS, type Effect } from './metrics.ts';
import { COMPONENTS, NOTE_METRICS } from './kane2.ts';

export const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const cn = (k: string) => { try { return cellName(k); } catch { return k; } };
const CSS = `body{font:15px/1.45 system-ui,Segoe UI,sans-serif;margin:24px;max-width:1180px;color:#111;background:#fff}table{border-collapse:collapse;margin:8px 0 18px}td,th{border:1px solid #bbb;padding:3px 8px;text-align:left;font-size:14px}th{background:#eee}h2{margin-top:30px;border-bottom:2px solid #333}h3{margin-top:20px}.muted{color:#555}.box{border:2px solid #333;padding:12px;margin:14px 0}label{display:block;margin-top:8px;font-weight:600}textarea,select,input[type=text]{width:100%;max-width:900px;font:14px system-ui}code{background:#f3f3f3;padding:0 3px}`;
const page = (title: string, body: string) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(title)}</title><style>${CSS}</style></head><body>${body}</body></html>`;
const table = (caption: string, head: string[], rows: (string | number | null)[][]) => `<h3>${esc(caption)}</h3><table><thead><tr>${head.map(h => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.map(r => `<tr>${r.map(c => `<td>${esc(c ?? '—')}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
/** Systematic sample with an odd count, so a "more/fewer than half" statement cannot tie. */
export function sample<T>(rows: T[], max: number): T[] {
  if (rows.length <= max) return rows.length % 2 ? rows : rows.slice(0, rows.length - 1);
  const n = max % 2 ? max : max - 1, step = rows.length / n;
  return Array.from({ length: n }, (_, i) => rows[Math.floor(i * step)]);
}
const f = (x: number | null | undefined, d = 3) => (x === null || x === undefined ? '—' : Number(x).toFixed(d));

export type TriggerRow = { id: string; game: string; turn: number; effect: string; installer: string; mover: string; self: boolean; chain: number; gained: number | null; how: string };
export type PlacementRow = { id: string; game: string; turn: number; placer: string; effect: string; cells: string; selfBoost: boolean };
export const triggerRows = (recs: GameRec[], pred: (e: string) => boolean, prefix: string): TriggerRow[] =>
  recs.flatMap(r => r.triggers.filter(t => pred(t.effect)).map(t => ({ game: `${r.seed}/${r.first}-first`, turn: t.turn, effect: t.effect, installer: t.owner, mover: t.mover, self: t.self, chain: t.chain, gained: t.realized === null ? null : -t.realized, how: t.how }))).map((x, i) => ({ id: `${prefix}${i + 1}`, ...x }));
export const placementRows = (recs: GameRec[], pred: (e: string) => boolean, prefix: string): PlacementRow[] =>
  recs.flatMap(r => r.placements.filter(p => pred(p.effect)).map(p => ({ game: `${r.seed}/${r.first}-first`, turn: p.turn, placer: p.p, effect: p.effect, cells: p.cells.map(cn).join(' '), selfBoost: selfBoost(p.effect, p.p) }))).map((x, i) => ({ id: `${prefix}${i + 1}`, ...x }));
const trTable = (cap: string, rows: TriggerRow[]) => table(cap, ['Row', 'Game', 'Turn', 'Effect', 'Installed by', 'Stepped on by', 'Mover = installer', 'Chain', 'Squares gained by the stepping piece', 'What happened'], rows.map(r => [r.id, r.game, r.turn, r.effect, r.installer, r.mover, r.self ? 'yes' : 'no', r.chain, r.gained, r.how]));
const plTable = (cap: string, rows: PlacementRow[]) => table(cap, ['Row', 'Game', 'Turn', 'Placed by', 'Effect', 'Cells', 'Self-boost'], rows.map(r => [r.id, r.game, r.turn, r.placer, r.effect, r.cells, r.selfBoost ? 'yes' : 'no']));
const timeline = (r: GameRec, maxTurn = 40) => {
  const ev: { turn: number; text: string }[] = [
    ...r.placements.map(p => ({ turn: p.turn, text: `${p.p} places ${p.effect} on ${p.cells.map(cn).join(' ')}` })),
    ...r.triggers.map(t => ({ turn: t.turn, text: `${t.mover} piece enters ${t.effect} (installed by ${t.owner}) at ${cn(t.cell)}: ${t.how}${t.realized !== null ? `, squares gained ${-t.realized}` : ''}` })),
  ].filter(e => e.turn <= maxTurn).sort((a, b) => a.turn - b.turn);
  return table(`Replay timeline: seed ${r.seed}, ${r.first} moved first, ${r.winner} won after ${r.turns} turns`, ['Turn', 'Event (engine record)'], ev.map(e => [e.turn, e.text]));
};

function notebook(o: { action: string; nonce: string; kind: 'exploration' | 'challenge'; hypotheses?: string[] }) {
  const opt = (m: Record<string, string>) => Object.entries(m).map(([k, v]) => `<option value="${esc(k)}">${esc(v)}</option>`).join('');
  const comps = Object.fromEntries(Object.entries(COMPONENTS).map(([k, v]) => [k, v.label]));
  return `<h2 id="notebook">Investigation notebook</h2><div class="box"><p>Write down what <b>you</b> conclude from the data on this page. Submit the form once per explanation (at most 3). Your text is stored verbatim as your own finding.</p>
<form method="post" action="${esc(o.action)}"><input type="hidden" name="nonce" value="${esc(o.nonce)}">
${o.kind === 'challenge' ? `<label for="hypothesis">Hypothesis you are judging</label><select id="hypothesis" name="hypothesis">${(o.hypotheses ?? []).map(h => `<option>${esc(h)}</option>`).join('')}</select>
<label for="verdict">Does the evidence in its section support it?</label><select id="verdict" name="verdict"><option value="supports">supports it</option><option value="does-not-explain">does not explain the behaviour</option><option value="unsure">unsure</option></select>` : `<label for="defect">Is there a defect at all?</label><select id="defect" name="defect"><option value="yes">yes</option><option value="no">no</option><option value="unsure">unsure</option></select>`}
<label for="explanation">Your explanation (what causes the pattern, in your words)</label><textarea id="explanation" name="explanation" rows="4"></textarea>
<label for="component">Which part does your explanation involve?</label><select id="component" name="component">${opt(comps)}</select>
<label for="metric">Which measurement should change if your explanation is right and that part is changed?</label><select id="metric" name="metric">${opt(NOTE_METRICS)}</select>
<label for="direction">It should</label><select id="direction" name="direction"><option value="decrease">decrease</option><option value="increase">increase</option></select>
<label for="alternative">An alternative explanation you considered</label><textarea id="alternative" name="alternative" rows="2"></textarea>
<label for="counterexample">A row id or seed that contradicts an explanation (optional)</label><input type="text" id="counterexample" name="counterexample">
<p><button type="submit">Submit note</button></p></form></div>`;
}

export type ExplorationData = {
  v1RunId: string; v1Hash: string; games: GameRec[]; traces: { game: string; trace: PlanTrace[] }[]; replay: GameRec;
  valuation: { effect: string; prior: string; measured: number | null; triggers: number }[]; effectTable: (string | number | null)[][];
};
export function explorationPage(d: ExplorationData, nonce: string, action: string): string {
  const tp = triggerRows(d.games, e => e === 'teleport', 'T'), ew = triggerRows(d.games, e => /^shove:(east|west):/.test(e), 'S');
  const pl = placementRows(d.games, e => /^shove:(east|west):/.test(e) || e === 'teleport', 'P');
  return page('Rule Sabotage: AI behaviour investigation (read-only data)', `<h1>Rule Sabotage: AI behaviour investigation</h1>
<p class="muted">Read-only data from ${d.games.length} recorded AI-vs-AI games (run ${esc(d.v1RunId)}, file sha256 ${esc(d.v1Hash.slice(0, 16))}…). Both players are the same AI planner. Nothing on this page states a conclusion.</p>
<h2>How the game works</h2><p>7×7 board. Human pieces start in column A and score in column G; AI pieces start in column G and score in column A. Each turn a player may place ONE effect on up to 3 empty cells, then moves. An effect fires on <b>whichever</b> piece enters the cell, then that cell is used up. Whether an effect is good or bad is judged for the owner of the piece that <b>steps on it</b>, not for the player who installed it. Teleport sends the piece to a random empty square in columns B–F. A shove east moves a piece toward column G; a shove west toward column A.</p>
<h2>Summary by effect (engine-measured)</h2>${table('Per effect', ['Effect', 'Placed by Human', 'Placed by AI', 'Triggers', 'Stepped on by installer', 'Stepped on by the other player', 'Mean squares gained (installer stepping)', 'Mean squares gained (other player stepping)'], d.effectTable)}
<h2>Prior valuation vs measured consequence</h2>${table('V0.3 activator utility (positive = good for the stepping piece) vs measured mean squares gained', ['Effect', 'V0.3 prior utility', 'Measured mean squares gained by the stepping piece', 'Triggers'], d.valuation.map(v => [v.effect, v.prior, f(v.measured, 2), v.triggers]))}
<h2>Raw trigger history</h2>${trTable('Teleport triggers (sample)', sample(tp, 25))}${trTable('Shove east/west triggers (sample)', sample(ew, 25))}
<h2>Raw placement history</h2>${plTable('Teleport and shove east/west placements (sample)', sample(pl, 31))}
<h2>Planner choices and rejected alternatives</h2><p class="muted">For each turn: the plan the AI chose (with its score) and the best plans it rejected. Higher score = preferred.</p>
${d.traces.map(t => table(`Game ${t.game}`, ['Turn', 'Player', 'Chosen plan', 'Score', 'Best rejected alternatives (score)'], t.trace.map(x => [x.turn, x.p, x.chosen, x.chosenScore, x.alternatives.map(a => `${a.summary} (${a.score})`).join(' | ')]))).join('')}
<h2>A full game</h2>${timeline(d.replay)}
${notebook({ action, nonce, kind: 'exploration' })}`);
}

// ---------------------------------------------------------------- challenge / correction pages
export type SampleSpec = { kind: 'triggers' | 'placements'; pred: (e: string) => boolean; col: 'Mover = installer' | 'Self-boost'; yes: (r: TriggerRow | PlacementRow) => boolean };
export const sampleSpecFor = (metricKey: string): SampleSpec | null =>
  metricKey === 'tp_self_share' ? { kind: 'triggers', pred: e => e === 'teleport', col: 'Mover = installer', yes: r => (r as TriggerRow).self }
    : metricKey === 'ew_self_trigger_share' ? { kind: 'triggers', pred: e => /^shove:(east|west):/.test(e), col: 'Mover = installer', yes: r => (r as TriggerRow).self }
    : metricKey === 'ew_aligned_share' ? { kind: 'placements', pred: e => /^shove:(east|west):/.test(e), col: 'Self-boost', yes: r => (r as PlacementRow).selfBoost }
      : null;
export type Section = {
  id: string; title: string; mechanism: string; origin: string; intervention: string; metric: string; direction: 'decrease' | 'increase'; effect: Effect;
  controlGames: GameRec[]; treatGames: GameRec[]; outcome?: string; reasons?: string[];
};
export type Condition = { id: string; section: string; text: string; ours: boolean; kind: 'sample-count' | 'per-seed' | 'row-count' };
export function sectionHtml(s: Section, labels: { control: string; treat: string }, maxRows: number): { html: string; conds: Condition[] } {
  const conds: Condition[] = [];
  const dirWord = s.direction === 'decrease' ? 'lower' : 'higher';
  const ps = s.effect.perSeed.filter(p => p.control !== null && p.treatment !== null);
  const agree = ps.filter(p => (s.direction === 'decrease' ? p.treatment! < p.control! : p.treatment! > p.control!));
  const against = ps.filter(p => (s.direction === 'decrease' ? p.treatment! > p.control! : p.treatment! < p.control!));
  const best = [...ps].sort((a, b) => (s.direction === 'decrease' ? (a.treatment! - a.control!) - (b.treatment! - b.control!) : (b.treatment! - b.control!) - (a.treatment! - a.control!)))[0];
  const worst = against.sort((a, b) => Math.abs(b.treatment! - b.control!) - Math.abs(a.treatment! - a.control!))[0];
  let html = `<h2 id="${esc(s.id)}">Section ${esc(s.id)}: ${esc(s.title)}</h2><p><b>Origin:</b> ${esc(s.origin)}. <b>Proposed mechanism:</b> ${esc(s.mechanism)}</p>
<p><b>${esc(labels.control)}</b> vs <b>${esc(labels.treat)}</b>: ${esc(s.intervention)}. Measurement: ${esc(METRICS[s.metric]?.label ?? s.metric)}. Predicted to be ${dirWord} with the change.</p>
${table('Numerical outcome', ['Measurement', labels.control, labels.treat, 'Difference', '95% interval (seed bootstrap)', 'Independent seeds', 'Seed batch 1 / 2', 'Human first / AI first'], [[s.metric, f(s.effect.control), f(s.effect.treatment), f(s.effect.effect), s.effect.ci ? `${f(s.effect.ci[0])} to ${f(s.effect.ci[1])}` : 'not enough seeds', s.effect.units, s.effect.batches.map(b => f(b)).join(' / ') || '—', `${f(s.effect.sides.humanFirst)} / ${f(s.effect.sides.aiFirst)}`]])}
${table('Per-seed values', ['Seed', 'Control value', 'Intervention value'], ps.map(p => [p.seed, f(p.control), f(p.treatment)]))}`;
  conds.push({ id: `${s.id}-seeds`, section: s.id, kind: 'per-seed', text: `In the section titled 'Section ${s.id}', in the 'Per-seed values' table, more than half of the data rows have an 'Intervention value' number that is ${dirWord} than the 'Control value' number in the same row.`, ours: agree.length * 2 > ps.length });
  const spec = sampleSpecFor(s.metric);
  if (spec) {
    const rowsOf = (g: GameRec[], pre: string) => (spec.kind === 'triggers' ? triggerRows(g, spec.pred, pre) : placementRows(g, spec.pred, pre)) as (TriggerRow | PlacementRow)[];
    const cs = sample(rowsOf(s.controlGames, `${s.id}c`), maxRows), ts = sample(rowsOf(s.treatGames, `${s.id}i`), maxRows);
    const tab = (cap: string, rows: (TriggerRow | PlacementRow)[]) => (spec.kind === 'triggers' ? trTable(cap, rows as TriggerRow[]) : plTable(cap, rows as PlacementRow[]));
    html += `<p class="muted">Raw samples below are systematic samples of the rows (same rule for both tables).</p>${tab('Control sample', cs)}${tab('Intervention sample', ts)}`;
    const share = (rs: typeof cs) => (rs.length ? rs.filter(spec.yes).length / rs.length : 0);
    conds.push({ id: `${s.id}-sample`, section: s.id, kind: 'sample-count', text: `In the section titled 'Section ${s.id}', the share of data rows whose '${spec.col}' value is 'yes' is ${dirWord} in the 'Intervention sample' table than in the 'Control sample' table.`, ours: s.direction === 'decrease' ? share(ts) < share(cs) : share(ts) > share(cs) });
  }
  const g = (games: GameRec[], seed?: number) => games.find(x => x.seed === seed);
  if (best) { const t = g(s.treatGames, best.seed); if (t) html += `<h3>Matched example (seed ${best.seed}: control ${f(best.control)} → intervention ${f(best.treatment)})</h3>${timeline(t, 14)}`; }
  if (worst) { const t = g(s.treatGames, worst.seed); if (t) html += `<h3>Counterexample (seed ${worst.seed}: control ${f(worst.control)} → intervention ${f(worst.treatment)}, against the prediction)</h3>${timeline(t, 14)}`; }
  else html += `<h3>Counterexample</h3><p>No seed moved against the prediction.</p>`;
  html += `<h3>Cases this explanation fails to explain</h3><p>${against.length ? `Seeds that moved against the prediction: ${against.map(a => a.seed).join(', ')}.` : 'None of the per-seed values moved against the prediction.'} Seeds with no change: ${ps.filter(p => p.treatment === p.control).map(p => p.seed).join(', ') || 'none'}.</p>`;
  if (s.outcome) html += `<p><b>Pre-registered evaluation:</b> ${esc(s.outcome)}${s.reasons?.length ? ` (${esc(s.reasons.join('; '))})` : ''}</p>`;
  return { html, conds };
}
export function comparisonPage(title: string, intro: string, sections: { html: string }[], nb: { nonce: string; action: string; hypotheses: string[] } | null): string {
  return page(title, `<h1>${esc(title)}</h1><p class="muted">${esc(intro)}</p>${sections.map(s => s.html).join('')}${nb ? notebook({ action: nb.action, nonce: nb.nonce, kind: 'challenge', hypotheses: nb.hypotheses }) : ''}`);
}
