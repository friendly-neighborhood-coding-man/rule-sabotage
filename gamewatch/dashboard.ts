/**
 * GameWatch evidence dashboard (EXPERIMENTAL). Reads ONLY a game-independent evidence bundle (gamewatch/evidence.ts)
 * and writes a small static site. It never imports a game engine and contains no expected verdicts or defect labels.
 *
 *   node --experimental-strip-types gamewatch/dashboard.ts [bundle.json] [outDir]
 *   defaults: evidence/gamewatch/evidence.json -> evidence/gamewatch/site/
 */
import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { GWBundle, GWCase, GWMatch, GWState, GWEvent } from './evidence.ts';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const esc = (v: unknown) => String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); const n = s.length; return n ? (n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2) : NaN; };
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
const f2 = (x: number) => (Number.isFinite(x) ? x.toFixed(2) : '–');
const pct = (a: number, b: number) => (b ? `${a}/${b} (${Math.round((100 * a) / b)}%)` : '–');

const CSS = `body{font:14px/1.45 system-ui,sans-serif;margin:24px auto;max-width:1180px;padding:0 16px;color:#1b1f24}
h1{font-size:22px}h2{font-size:18px;margin-top:28px;border-bottom:1px solid #ddd;padding-bottom:4px}table{border-collapse:collapse;margin:8px 0;width:100%}
th,td{border:1px solid #d6d9dd;padding:4px 6px;vertical-align:top;text-align:left}th{background:#f3f5f7}code,.mono{font-family:ui-monospace,monospace;font-size:12.5px}
.refused{background:#fff4e5}.small{font-size:12.5px;color:#444}nav a{margin-right:14px}ol li{margin:3px 0}.ev{margin:0;padding-left:16px}`;
const page = (title: string, body: string) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(title)}</title><style>${CSS}</style></head><body><nav><a href="index.html">GameWatch home</a><a href="report.html">Submit a finding</a></nav>${body}</body></html>\n`;

/** One event as a short line. Generic: every field of the event is shown. */
export function evLine(e: GWEvent): string {
  const { type, ...rest } = e;
  return `${type} ${Object.entries(rest).map(([k, v]) => `${k}=${Array.isArray(v) ? `[${v.join(',')}]` : v}`).join(' ')}`;
}
function stateText(s: GWState): string {
  const pcs = s.pieces.map(p => `${p.id}(${p.side})@${p.square}${p.frozenTurns ? ` frozen:${p.frozenTurns}` : ''}${p.shield ? ' shield' : ''}`).join('; ');
  const eff = s.effects.length ? s.effects.map(e => `${e.square}:${e.effect}#${e.effectId}(${e.owner})`).join('; ') : 'none';
  return `turn ${s.turn}, to move: ${s.toMove}, actions left: ${s.actionsLeft}, phase: ${s.phase}${s.winner ? `, winner: ${s.winner}` : ''}<br><b>pieces</b> ${esc(pcs)}<br><b>effects</b> ${esc(eff)}`;
}

function casePage(c: GWCase): string {
  const rows = c.steps.map(st => `<tr class="${st.outcome === 'refused' ? 'refused' : ''}" id="step-${st.n}"><td>${st.n}</td><td>${esc(st.actor)}</td><td>${esc(st.action)}</td><td>${st.outcome}${st.note ? `<div class="small">${esc(st.note)}</div>` : ''}</td><td class="mono"><ul class="ev">${st.events.map(e => `<li>${esc(evLine(e))}</li>`).join('')}</ul></td><td class="mono small">${stateText(st.before)}</td><td class="mono small">${stateText(st.after)}</td></tr>`).join('');
  return page(`Case ${c.caseId}`, `<h1>Case ${esc(c.caseId)}</h1>
<p>Build <b>${esc(c.build)}</b> · scripted playtest · seed ${c.seed} · first mover ${esc(c.firstMover)}</p>
<p><b>Script:</b> ${esc(c.title)}</p>
<table><tr><th>#</th><th>Actor</th><th>Action</th><th>Outcome</th><th>Events reported by the engine</th><th>State before</th><th>State after</th></tr>${rows}</table>`);
}

