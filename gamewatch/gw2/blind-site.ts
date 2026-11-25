/**
 * GW2 P3 sites.
 *
 *  buildBlindSite(obs, outDir)   Blind discovery site from blind observations (gamewatch/gw2/partition.ts): neutral ids,
 *                                no rules, no game name or version, no script titles, no build labels or notes, no seeds,
 *                                no generator metadata. Pages: index, case-*, match-*, report (findings) and hypothesis
 *                                (free text, optional structured fields, confidence, competing-with, explicit abstain).
 *  specGuidedSite(bundle, out)   Spec-guided mode: the unchanged GW1 dashboard (gamewatch/dashboard.ts build()) written
 *                                to a GW2 directory; given the frozen GW1 bundle it reproduces evidence/gamewatch/site/
 *                                byte for byte (AC-P3.6).
 * Both refuse to write outside evidence/gw2/ in the repository (paths.ts).
 */
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { assertWritableOutput } from './paths.ts';
import { aggregate, evLine, build as gw1Build } from '../dashboard.ts';
import type { GWBundle, GWState } from '../evidence.ts';
import type { BlindObservations, BlindCase, BlindMatch } from './partition.ts';

const esc = (v: unknown) => String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const f2 = (x: number) => (Number.isFinite(x) ? x.toFixed(2) : '–');
const pct = (a: number, b: number) => (b ? `${a}/${b} (${Math.round((100 * a) / b)}%)` : '–');
const CSS = `body{font:14px/1.45 system-ui,sans-serif;margin:24px auto;max-width:1180px;padding:0 16px;color:#1b1f24}
h1{font-size:22px}h2{font-size:18px;margin-top:28px;border-bottom:1px solid #ddd;padding-bottom:4px}table{border-collapse:collapse;margin:8px 0;width:100%}
th,td{border:1px solid #d6d9dd;padding:4px 6px;vertical-align:top;text-align:left}th{background:#f3f5f7}code,.mono{font-family:ui-monospace,monospace;font-size:12.5px}
.refused{background:#fff4e5}.small{font-size:12.5px;color:#444}nav a{margin-right:14px}.ev{margin:0;padding-left:16px}`;
const page = (title: string, body: string) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(title)}</title><style>${CSS}</style></head><body><nav><a href="index.html">Observations</a><a href="hypothesis.html">Submit a hypothesis</a><a href="report.html">Submit a finding</a></nav>${body}</body></html>\n`;

function stateText(s: GWState): string {
  const pcs = s.pieces.map(p => `${p.id}(${p.side})@${p.square}${p.frozenTurns ? ` frozen:${p.frozenTurns}` : ''}${p.shield ? ' shield' : ''}`).join('; ');
  const eff = s.effects.length ? s.effects.map(e => `${e.square}:${e.effect}#${e.effectId}(${e.owner})`).join('; ') : 'none';
  return `turn ${s.turn}, to move: ${s.toMove}, actions left: ${s.actionsLeft}, phase: ${s.phase}${s.winner ? `, winner: ${s.winner}` : ''}<br><b>pieces</b> ${esc(pcs)}<br><b>effects</b> ${esc(eff)}`;
}
const casePage = (c: BlindCase) => page(`Case ${c.caseId}`, `<h1>Case ${esc(c.caseId)}</h1>
<p>Build <b>${esc(c.build)}</b> · scripted playtest · script <b>${esc(c.script)}</b> (cases with the same script label ran the same fixed actions) · first mover ${esc(c.firstMover)}</p>
<table><tr><th>#</th><th>Actor</th><th>Action</th><th>Outcome</th><th>Events reported by the engine</th><th>State before</th><th>State after</th></tr>${c.steps.map(st => `<tr class="${st.outcome === 'refused' ? 'refused' : ''}" id="step-${st.n}"><td>${st.n}</td><td>${esc(st.actor)}</td><td>${esc(st.action)}</td><td>${st.outcome}${st.note ? `<div class="small">${esc(st.note)}</div>` : ''}</td><td class="mono"><ul class="ev">${st.events.map(e => `<li>${esc(evLine(e))}</li>`).join('')}</ul></td><td class="mono small">${stateText(st.before)}</td><td class="mono small">${stateText(st.after)}</td></tr>`).join('')}</table>`);
const matchPage = (m: BlindMatch) => page(`Match ${m.matchId}`, `<h1>Match ${esc(m.matchId)}</h1>
<p>Build <b>${esc(m.build)}</b> · computer vs computer · policy ${esc(Object.entries(m.policy).map(([k, v]) => `${k}: ${v}`).join(', '))} · first mover ${esc(m.firstMover)}</p>
<p>Result: <b>${esc(m.winner)}</b> after ${m.turns} turns. ${esc(m.reason)} Pieces across: ${esc(Object.entries(m.scored).map(([k, v]) => `${k} ${v}`).join(', '))}.</p>
<table><tr><th>Turn</th><th>Side</th><th>Own pieces on board at turn start</th><th>Actions granted</th><th>Moves made</th><th>Placement (referee result)</th><th>Events</th></tr>${m.rows.map(r => `<tr><td>${r.turn}</td><td>${esc(r.side)}</td><td>${r.piecesOnBoard}</td><td>${r.actionsGranted}</td><td>${r.movesMade}</td><td>${r.placement ? `${esc(r.placement.effect)} on ${esc(r.placement.squares.join(', '))}: ${esc(r.placement.result)}` : '—'}</td><td class="mono"><ul class="ev">${r.events.filter(e => e.type !== 'turn-end').map(e => `<li>${esc(evLine(e))}</li>`).join('')}</ul></td></tr>`).join('')}</table>`);