function matchPage(m: GWMatch): string {
  const rows = m.rows.map(r => `<tr><td>${r.turn}</td><td>${esc(r.side)}</td><td>${r.piecesOnBoard}</td><td>${r.actionsGranted}</td><td>${r.movesMade}</td><td>${r.placement ? `${esc(r.placement.effect)} on ${esc(r.placement.squares.join(', '))}: ${esc(r.placement.result)}` : '—'}</td><td class="mono"><ul class="ev">${r.events.filter(e => e.type !== 'turn-end').map(e => `<li>${esc(evLine(e))}</li>`).join('')}</ul></td></tr>`).join('');
  return page(`Match ${m.matchId}`, `<h1>Match ${esc(m.matchId)}</h1>
<p>Build <b>${esc(m.build)}</b> · AI-vs-AI · policy ${esc(Object.entries(m.policy).map(([k, v]) => `${k}: ${v}`).join(', '))} · seed ${m.seed} · first mover ${esc(m.firstMover)}</p>
<p>Result: <b>${esc(m.winner)}</b> after ${m.turns} turns. ${esc(m.reason)} Pieces across: ${esc(Object.entries(m.scored).map(([k, v]) => `${k} ${v}`).join(', '))}.</p>
<table><tr><th>Turn</th><th>Side</th><th>Own pieces on board at turn start</th><th>Actions granted</th><th>Moves made</th><th>Placement (referee result)</th><th>Events</th></tr>${rows}</table>`);
}

type Agg = ReturnType<typeof aggregate>;
export function aggregate(ms: GWMatch[], sideOf: Record<string, string>) {
  const sides = [...new Set(Object.values(sideOf))].sort();
  const turnRows = ms.flatMap(m => m.rows.map(r => ({ ...r, seat: r.side === m.firstMover ? 'first mover' : 'second mover' })));
  const ev = turnRows.flatMap(r => r.events.map(e => ({ e, side: r.side })));
  const effects = [...new Set(ev.filter(x => x.e.type === 'effect-placed' || x.e.type === 'effect-fired').map(x => String(x.e.effect)))].sort();
  const pieceSide = (e: GWEvent) => { const p = (e.pieces as string[] | undefined)?.[0]; return p ? sideOf[p] ?? '?' : '?'; };
  return {
    games: ms.length,
    wins: Object.fromEntries([...sides, 'draw'].map(s => [s, ms.filter(m => m.winner === s).length])),
    firstMoverWins: ms.filter(m => m.winner === m.firstMover).length,
    winsByFirst: Object.fromEntries(sides.map(f => [f, { games: ms.filter(m => m.firstMover === f).length, firstMoverWon: ms.filter(m => m.firstMover === f && m.winner === f).length }])),
    turns: { median: median(ms.map(m => m.turns)), min: Math.min(...ms.map(m => m.turns)), max: Math.max(...ms.map(m => m.turns)) },
    turnLimit: ms.filter(m => /Turn limit/i.test(m.reason)).length,
    bySeat: Object.fromEntries(['first mover', 'second mover'].map(seat => { const rs = turnRows.filter(r => r.seat === seat); return [seat, { turns: rs.length, actions: mean(rs.map(r => r.actionsGranted)), pieces: mean(rs.map(r => r.piecesOnBoard)), moves: mean(rs.map(r => r.movesMade)) }]; })),
    bySide: Object.fromEntries(sides.map(s => { const rs = turnRows.filter(r => r.side === s); return [s, { turns: rs.length, actions: mean(rs.map(r => r.actionsGranted)), pieces: mean(rs.map(r => r.piecesOnBoard)), moves: mean(rs.map(r => r.movesMade)), placements: rs.filter(r => r.placement).length, placedOk: rs.filter(r => r.placement?.result === 'engine-approved').length }]; })),
    perEffect: effects.map(name => ({
      effect: name,
      cellsPlaced: ev.filter(x => x.e.type === 'effect-placed' && x.e.effect === name).reduce((a, x) => a + (x.e.squares as string[]).length, 0),
      fired: Object.fromEntries(sides.map(s => [s, ev.filter(x => x.e.type === 'effect-fired' && x.e.effect === name && x.side === s).length])),
    })),
    events: Object.fromEntries(['shield-absorbed', 'capture', 'chain-limit', 'forced-move', 'extra-action', 'status'].map(t => [t, Object.fromEntries(sides.map(s => [s, ev.filter(x => x.e.type === t && (t === 'shield-absorbed' || t === 'forced-move' || t === 'status' ? pieceSide(x.e) : x.side) === s).length]))])),
  };
}