export const REPORT_FORM = `<h1>Submit a finding</h1>
<p>Use one form per finding. Cite the case and match ids and the step or turn numbers it rests on. Submitting stores the finding exactly as written.</p>
<form method="post" action="/report" id="finding">
<p><label>Category<br><select name="category" required><option value="">choose…</option><option>confirmed observable anomaly</option><option>suspected bug needing reproduction</option><option>balance hypothesis</option><option>clean / no problem found</option></select></label></p>
<p><label>Build(s) concerned<br><input name="builds" size="40"></label></p>
<p><label>What you observed (claim)<br><textarea name="claim" rows="4" cols="100" required></textarea></label></p>
<p><label>Evidence: case/match ids and step/turn numbers<br><textarea name="evidence" rows="3" cols="100" required></textarea></label></p>
<p><label>How to reproduce or verify it<br><textarea name="reproduce" rows="3" cols="100"></textarea></label></p>
<p><label>Suggested improvement or fix, and how to verify it<br><textarea name="suggestion" rows="3" cols="100"></textarea></label></p>
<p><label>Confidence<br><select name="confidence"><option>high</option><option>medium</option><option>low</option></select></label></p>
<input type="hidden" name="nonce" value="__NONCE__">
<p><button type="submit">Submit finding</button></p>
</form>`;
export const HYPOTHESIS_FIELDS = ['statement', 'trigger', 'condition', 'effect', 'confidence', 'competingWith', 'evidence', 'abstain', 'abstainScope', 'nonce'];
export const HYPOTHESIS_FORM = `<h1>Submit a hypothesis</h1>
<p>A hypothesis is a rule you think the game follows, stated in your own words. One form per hypothesis. You do not have to give a hypothesis for every aspect of the game, and you may submit competing hypotheses for the same behaviour. If you cannot decide, abstain instead: abstaining is a valid answer. Everything you submit is stored exactly as written and is never overwritten; submit a new form to revise.</p>
<form method="post" action="/hypothesis" id="hypothesis">
<p><label>Hypothesis, in your own words<br><textarea name="statement" rows="4" cols="100"></textarea></label></p>
<p class="small">Optional structure (leave empty if it does not fit):</p>
<p><label>When (trigger)<br><input name="trigger" size="80"></label></p>
<p><label>If (condition)<br><input name="condition" size="80"></label></p>
<p><label>Then (observable effect)<br><input name="effect" size="80"></label></p>
<p><label>Confidence<br><select name="confidence"><option>high</option><option>medium</option><option>low</option></select></label></p>
<p><label>Competes with your earlier hypotheses (their H- numbers, e.g. H-1)<br><input name="competingWith" size="40"></label></p>
<p><label>Evidence: case/match ids and step/turn numbers<br><textarea name="evidence" rows="3" cols="100"></textarea></label></p>
<p><label><input type="checkbox" name="abstain" value="yes"> I abstain: I cannot decide</label></p>
<p><label>If abstaining: what you cannot decide, and why<br><textarea name="abstainScope" rows="2" cols="100"></textarea></label></p>
<input type="hidden" name="nonce" value="__NONCE__">
<p><button type="submit">Submit</button></p>
</form>`;