function aggTable(builds: string[], agg: Record<string, Agg>, sides: string[]): string {
  const row = (label: string, f: (a: Agg) => string) => `<tr><th>${esc(label)}</th>${builds.map(b => `<td>${f(agg[b])}</td>`).join('')}</tr>`;
  const effects = [...new Set(builds.flatMap(b => agg[b].perEffect.map(p => p.effect)))].sort();
  return `<table><tr><th></th>${builds.map(b => `<th>Build ${esc(b)}</th>`).join('')}</tr>
${row('Games', a => String(a.games))}
${sides.map(s => row(`${s} wins`, a => pct(a.wins[s], a.games))).join('')}
${row('Draws', a => String(a.wins.draw))}
${row('Games won by the side that moved first', a => pct(a.firstMoverWins, a.games))}
${sides.map(s => row(`… when ${s} moved first`, a => pct(a.winsByFirst[s].firstMoverWon, a.winsByFirst[s].games))).join('')}
${row('Turns per game (median, min–max)', a => `${a.turns.median} (${a.turns.min}–${a.turns.max})`)}
${row('Games ending at the turn limit', a => String(a.turnLimit))}
${['first mover', 'second mover'].map(seat => row(`Seat "${seat}": mean own pieces on board / actions granted / moves made per turn`, a => `${f2(a.bySeat[seat].pieces)} / ${f2(a.bySeat[seat].actions)} / ${f2(a.bySeat[seat].moves)} (${a.bySeat[seat].turns} turns)`)).join('')}
${sides.map(s => row(`Side ${s}: mean own pieces on board / actions granted / moves made per turn`, a => `${f2(a.bySide[s].pieces)} / ${f2(a.bySide[s].actions)} / ${f2(a.bySide[s].moves)} (${a.bySide[s].turns} turns)`)).join('')}
${sides.map(s => row(`Side ${s}: placements attempted / placed`, a => `${a.bySide[s].placements} / ${a.bySide[s].placedOk}`)).join('')}
${effects.map(name => row(`Effect "${name}": cells placed / times fired (${sides.map(s => `by ${s} pieces`).join(', ')})`, a => { const p = a.perEffect.find(x => x.effect === name); return p ? `${p.cellsPlaced} / ${sides.map(s => p.fired[s]).join(', ')}` : '0 / –'; })).join('')}
${Object.keys(agg[builds[0]].events).map(t => row(`Event "${t}" (${sides.join(', ')})`, a => sides.map(s => a.events[t][s]).join(', '))).join('')}
</table>`;
}

const REPORT_FORM = `<h1>Submit a finding</h1>
<p>Use one form per finding. Cite the case ids, match ids and step or turn numbers your finding rests on. Submitting stores the finding exactly as written.</p>
<form method="post" action="/report" id="finding">
<p><label>Category<br><select name="category" required><option value="">choose…</option><option>confirmed observable anomaly</option><option>suspected bug needing reproduction</option><option>balance hypothesis</option><option>clean / no problem found</option></select></label></p>
<p><label>Documented rule(s) concerned (e.g. R7)<br><input name="rules" size="40"></label></p>
<p><label>Build(s) concerned<br><input name="builds" size="40"></label></p>
<p><label>What you observed (claim)<br><textarea name="claim" rows="4" cols="100" required></textarea></label></p>
<p><label>Evidence: case/match ids and step/turn numbers<br><textarea name="evidence" rows="3" cols="100" required></textarea></label></p>
<p><label>How to reproduce or verify it<br><textarea name="reproduce" rows="3" cols="100"></textarea></label></p>
<p><label>Suggested improvement or fix, and how to verify it<br><textarea name="suggestion" rows="3" cols="100"></textarea></label></p>
<p><label>Confidence<br><select name="confidence"><option>high</option><option>medium</option><option>low</option></select></label></p>
<input type="hidden" name="nonce" value="__NONCE__">
<p><button type="submit">Submit finding</button></p>
</form>`;

export function build(bundle: GWBundle, out: string) {
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  const sideOf: Record<string, string> = {};
  for (const p of bundle.cases[0]?.steps[0]?.before.pieces ?? []) sideOf[p.id] = p.side;
  const sides = [...new Set(Object.values(sideOf))].sort();
  const builds = bundle.builds.map(b => b.label);
  const agg = Object.fromEntries(builds.map(b => [b, aggregate(bundle.matches.filter(m => m.build === b), sideOf)]));
  for (const c of bundle.cases) writeFileSync(join(out, `case-${c.caseId}.html`), casePage(c));
  for (const m of bundle.matches) writeFileSync(join(out, `match-${m.matchId}.html`), matchPage(m));
  writeFileSync(join(out, 'report.html'), page('Submit a finding', REPORT_FORM));
  const index = page(`GameWatch: ${bundle.game.name}`, `<h1>GameWatch QA evidence: ${esc(bundle.game.name)} ${esc(bundle.game.version)}</h1>
<p>GameWatch collects evidence from playtests of a game and presents it for review. It does not simulate the game itself. Your job as reviewer: compare what the builds actually did with the documented rules below.</p>
<h2>Where the evidence comes from</h2><ul>${bundle.source.map(s => `<li>${esc(s)}</li>`).join('')}</ul>
<h2>Documented rules (intended behaviour)</h2><ol>${bundle.game.rules.map(r => `<li id="${esc(r.id)}"><b>${esc(r.id)}</b> ${esc(r.text)}</li>`).join('')}</ol>
<h2>Builds</h2><ul>${bundle.builds.map(b => `<li><b>${esc(b.label)}</b>: ${esc(b.note)}</li>`).join('')}</ul>
<h2>Scripted playtest cases (${bundle.cases.length})</h2>
<table><tr><th>Case</th><th>Build</th><th>Script</th><th>Steps</th><th>Refused steps</th></tr>${bundle.cases.map(c => `<tr><td><a href="case-${esc(c.caseId)}.html">${esc(c.caseId)}</a></td><td>${esc(c.build)}</td><td>${esc(c.title)}</td><td>${c.steps.length - 1}</td><td>${c.steps.filter(s => s.outcome === 'refused').length}</td></tr>`).join('')}</table>
<h2>AI-vs-AI playtests: aggregate statistics (${bundle.matches.length} games)</h2>
${aggTable(builds, agg, sides)}
<h2>AI-vs-AI matches</h2>
<table><tr><th>Match</th><th>Build</th><th>Seed</th><th>First mover</th><th>Winner</th><th>Turns</th><th>Pieces across</th></tr>${bundle.matches.map(m => `<tr><td><a href="match-${esc(m.matchId)}.html">${esc(m.matchId)}</a></td><td>${esc(m.build)}</td><td>${m.seed}</td><td>${esc(m.firstMover)}</td><td>${esc(m.winner)}</td><td>${m.turns}</td><td>${esc(Object.entries(m.scored).map(([k, v]) => `${k} ${v}`).join(', '))}</td></tr>`).join('')}</table>
<p class="small">Generated ${esc(bundle.generatedAt)} from <code>evidence/gamewatch/evidence.json</code>.</p>`);
  writeFileSync(join(out, 'index.html'), index);
  return { pages: 2 + bundle.cases.length + bundle.matches.length, agg };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const bundle = JSON.parse(readFileSync(process.argv[2] ?? join(ROOT, 'evidence/gamewatch/evidence.json'), 'utf8')) as GWBundle;
  const r = build(bundle, process.argv[3] ?? join(ROOT, 'evidence/gamewatch/site'));
  console.log(`wrote ${r.pages} pages`);
  console.log(JSON.stringify(r.agg, null, 1));
}