export function buildBlindSite(obs: BlindObservations, outDir: string) {
  const out = assertWritableOutput(outDir);
  if (existsSync(out)) throw new Error(`refusing to overwrite an existing site: ${out}`);
  mkdirSync(out, { recursive: true });
  const sideOf: Record<string, string> = {};
  for (const p of obs.cases[0]?.steps[0]?.before.pieces ?? []) sideOf[p.id] = p.side;
  const sides = [...new Set([...Object.values(sideOf), ...obs.matches.flatMap(m => Object.keys(m.scored))])].sort();
  const agg = Object.fromEntries(obs.builds.map(b => [b, aggregate(obs.matches.filter(m => m.build === b) as never, sideOf)]));
  for (const c of obs.cases) writeFileSync(join(out, `case-${c.caseId}.html`), casePage(c));
  for (const m of obs.matches) writeFileSync(join(out, `match-${m.matchId}.html`), matchPage(m));
  writeFileSync(join(out, 'report.html'), page('Submit a finding', REPORT_FORM));
  writeFileSync(join(out, 'hypothesis.html'), page('Submit a hypothesis', HYPOTHESIS_FORM));
  const B = obs.builds, has = obs.matches.length > 0;
  const row = (label: string, f: (a: ReturnType<typeof aggregate>) => string) => `<tr><th>${esc(label)}</th>${B.map(b => `<td>${f(agg[b])}</td>`).join('')}</tr>`;
  const effects = [...new Set(B.flatMap(b => agg[b].perEffect.map(p => p.effect)))].sort();
  const aggTable = !has ? '<p>No computer-vs-computer games in this set.</p>' : `<table><tr><th></th>${B.map(b => `<th>Build ${esc(b)}</th>`).join('')}</tr>
${row('Games', a => String(a.games))}
${sides.map(s => row(`${s} wins`, a => pct(a.wins[s] ?? 0, a.games))).join('')}
${row('Draws', a => String(a.wins.draw))}
${row('Games won by the side that moved first', a => pct(a.firstMoverWins, a.games))}
${row('Turns per game (median, min–max)', a => `${a.turns.median} (${a.turns.min}–${a.turns.max})`)}
${sides.map(s => row(`Side ${s}: mean own pieces on board / actions granted / moves made per turn`, a => a.bySide[s] ? `${f2(a.bySide[s].pieces)} / ${f2(a.bySide[s].actions)} / ${f2(a.bySide[s].moves)} (${a.bySide[s].turns} turns)` : '–')).join('')}
${sides.map(s => row(`Side ${s}: placements attempted / placed`, a => a.bySide[s] ? `${a.bySide[s].placements} / ${a.bySide[s].placedOk}` : '–')).join('')}
${effects.map(name => row(`Effect "${name}": cells placed / times fired (${sides.map(s => `by ${s} pieces`).join(', ')})`, a => { const p = a.perEffect.find(x => x.effect === name); return p ? `${p.cellsPlaced} / ${sides.map(s => p.fired[s] ?? 0).join(', ')}` : '0 / –'; })).join('')}
${Object.keys(agg[B[0]].events).map(t => row(`Event "${t}" (${sides.join(', ')})`, a => sides.map(s => a.events[t][s] ?? 0).join(', '))).join('')}
</table>`;
  writeFileSync(join(out, 'index.html'), page('Observations', `<h1>Observations of a board game</h1>
<p>These pages show what builds of a two-player board game actually did when played: scripted playtests (both sides' actions fixed in advance; each step shows the state before and after and every event the game reported) and games between two computer players. The game's documented rules are not shown. Infer from the observations which rules the game appears to follow, and submit them as hypotheses. You may submit competing hypotheses, state your confidence, or abstain; you are not asked for a hypothesis about every aspect of the game.</p>
<h2>Builds</h2><ul>${B.map(b => `<li><b>${esc(b)}</b></li>`).join('')}</ul>
<h2>Scripted playtest cases (${obs.cases.length})</h2>
<table><tr><th>Case</th><th>Build</th><th>Script</th><th>Steps</th><th>Refused steps</th></tr>${obs.cases.map(c => `<tr><td><a href="case-${esc(c.caseId)}.html">${esc(c.caseId)}</a></td><td>${esc(c.build)}</td><td>${esc(c.script)}</td><td>${c.steps.length - 1}</td><td>${c.steps.filter(s => s.outcome === 'refused').length}</td></tr>`).join('')}</table>
<h2>Computer-vs-computer games: aggregate statistics (${obs.matches.length} games)</h2>
${aggTable}
<h2>Computer-vs-computer games</h2>
<table><tr><th>Match</th><th>Build</th><th>First mover</th><th>Winner</th><th>Turns</th><th>Pieces across</th></tr>${obs.matches.map(m => `<tr><td><a href="match-${esc(m.matchId)}.html">${esc(m.matchId)}</a></td><td>${esc(m.build)}</td><td>${esc(m.firstMover)}</td><td>${esc(m.winner)}</td><td>${m.turns}</td><td>${esc(Object.entries(m.scored).map(([k, v]) => `${k} ${v}`).join(', '))}</td></tr>`).join('')}</table>`));
  return { pages: 3 + obs.cases.length + obs.matches.length };
}

/** Spec-guided mode: the unchanged GW1 dashboard into a GW2 directory. */
export function specGuidedSite(bundle: GWBundle, outDir: string) {
  const out = assertWritableOutput(outDir);
  if (existsSync(out)) throw new Error(`refusing to overwrite an existing site: ${out}`);
  return gw1Build(bundle, out);
}
